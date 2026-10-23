import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
