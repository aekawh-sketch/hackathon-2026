package ru.spacemap.android

import android.app.AlertDialog
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.format.Formatter
import android.util.Log
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Обновление без похода за APK. При заходе в приложение смотрим на стенде описание свежей сборки
 * ([BuildConfig.UPDATE_URL], его пишет `tools/publish-android.sh`) и, если она новее, предлагаем поставить:
 *
 * 1. «Обновить» — если Android ещё не разрешал приложению ставить приложения, отправляем в настройки (один раз);
 * 2. скачиваем APK в кэш, сверяем размер и SHA-256 с описанием;
 * 3. проверяем, что внутри наше приложение той самой версии и подписанное тем же ключом: иначе Android
 *    всё равно откажет, но с непонятной ошибкой;
 * 4. отдаём файл системному установщику (PackageInstaller) — «Обновить» нажимают в его окне.
 *
 * Нет сети или стенд не ответил — молчим и проверим при следующем заходе.
 */
class AppUpdater(private val activity: ComponentActivity) {

    private val prefs by lazy { activity.getSharedPreferences("updates", Context.MODE_PRIVATE) }
    private val dir by lazy { File(activity.cacheDir, "updates") }

    /** Идёт проверка, открыт диалог, качаем или ставим — второй раз не начинаем. */
    private var busy = false
    private var checkedAt = 0L

    /** Сборка, ради которой ушли в настройки за разрешением. */
    private var awaitingPermission: Release? = null

    /** Сборка у системного установщика — для сообщения, если он откажет. */
    private var installing: Release? = null

    @Volatile private var cancelled = false
    private var receiverRegistered = false

