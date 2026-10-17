import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The bus comp on its own: `npm run build:buscomp` writes dist-buscomp/ (served from moaswift.no/buscomp/).
export default defineConfig({
  base: '/buscomp/',
  build: { outDir: 'dist-buscomp', rollupOptions: { input: { buscomp: resolve(import.meta.dirname, 'buscomp.html') } } },
});
