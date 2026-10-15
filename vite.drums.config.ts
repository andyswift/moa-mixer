import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The drum machine on its own: `npm run build:drums` writes dist-drums/ (served from moaswift.no/drums/).
export default defineConfig({
  base: '/drums/',
  build: { outDir: 'dist-drums', rollupOptions: { input: { drums: resolve(import.meta.dirname, 'drums.html') } } },
});
