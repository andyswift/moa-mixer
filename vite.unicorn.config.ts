import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-UNICORN on its own: `npm run build:unicorn` writes dist-unicorn/ (served from moaswift.no/unicorn/).
export default defineConfig({
  base: '/unicorn/',
  build: { outDir: 'dist-unicorn', rollupOptions: { input: { unicorn: resolve(import.meta.dirname, 'unicorn.html') } } },
});
