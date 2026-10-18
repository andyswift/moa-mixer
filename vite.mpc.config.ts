import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-60 on its own: `npm run build:mpc` writes dist-mpc/ (served from moaswift.no/mpc/).
export default defineConfig({
  base: '/mpc/',
  build: { outDir: 'dist-mpc', rollupOptions: { input: { mpc: resolve(import.meta.dirname, 'mpc.html') } } },
});
