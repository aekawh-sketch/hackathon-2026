# Карта пространства — приложение для iPhone и iPad

Тот же сайт в WKWebView (SwiftUI): кабинет, редактор, карты, 3D. Свои страницы — внутри приложения, чужие ссылки —
в Safari; свайп от края — назад. Камера (сканер QR-кода, съёмка «по шагам») и датчики ориентации разрешены только
своему сайту, загрузка готовой панорамы — из галереи. Нативной съёмки фотосферы, как в приложении для Android,
здесь нет: на iPhone работает съёмка в браузере и загрузка готовой панорамы 2:1.

## Открыть и запустить

Нужен Mac с Xcode 16 или новее.

1. Открыть `SpaceMap.xcodeproj`.
2. Цель **SpaceMap** → Signing & Capabilities → выбрать свою команду (Personal Team с Apple ID подходит для своего телефона).
3. Выбрать iPhone или симулятор и нажать Run.

Сервер — build setting `SPACE_MAP_START_URL` в `project.yml` (по умолчанию стенд команды). Локальный сервер в Docker —
по адресу компьютера в сети, например `http://192.168.1.10:8000/app` (http разрешён только для локальной сети).

## Проект

`SpaceMap.xcodeproj` сгенерирован из `project.yml` утилитой XcodeGen. Поменяли `project.yml` — пересоздать:

```bash
brew install xcodegen
cd space-map/apps/ios && xcodegen generate
```

Сборка для симулятора без подписи (то же делает GitHub Actions, `.github/workflows/ios.yml`):

```bash
xcodebuild -project SpaceMap.xcodeproj -scheme SpaceMap -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```
