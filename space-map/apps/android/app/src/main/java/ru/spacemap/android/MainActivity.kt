package ru.spacemap.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * Сайт «Карты пространства» в WebView — тот же интерфейс, что в браузере, — плюс то, чего браузер не умеет:
 * съёмка фотосферы встроенным модулем :photosphere.
 *
 * Мост со страницей:
 * - страница вызывает `SpaceMapAndroid.capturePhotoSphere(id)`;
 * - приложение открывает [CaptureActivity], а по готовности вызывает `window.__spaceMapNative(id, результат)`:
 *   `{ url, width, height }` или `{ cancelled: true, reason }`;
 * - снимок страница забирает обычным `fetch(url)`: адрес `/__native/sphere/<id>.jpg` на своём же домене
 *   приложение отдаёт из файла, не гоняя мегабайты через JavaScript. Загружает на сервер уже страница —
 *   со своей сессией и CSRF, как любой другой файл.
 *
 * При заходе проверяет, нет ли на стенде сборки новее, и предлагает обновиться ([AppUpdater]).
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private val start: Uri by lazy { Uri.parse(BuildConfig.START_URL) }
    private val updater = AppUpdater(this)

    /** Снятые сферы по ID запроса страницы. */
    private val spheres = ConcurrentHashMap<String, File>()
    private var pendingCapture: String? = null
    private var afterCamera: ((Boolean) -> Unit)? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val captureLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val id = pendingCapture ?: return@registerForActivityResult
        pendingCapture = null
        val data = result.data
        val path = data?.getStringExtra(CaptureActivity.EXTRA_PATH)
        if (result.resultCode == RESULT_OK && path != null) {
            spheres[id] = File(path)
            notifyPage(
                id,
                JSONObject()
                    .put("url", "$SPHERE_PATH$id.jpg")
                    .put("width", data.getIntExtra(CaptureActivity.EXTRA_WIDTH, 0))
                    .put("height", data.getIntExtra(CaptureActivity.EXTRA_HEIGHT, 0)),
            )
        } else {
            notifyPage(id, JSONObject().put("cancelled", true).put("reason", "user"))
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val then = afterCamera
        afterCamera = null
        if (!granted) Toast.makeText(this, R.string.camera_needed, Toast.LENGTH_LONG).show()
        then?.invoke(granted)
    }

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val localNetworkPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) web.loadUrl(BuildConfig.START_URL)
        else AlertDialog.Builder(this)
            .setTitle("Нет доступа к локальному стенду")
            .setMessage("Для подключения к компьютеру по Wi-Fi разрешите доступ к устройствам поблизости. Телефон и компьютер должны быть в одной сети.")
            .setPositiveButton("Повторить") { _, _ -> requestLocalNetwork() }
            .setNegativeButton("Закрыть") { _, _ -> finish() }
            .show()
    }

    private fun requestLocalNetwork() {
        localNetworkPermission.launch("android.permission.ACCESS_LOCAL_NETWORK")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Отладочная сборка: страницу можно смотреть в Chrome DevTools (chrome://inspect) через USB.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        val root = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
        }
        setContentView(root)
        // Отодвигаем WebView от системных панелей: его HTML viewport не
        // включает их в область страницы и заголовок не уходит под статус-бар.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            (web.layoutParams as FrameLayout.LayoutParams).also { params ->
                params.setMargins(safe.left, safe.top, safe.right, safe.bottom)
                web.layoutParams = params
            }
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            // По этой метке страница понимает, что она в приложении.
            userAgentString = "$userAgentString SpaceMapAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "SpaceMapAndroid")
        web.webViewClient = PageClient()
        web.webChromeClient = ChromeClient()

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) web.goBack() else finish()
        }

        val needsLocalPermission = BuildConfig.DEBUG && start.scheme == "http" && Build.VERSION.SDK_INT >= 37 &&
            ContextCompat.checkSelfPermission(this, "android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED
        if (needsLocalPermission) requestLocalNetwork()
        else if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(BuildConfig.START_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onStart() {
        super.onStart()
        updater.checkOnEnter()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        updater.close()
        web.destroy()
        super.onDestroy()
    }

    /** Методы, которые видит страница. Вызываются не в главном потоке — работу переносим туда. */
    private inner class Bridge {
        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun capturePhotoSphere(requestId: String) {
            runOnUiThread { startCapture(requestId) }
        }
    }

    private fun startCapture(id: String) {
        if (!ID.matches(id)) return
        if (pendingCapture != null) {
            notifyPage(id, JSONObject().put("cancelled", true).put("reason", "busy"))
            return
        }
        pendingCapture = id
        withCamera { granted ->
            if (granted) {
                captureLauncher.launch(Intent(this, CaptureActivity::class.java))
            } else {
                pendingCapture = null
                notifyPage(id, JSONObject().put("cancelled", true).put("reason", "camera"))
            }
        }
    }

    private fun withCamera(then: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            then(true)
        } else {
            afterCamera = then
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun notifyPage(id: String, result: JSONObject) {
        web.evaluateJavascript("window.__spaceMapNative && window.__spaceMapNative(${JSONObject.quote(id)}, $result)", null)
    }

    private fun isOurs(uri: Uri): Boolean =
        uri.scheme == start.scheme && uri.host == start.host && uri.port == start.port

    private inner class PageClient : WebViewClient() {
        /** Свой сайт — в приложении, всё остальное (ссылки наружу, intent:) — системе. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (isOurs(request.url)) return false
            try {
                startActivity(
                    if (request.url.scheme == "intent") Intent.parseUri(request.url.toString(), Intent.URI_INTENT_SCHEME)
                    else Intent(Intent.ACTION_VIEW, request.url),
                )
            } catch (_: ActivityNotFoundException) {
            } catch (_: java.net.URISyntaxException) {
            }
            return true
        }

        /** `/__native/sphere/<id>.jpg` — снятая сфера из файла; остальное — как обычно, с сервера. */
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val uri = request.url
            if (!isOurs(uri) || uri.path?.startsWith(SPHERE_PATH) != true) return null
            val id = uri.lastPathSegment?.removeSuffix(".jpg") ?: return null
            val file = spheres[id]?.takeIf { it.isFile }
                ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            return WebResourceResponse("image/jpeg", null, 200, "OK", mapOf("Cache-Control" to "no-store"), FileInputStream(file))
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        /** Камера для страницы (разметка маршрута «по шагам»): только своему сайту и только с правом приложения. */
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                val camera = PermissionRequest.RESOURCE_VIDEO_CAPTURE
                if (!isOurs(request.origin) || camera !in request.resources) {
                    request.deny()
                    return@runOnUiThread
                }
                withCamera { granted -> if (granted) request.grant(arrayOf(camera)) else request.deny() }
            }
        }

        /** `<input type="file">` на странице — системный выбор файла (загрузка готовой панорамы, карты из файла). */
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                fileChooser.launch(params.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }
    }

    private companion object {
        const val SPHERE_PATH = "/__native/sphere/"
        val ID = Regex("^[A-Za-z0-9_-]{1,40}$")
    }
}
