import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-VOX on its own: `npm run build:vox` writes dist-vox/ (served from moaswift.no/vox/).
export default defineConfig({
  base: '/vox/',
  build: { outDir: 'dist-vox', rollupOptions: { input: { vox: resolve(import.meta.dirname, 'vox.html') } } },
});
