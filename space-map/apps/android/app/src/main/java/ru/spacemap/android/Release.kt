package ru.spacemap.android

import org.json.JSONObject
import java.net.URI

/**
 * Сборка, которую предлагает стенд: файл `/downloads/space-map.json` рядом с APK. Его пишет `tools/publish-android.sh`:
 *
 * ```json
 * { "versionCode": 6, "versionName": "0.2.1", "apk": "space-map-6.apk", "size": 43952034,
 *   "sha256": "…", "notes": ["Что нового"], "minVersionCode": 0 }
 * ```
 */
data class Release(
    val versionCode: Int,
    val versionName: String,
    /** Адрес APK — всегда на том же сервере, что и описание. */
    val apk: URI,
    val size: Long,
    /** SHA-256 файла строчными hex-цифрами. */
    val sha256: String,
    val notes: List<String>,
    /** Сборки ниже этой обязаны обновиться — кнопки «Позже» у них нет. 0 — обязательных обновлений нет. */
    val minVersionCode: Int,
) {
    companion object {
        private val SHA256 = Regex("^[0-9a-f]{64}$")

        /** Наш APK с OpenCV весит ~45 МБ; больше 200 МБ — точно не он. */
        private const val MAX_SIZE = 200L * 1024 * 1024

        /** [source] — откуда скачано описание: относительный адрес APK считается от него. */
        fun parse(json: JSONObject, source: URI): Release {
            val apk = source.resolve(json.getString("apk"))
            require(apk.scheme == source.scheme && apk.host == source.host && apk.port == source.port) {
                "APK не на том сервере, что описание: $apk"
            }
            val sha256 = json.getString("sha256").lowercase()
            require(SHA256.matches(sha256)) { "sha256 — не 64 hex-цифры" }
            val size = json.getLong("size")
            require(size in 1..MAX_SIZE) { "Странный размер APK: $size" }
            val notes = json.optJSONArray("notes")
            return Release(
                versionCode = json.getInt("versionCode"),
                versionName = json.getString("versionName"),
                apk = apk,
                size = size,
                sha256 = sha256,
                notes = if (notes == null) emptyList() else List(notes.length()) { notes.getString(it) },
                minVersionCode = json.optInt("minVersionCode", 0),
            )
        }
    }
}

/** Пользователь нажал «Позже»: на какой сборке ([versionCode]) и когда ([at], мс). */
data class Postponed(val versionCode: Int, val at: Long)

/**
 * Показать ли предложение обновиться прямо сейчас. Зовётся при каждом заходе в приложение, когда на стенде
 * нашлась сборка новее установленной ([installed] — её versionCode).
 */
fun shouldOffer(release: Release, installed: Int, postponed: Postponed?, now: Long): Boolean {
    if (release.versionCode <= installed) return false
    if (release.minVersionCode > installed) return true
    // TODO(команда): что делает «Позже». Сейчас — ничего: при следующем заходе спросим снова.
    //  Варианты: не спрашивать про эту же сборку N часов; не спрашивать про неё совсем, пока не выйдет следующая.
    return true
}
