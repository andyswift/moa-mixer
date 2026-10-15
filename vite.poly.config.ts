import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The poly synth on its own: `npm run build:poly` writes dist-poly/ (served from moaswift.no/poly/).
export default defineConfig({
  base: '/poly/',
  build: { outDir: 'dist-poly', rollupOptions: { input: { poly: resolve(import.meta.dirname, 'poly.html') } } },
});
