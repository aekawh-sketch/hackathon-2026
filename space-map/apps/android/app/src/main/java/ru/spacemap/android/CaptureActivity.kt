package ru.spacemap.android

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.n30dyn4m1c.photosphere.camera.PhotoSphereCameraScreen
import com.n30dyn4m1c.photosphere.ui.theme.PhotoSphereTheme

/**
 * Съёмка фотосферы экраном модуля :photosphere (360-photo-app): точки на сфере, автоснимок, когда телефон замер,
 * склейка с уточнением по общим точкам. Готовая сфера — JPEG 2:1 в кэше приложения — уходит обратно
 * в [MainActivity] путём к файлу, а оттуда на страницу сайта.
 *
 * Право на камеру проверяет [MainActivity] до запуска.
 */
class CaptureActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Тёмный видоискатель — светлые значки в строке состояния, как в исходном приложении.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            PhotoSphereTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    PhotoSphereCameraScreen(
                        onSphereReady = { sphere ->
                            setResult(
                                RESULT_OK,
                                Intent()
                                    .putExtra(EXTRA_PATH, sphere.file.absolutePath)
                                    .putExtra(EXTRA_WIDTH, sphere.width)
                                    .putExtra(EXTRA_HEIGHT, sphere.height),
                            )
                            finish()
                        },
                    )
                }
            }
        }
    }

    companion object {
        const val EXTRA_PATH = "path"
        const val EXTRA_WIDTH = "width"
        const val EXTRA_HEIGHT = "height"
    }
}
