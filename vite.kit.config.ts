import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-KIT on its own: `npm run build:kit` writes dist-kit/ (served from moaswift.no/kit/).
export default defineConfig({
  base: '/kit/',
  build: { outDir: 'dist-kit', rollupOptions: { input: { kit: resolve(import.meta.dirname, 'kit.html') } } },
});
