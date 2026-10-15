import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA Records on its own: `npm run build:records` writes dist-records/ (served from moaswift.no/records/).
export default defineConfig({
  base: '/records/',
  build: { outDir: 'dist-records', rollupOptions: { input: { records: resolve(import.meta.dirname, 'records.html') } } },
});
