import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The band page on its own: `npm run build:band` writes dist-band/ (served from moaswift.no/band/).
export default defineConfig({
  base: '/band/',
  build: { outDir: 'dist-band', rollupOptions: { input: { band: resolve(import.meta.dirname, 'band.html') } } },
});