    private val installSettings = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val release = awaitingPermission ?: return@registerForActivityResult
        awaitingPermission = null
        if (canInstall()) download(release)
        else {
            busy = false
            toast("Без разрешения обновить не получится. Можно скачать APK вручную.")
        }
    }

    /** При каждом заходе в приложение. В сеть ходим не чаще раза в [CHECK_EVERY_MS]. */
    fun checkOnEnter() {
        val now = System.currentTimeMillis()
        if (busy || now - checkedAt < CHECK_EVERY_MS) return
        busy = true
        checkedAt = now
        thread(name = "update-check", isDaemon = true) {
            val release = try {
                fetchRelease()
            } catch (e: Exception) {
                Log.i(TAG, "Не удалось проверить обновление: $e")
                null
            }
            // Мы на последней версии — скачанный когда-то APK больше не нужен.
            if (release != null && release.versionCode <= BuildConfig.VERSION_CODE) dir.deleteRecursively()
            activity.runOnUiThread {
                if (alive() && release != null && shouldOffer(release, BuildConfig.VERSION_CODE, postponed(), now)) offer(release)
                else busy = false
            }
        }
    }

    fun close() {
        cancelled = true
        if (receiverRegistered) activity.unregisterReceiver(installStatus)
        receiverRegistered = false
    }

    private fun fetchRelease(): Release {
        val source = URI(BuildConfig.UPDATE_URL)
        val conn = open(source.toURL(), timeoutMs = 8_000)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) throw IOException("HTTP ${conn.responseCode}")
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            return Release.parse(JSONObject(text), source)
        } finally {
            conn.disconnect()
        }
    }

    private fun offer(release: Release) {
        val mandatory = release.minVersionCode > BuildConfig.VERSION_CODE
        val message = buildString {
            append("Установлена ${BuildConfig.VERSION_NAME}. Скачать ${size(release.size)}.")
            if (release.notes.isNotEmpty()) release.notes.joinTo(this, "\n", prefix = "\n\nЧто нового:\n") { "• $it" }
            if (mandatory) append("\n\nОбновление обязательное: эта версия устарела.")
            // Сборка не из Google Play: Play Защита может остановить установку, хотя файл проверен.
            append("\n\nЕсли Play Защита скажет, что разработчик ей незнаком: «Подробнее» → «Всё равно установить».")
        }
        AlertDialog.Builder(activity)
            .setTitle("Доступна версия ${release.versionName}")
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton("Обновить") { _, _ -> startUpdate(release) }
            .apply {
                if (mandatory) setNegativeButton("Закрыть приложение") { _, _ -> activity.finish() }
                else setNegativeButton("Позже") { _, _ -> postpone(release) }
            }
            .show()
    }

    private fun postpone(release: Release) {
        prefs.edit().putInt(KEY_LATER_CODE, release.versionCode).putLong(KEY_LATER_AT, System.currentTimeMillis()).apply()
        busy = false
    }

    private fun postponed(): Postponed? =
        if (!prefs.contains(KEY_LATER_CODE)) null
        else Postponed(prefs.getInt(KEY_LATER_CODE, 0), prefs.getLong(KEY_LATER_AT, 0))

    private fun startUpdate(release: Release) {
        if (canInstall()) {
            download(release)
            return
        }
        AlertDialog.Builder(activity)
            .setTitle("Разрешите установку обновлений")
            .setMessage("Android один раз спросит, можно ли приложению «${activity.getString(R.string.app_name)}» устанавливать приложения. Включите переключатель и вернитесь назад.")
            .setCancelable(false)
            .setPositiveButton("Открыть настройки") { _, _ ->
                awaitingPermission = release
                try {
                    installSettings.launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                } catch (_: ActivityNotFoundException) {
                    awaitingPermission = null
                    failed(release, UpdateError("На этом телефоне нет такой настройки. Скачайте APK вручную."))
                }
            }
            .setNegativeButton("Позже") { _, _ -> postpone(release) }
            .show()
    }

    private fun canInstall() = activity.packageManager.canRequestPackageInstalls()

    /** Скачать, проверить и передать установщику. Прогресс — в диалоге с кнопкой «Отмена». */
    private fun download(release: Release) {
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        val label = TextView(activity)
        val pad = (20 * activity.resources.displayMetrics.density).toInt()
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(bar)
            addView(label)
        }
        cancelled = false
        val dialog = AlertDialog.Builder(activity)
            .setTitle("Скачиваем ${release.versionName}")
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("Отмена") { _, _ -> cancelled = true }
            .show()
        val total = size(release.size)
        // До commit: ответ установщика может прийти раньше, чем поток вернётся в главный.
        installing = release
        listenForInstaller()
        thread(name = "update-download", isDaemon = true) {
            var shown = -1
            val result = runCatching {
                val apk = fetchApk(release) { done ->
                    val percent = (done * 100 / release.size).toInt()
                    if (percent != shown) {
                        shown = percent
                        activity.runOnUiThread {
                            bar.progress = percent
                            label.text = "${size(done)} из $total"
                        }
                    }
                }
                verify(apk, release)
                if (cancelled) throw Cancelled()
                commit(apk)
            }
            activity.runOnUiThread {
                if (!alive()) return@runOnUiThread
                dialog.dismiss()
                result.onFailure { failed(release, it) }
            }
        }
    }

    private fun fetchApk(release: Release, onProgress: (Long) -> Unit): File {
        val apk = File(dir, "space-map-${release.versionCode}.apk")
        // Уже скачан: в прошлый раз установку отменили.
        if (apk.length() == release.size && sha256(apk) == release.sha256) return apk
        dir.deleteRecursively()
        dir.mkdirs()
        val part = File(dir, "${apk.name}.part")
        val conn = open(URL(release.apk.toString()), timeoutMs = 20_000)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) throw IOException("HTTP ${conn.responseCode}")
            val digest = MessageDigest.getInstance("SHA-256")
            var done = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(BUFFER)
                    while (true) {
                        if (cancelled) throw Cancelled()
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > release.size) throw UpdateError("Файл на сервере больше, чем сказано в описании. Попробуйте позже.")
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                        onProgress(done)
                    }
                }
            }
            if (done != release.size || digest.digest().hex() != release.sha256) {
                throw UpdateError("Файл скачался с ошибкой. Попробуйте ещё раз.")
            }
            if (!part.renameTo(apk)) throw IOException("Не удалось сохранить ${apk.name}")
            return apk
        } finally {
            conn.disconnect()
        }
    }

    /** Внутри — наше приложение, та версия, что обещана, и тот же ключ подписи, что у установленного. */
    private fun verify(apk: File, release: Release) {
        val pm = activity.packageManager
        val archive = packageInfo { flags -> archiveInfo(pm, apk, flags) }
            ?: throw UpdateError("Скачанный файл — не приложение. Сообщите команде.")
        if (archive.packageName != activity.packageName || PackageInfoCompat.getLongVersionCode(archive) != release.versionCode.toLong()) {
            throw UpdateError("На сервере не та сборка: ${archive.packageName} ${archive.versionName}. Сообщите команде.")
        }
        if (Build.VERSION.SDK_INT >= 28) {
            val installed = packageInfo { flags -> installedInfo(pm, flags) }
            val theirs = signers(archive)
            if (installed != null && theirs.isNotEmpty() && theirs != signers(installed)) throw KeyMismatch()
        }
    }

    /** Флаги запроса к PackageManager: с API 28 — вместе с сертификатами подписи. */
    private fun packageInfo(query: (Int) -> PackageInfo?): PackageInfo? =
        query(if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0)

    @Suppress("DEPRECATION")
    private fun archiveInfo(pm: PackageManager, apk: File, flags: Int): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(flags.toLong()))
        else pm.getPackageArchiveInfo(apk.path, flags)

    @Suppress("DEPRECATION")
    private fun installedInfo(pm: PackageManager, flags: Int): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(activity.packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        else pm.getPackageInfo(activity.packageName, flags)

    @RequiresApi(28)
    private fun signers(info: PackageInfo): Set<String> =
        info.signingInfo?.apkContentsSigners.orEmpty().map { sha256(it.toByteArray()) }.toSet()

    /** Сессия PackageInstaller: пишем APK, итог придёт в [installStatus]. */
    private fun commit(apk: File) {
        val installer = activity.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(activity.packageName)
            setSize(apk.length())
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                session.openWrite("space-map.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out, BUFFER) }
                    session.fsync(out)
                }
                val status = Intent(ACTION_INSTALL_STATUS).setPackage(activity.packageName)
                // Изменяемый: установщик дописывает в него итог.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(activity, id, status, flags).intentSender)
            }
        } catch (e: Exception) {
            installer.abandonSession(id)
            throw e
        }
    }

    private fun listenForInstaller() {
        if (receiverRegistered) return
        ContextCompat.registerReceiver(activity, installStatus, IntentFilter(ACTION_INSTALL_STATUS), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
    }

    private val installStatus = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val release = installing
            when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                // Окно системного установщика «Обновить приложение?».
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                    try {
                        activity.startActivity(confirm)
                    } catch (_: ActivityNotFoundException) {
                        if (release != null) failed(release, UpdateError("Не открылся установщик Android. Скачайте APK вручную."))
                    }
                }
                // Обычно сюда не доходим: Android закрывает приложение, чтобы заменить его.
                PackageInstaller.STATUS_SUCCESS -> busy = false
                PackageInstaller.STATUS_FAILURE_ABORTED -> {
                    busy = false
                    toast("Обновление отменено")
                }
                else -> {
                    val conflict = status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                    val reason = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    Log.w(TAG, "Установщик отказал: $status $reason")
                    if (release == null) busy = false
                    else failed(release, if (conflict) KeyMismatch() else UpdateError("Android не установил обновление (код $status). Попробуйте ещё раз."))
                }
            }
        }
    }

    private fun failed(release: Release, error: Throwable) {
        busy = false
        installing = null
        if (error is Cancelled) return
        Log.w(TAG, "Обновление не удалось", error)
        val text = when (error) {
            is KeyMismatch -> "Новая сборка подписана другим ключом, и Android не поставит её поверх этой. " +
                "Удалите приложение и установите заново по ссылке — это нужно один раз."
            is UpdateError -> error.message
            is IOException -> "Не удалось скачать. Проверьте интернет и попробуйте ещё раз."
            else -> "Не получилось обновить: ${error.message ?: error.javaClass.simpleName}"
        }
        if (!alive()) return
        AlertDialog.Builder(activity)
            .setTitle("Обновление не установлено")
            .setMessage(text)
            .setPositiveButton("Скачать вручную") { _, _ ->
                try {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(release.apk.toString())))
                } catch (_: ActivityNotFoundException) {
                    toast(release.apk.toString())
                }
            }
            .setNegativeButton("Закрыть", null)
            .show()
    }

    private fun alive() = !activity.isFinishing && !activity.isDestroyed

    private fun toast(text: String) = Toast.makeText(activity, text, Toast.LENGTH_LONG).show()

    private fun size(bytes: Long) = Formatter.formatShortFileSize(activity, bytes)

    private class UpdateError(message: String) : Exception(message)
    private class KeyMismatch : Exception("signing key mismatch")
    private class Cancelled : Exception("cancelled")

    private companion object {
        const val TAG = "SpaceMapUpdate"
        const val ACTION_INSTALL_STATUS = "ru.spacemap.android.INSTALL_STATUS"
        const val CHECK_EVERY_MS = 60 * 60 * 1000L
        const val BUFFER = 64 * 1024
        const val KEY_LATER_CODE = "later_version_code"
        const val KEY_LATER_AT = "later_at"

        fun open(url: URL, timeoutMs: Int) = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
        }

        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(BUFFER)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    digest.update(buf, 0, n)
                }
            }
            return digest.digest().hex()
        }

        fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()

        fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
    }
}
