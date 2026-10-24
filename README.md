# Карта пространства

Сервис интерактивных карт зданий и площадок: 2D-план, фотосферы 360° и маршруты внутри здания. Кейс ТТК, хакатон 2026.

- **Организатор** в браузере или приложении рисует план (комнаты, стены, двери, зоны), ставит места со своими категориями,
  снимает фотосферы телефоном или загружает готовые панорамы, публикует карту по постоянной ссылке или кодом `<iframe>`.
- **Посетитель** без регистрации открывает карту на телефоне: 3D и план, поиск мест, карточки, маршрут по проходам
  и прогулка по нему в панорамах.

Стенд: https://193-233-88-64.sslip.io — «Все карты», кабинет — `/app`.

## Состав

```
space-map/
  packages/map-core/   ядро карты на TypeScript: геометрия, граф проходов, маршруты, точки съёмки, слияние правок
  apps/web/            сайт: карта посетителя, «Все карты», кабинет и редактор (React, Konva, Photo Sphere Viewer, three.js)
  services/api/        сервер: Fastify, PostgreSQL (Drizzle), вход, площадки, публикация, панорамы
  apps/android/        приложение для Android: сайт + встроенная съёмка и склейка фотосферы
  apps/desktop/        приложение для компьютера (Electron): macOS, Windows, Linux
  apps/ios/            приложение для iPhone и iPad (SwiftUI + WKWebView)
  infra/               настройки веб-сервера для Docker
  docs/                STATUS — что сделано и проверено, DECISIONS — принятые решения
  TZ.md                техническое задание
```

## Локальный сервер в Docker

Нужен Docker с Compose.

```bash
cd space-map
cp .env.example .env        # задать DEMO_PASSWORD — появится демо-площадка
docker compose up -d --build
```

Откройте http://localhost:8000. База и файлы хранятся в томах Docker и переживают перезапуск и пересборку.
Остановить — `docker compose down` (данные остаются), стереть всё — `docker compose down -v`.

## Разработка без Docker

Нужны Node.js 22 и PostgreSQL.

```bash
cd space-map
npm install
createdb spacemap && createdb spacemap_test
cp services/api/.env.example services/api/.env   # и задать DEMO_PASSWORD
npm run seed -w services/api                    # миграции, демо-организатор, площадка demo
npm run dev:api                                 # http://localhost:8080, описание API — /api/docs
npm run dev:web                                 # http://localhost:5173
```

Проверки:

```bash
npm test             # ядро, сайт, API (API — на базе spacemap_test)
npm run typecheck
```

## Приложения

- **Android** — [space-map/apps/android](space-map/apps/android/README.md); готовый APK — «Скачать приложение» на стенде.
- **Компьютер** — [space-map/apps/desktop](space-map/apps/desktop/README.md): `npm install && npm start`, сборка `npm run dist:mac`.
- **iPhone и iPad** — [space-map/apps/ios](space-map/apps/ios/README.md): открыть `SpaceMap.xcodeproj` в Xcode.

Все три открывают тот же сайт: стенд команды по умолчанию, локальный сервер — в настройках каждого приложения.

## Работа в репозитории

- `main` — рабочий код. Задачи делаются в своих ветках и вливаются через Pull Request.
- Перед началом работы — `git pull`, после этапа — обновить `space-map/docs/STATUS.md`.
