import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Lynch 106 on its own: `npm run build:lynch` writes dist-lynch/ (served from moaswift.no/lynch/).
export default defineConfig({
  base: '/lynch/',
  build: { outDir: 'dist-lynch', rollupOptions: { input: { lynch: resolve(import.meta.dirname, 'lynch.html') } } },
});
