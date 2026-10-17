import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-2600 on its own: `npm run build:2600` writes dist-2600/ (served from moaswift.no/2600/).
export default defineConfig({
  base: '/2600/',
  build: { outDir: 'dist-2600', rollupOptions: { input: { m2600: resolve(import.meta.dirname, '2600.html') } } },
});
