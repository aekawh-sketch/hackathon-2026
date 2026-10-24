// Съёмка фотосферы готовым приложением: 360-photo-app (MIT, github.com/n30dyn4m1c/360-photo-app).
// Оно ведёт по точкам сферы по гироскопу — белые стены и ARCore ему не нужны — и склеивает кадры
// с уточнением по общим точкам и мягкими швами. Результат — JPEG 2:1, его загружают в точку съёмки.
// Встроить его в сайт нельзя (это приложение Android), поэтому открываем его и ждём файл обратно.

export const APP_NAME = '360-photo-app';
/** Отладочная сборка из выпуска v0.1.0-debug: у неё суффикс `.debug` в имени пакета. */
const APP_PACKAGE = 'com.n30dyn4m1c.photosphere.debug';
export const APP_APK = 'https://github.com/n30dyn4m1c/360-photo-app/releases/download/v0.1.0-debug/360-photo-app-arm64-v8a-debug.apk';
export const APP_REPO = 'https://github.com/n30dyn4m1c/360-photo-app';

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** Ссылка, которая открывает приложение; если его нет — Chrome скачивает APK. */
export function appIntentUrl(): string {
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(APP_APK)};end`;
}
