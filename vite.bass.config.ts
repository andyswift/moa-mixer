import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-BASS on its own: `npm run build:bass` writes dist-bass/ (served from moaswift.no/bass/).
export default defineConfig({
  base: '/bass/',
  build: { outDir: 'dist-bass', rollupOptions: { input: { bass: resolve(import.meta.dirname, 'bass.html') } } },
});
