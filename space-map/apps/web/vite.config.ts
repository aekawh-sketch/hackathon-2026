import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteDevServer } from 'vite';

/** Vite не знает MIME для APK: отдаём файл как загрузку, а при его отсутствии — 404 вместо SPA. */
function androidDownload(server: Pick<ViteDevServer, 'middlewares'>) {
  const apk = fileURLToPath(new URL('./public/downloads/space-map.apk', import.meta.url));
  server.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/downloads/space-map.apk') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const info = await stat(apk).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Сборка приложения пока недоступна');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="space-map.apk"',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(apk).on('error', () => res.destroy()).pipe(res);
  });
}

export default defineConfig({
  plugins: [react(), { name: 'android-download', configureServer: androidDownload, configurePreviewServer: androidDownload }],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/p': 'http://localhost:8080',
      '/files': 'http://localhost:8080',
    },
  },
  build: {
    // Панорамы (Photo Sphere Viewer) и 3D (three.js) подключаются через lazy() — уходят в отдельные чанки сами;
    // посетитель качает их только при первом открытии панорамы или 3D.
    chunkSizeWarningLimit: 800,
  },
});
