// Приложение «Карта пространства» для Android: WebView с сайтом + встроенная съёмка фотосферы.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    // Gradle сам скачает JDK 21 для сборки (gradle/gradle-daemon-jvm.properties).
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // OpenCV для Android (org.opencv:opencv) лежит здесь.
        mavenCentral()
    }
}

rootProject.name = "SpaceMapAndroid"
include(":app", ":photosphere")
