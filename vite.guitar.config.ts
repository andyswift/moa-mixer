import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-GUITAR on its own: `npm run build:guitar` writes dist-guitar/ (served from moaswift.no/guitar/).
export default defineConfig({
  base: '/guitar/',
  build: { outDir: 'dist-guitar', rollupOptions: { input: { guitar: resolve(import.meta.dirname, 'guitar.html') } } },
});
