# Приложение для Android

Сайт «Карты пространства» в WebView — тот же кабинет и карта, что в браузере, — плюс встроенная съёмка фотосферы.

- `app/` — `MainActivity` (WebView со стендом, камера для разметки «по шагам», выбор файлов) и `CaptureActivity` (экран съёмки).
- `photosphere/` — съёмка и склейка из [360-photo-app](https://github.com/n30dyn4m1c/360-photo-app) (MIT, см. `photosphere/LICENSE`):
  точки на сфере, автоснимок, когда телефон замер, поворот по гироскопу (белые стены и ARCore не нужны),
  склейка с уточнением по общим точкам и мягкими швами. Своё — только перевод строк на русский и подключение как библиотеки.

## Как сайт снимает фотосферу

1. Страница (`apps/web/src/capture/native.ts`) вызывает `SpaceMapAndroid.capturePhotoSphere(id)`.
2. Приложение открывает `CaptureActivity`; готовую сферу (JPEG 2:1) отдаёт странице по адресу `/__native/sphere/<id>.jpg`
   на её же домене и вызывает `window.__spaceMapNative(id, { url, width, height })` (или `{ cancelled, reason }`).
3. Страница забирает файл `fetch`-ем и загружает его на сервер своей сессией — панорама встаёт в точку съёмки.
   Направление панорамы задают в редакторе: «Открыть панораму» → «Повернуть по двери».

## Сборка

```bash
cd space-map/apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # путь к Android SDK
./gradlew :app:assembleDebug                                 # JDK 21 Gradle скачает сам
# APK: app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

Другой стенд: `./gradlew :app:assembleDebug -PstartUrl=https://адрес/app`. Собирается только arm64-v8a — OpenCV под все процессоры весит ~120 МБ.
