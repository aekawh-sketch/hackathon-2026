// «Карта пространства» для Android: сайт в WebView и встроенная съёмка фотосферы (модуль :photosphere).
import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Откуда грузить сайт. Другой стенд: ./gradlew assembleDebug -PstartUrl=https://…
val startUrl = (project.findProperty("startUrl") as String?) ?: "https://193-233-88-64.sslip.io/app"
// Где приложение узнаёт о новой сборке (см. AppUpdater): по умолчанию на том же сервере, что и сайт.
val updateUrl = (project.findProperty("updateUrl") as String?)
    ?: URI(startUrl).resolve("/downloads/space-map.json").toString()

android {
    namespace = "ru.spacemap.android"
    compileSdk = 37

    // Один ключ на всю команду, лежит в репозитории: APK с любого компьютера ставится поверх установленного,
    // и приложение может обновить само себя. Сборку, подписанную другим ключом, Android поверх не поставит.
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("keystore/team-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    defaultConfig {
        applicationId = "ru.spacemap.android"
        minSdk = 26
        targetSdk = 37
        // Каждая выкладка на стенд — versionCode на 1 больше: по нему телефоны понимают, что вышла новая сборка.
        versionCode = 6
        versionName = "0.2.1"
        buildConfigField("String", "START_URL", "\"$startUrl\"")
        buildConfigField("String", "UPDATE_URL", "\"$updateUrl\"")
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // Чьи ссылки открывает приложение (QR-код проекта) — домен стенда.
        manifestPlaceholders["linkHost"] = URI(startUrl).host
    }

    buildTypes {
        debug {
            // Локальный стенд по Wi-Fi: нативная камера работает и без HTTPS.
            manifestPlaceholders["usesCleartextTraffic"] = startUrl.startsWith("http://").toString()
        }
        release {
            isMinifyEnabled = false
        }
    }

    // OpenCV везёт библиотеки под все процессоры (~120 МБ). Телефоны — arm64, собираем только его.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a")
            isUniversalApk = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation(project(":photosphere"))

    testImplementation(libs.junit)
    // В юнит-тестах вместо заглушки org.json из android.jar — настоящая библиотека.
    testImplementation(libs.json)
}
