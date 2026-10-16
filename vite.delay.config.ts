import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The delay on its own: `npm run build:delay` writes dist-delay/ (served from moaswift.no/delay/).
export default defineConfig({
  base: '/delay/',
  build: { outDir: 'dist-delay', rollupOptions: { input: { delay: resolve(import.meta.dirname, 'delay.html') } } },
});
