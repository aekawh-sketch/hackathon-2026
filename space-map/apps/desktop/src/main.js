// «Карта пространства» для компьютера: тот же сайт в отдельном окне — кабинет, редактор, карты.
// Сервер выбирается в меню «Файл → Сервер»: стенд команды или локальный в Docker (docker compose up).
import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVERS = [
  { id: 'stand', label: 'Стенд команды', url: 'https://193-233-88-64.sslip.io/' },
  { id: 'local', label: 'Локальный сервер (Docker)', url: 'http://localhost:8000/' },
];

// ── Настройки: сервер и положение окна ──

const settingsFile = () => join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch {
    // Не записали — при следующем запуске будет сервер и окно по умолчанию.
  }
}

/** Адрес сайта: SPACE_MAP_URL (запуск из терминала) → выбранный в меню → стенд. */
function startUrl() {
  if (process.env.SPACE_MAP_URL) return process.env.SPACE_MAP_URL;
  return SERVERS.find((s) => s.id === loadSettings().server)?.url ?? SERVERS[0].url;
}

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

// ── Окно ──

let win = null;

/** Сервер не ответил — своя страница вместо пустого окна. */
function offlinePage(url, reason) {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Нет связи</title>
<style>body{margin:0;display:grid;place-items:center;height:100vh;font:15px/1.5 system-ui,sans-serif;background:#e9edf3;color:#0e1726}
@media (prefers-color-scheme:dark){body{background:#0d131d;color:#e8edf5}}
main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;opacity:.8}
a{display:inline-block;padding:10px 18px;border-radius:12px;background:#2f5bea;color:#fff;text-decoration:none;font-weight:600}</style>
<main><h1>Сервер не отвечает</h1><p>${url} — ${reason}. Проверьте интернет или запустите локальный сервер (docker compose up) и выберите его в меню «Файл → Сервер».</p>
<a href="${url}">Повторить</a></main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const bounds = loadSettings().bounds ?? { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 560,
    title: 'Карта пространства',
    // Пока страница грузится — фон под тему системы, без белой вспышки.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d131d' : '#e9edf3',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} SpaceMapDesktop/${app.getVersion()}`);

  const site = () => origin(startUrl());
  // Свой сайт — в окне, всё остальное (ссылки наружу) — в браузере по умолчанию.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (origin(url) === site()) {
      win.loadURL(url);
    } else if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('data:') || origin(url) === site()) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 — загрузку отменили сами (переход на другую страницу), это не ошибка.
    if (!isMainFrame || code === -3) return;
    void win.loadURL(offlinePage(url || startUrl(), description || `ошибка ${code}`));
  });

  const remember = () => {
    if (!win || win.isMinimized() || win.isFullScreen()) return;
    saveSettings({ bounds: win.getBounds() });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('closed', () => {
    win = null;
  });

  void win.loadURL(startUrl());
}

// ── Меню ──

function buildMenu() {
  const current = loadSettings().server ?? 'stand';
  const mac = process.platform === 'darwin';
  const serverItems = SERVERS.map((s) => ({
    label: `${s.label} — ${new URL(s.url).host}`,
    type: 'radio',
    checked: !process.env.SPACE_MAP_URL && s.id === current,
    enabled: !process.env.SPACE_MAP_URL,
    click: () => {
      saveSettings({ server: s.id });
      void win?.loadURL(s.url);
    },
  }));
  const template = [
    ...(mac ? [{ role: 'appMenu', label: 'Карта пространства' }] : []),
    {
      label: 'Файл',
      submenu: [
        { label: 'Все карты', accelerator: 'CmdOrCtrl+Shift+H', click: () => void win?.loadURL(new URL('/', startUrl()).toString()) },
        { label: 'Кабинет организатора', accelerator: 'CmdOrCtrl+Shift+O', click: () => void win?.loadURL(new URL('/app', startUrl()).toString()) },
        { type: 'separator' },
        { label: 'Сервер', submenu: serverItems },
        { type: 'separator' },
        mac ? { role: 'close', label: 'Закрыть окно' } : { role: 'quit', label: 'Выход' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Назад', accelerator: 'CmdOrCtrl+[', click: () => win?.webContents.navigationHistory.goBack() },
        { label: 'Вперёд', accelerator: 'CmdOrCtrl+]', click: () => win?.webContents.navigationHistory.goForward() },
        { role: 'reload', label: 'Обновить' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный масштаб' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Во весь экран' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    { role: 'windowMenu', label: 'Окно' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Запуск ──

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Камера — только своему сайту (сканер QR-кода проекта); остальное по умолчанию запрещено.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      const own = origin(wc.getURL()) === origin(startUrl());
      callback(own && ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
