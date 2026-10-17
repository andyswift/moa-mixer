import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The granular on its own: `npm run build:granular` writes dist-granular/ (served from moaswift.no/granular/).
export default defineConfig({
  base: '/granular/',
  build: { outDir: 'dist-granular', rollupOptions: { input: { granular: resolve(import.meta.dirname, 'granular.html') } } },
});
