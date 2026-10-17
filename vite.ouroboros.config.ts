import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The ouroboros on its own: `npm run build:ouroboros` writes dist-ouroboros/ (served from moaswift.no/ouroboros/).
export default defineConfig({
  base: '/ouroboros/',
  build: { outDir: 'dist-ouroboros', rollupOptions: { input: { ouroboros: resolve(import.meta.dirname, 'ouroboros.html') } } },
});
