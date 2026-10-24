// «Карта пространства» для Android: сайт в WebView и встроенная съёмка фотосферы (модуль :photosphere).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ru.spacemap.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.spacemap.android"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.1.1"
        // Откуда грузить сайт. Другой стенд: ./gradlew assembleDebug -PstartUrl=https://…
        val startUrl = (project.findProperty("startUrl") as String?) ?: "https://193-233-88-64.sslip.io/app"
        buildConfigField("String", "START_URL", "\"$startUrl\"")
    }

    buildTypes {
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
}
