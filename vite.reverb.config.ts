import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The reverb on its own: `npm run build:reverb` writes dist-reverb/ (served from moaswift.no/reverb/).
export default defineConfig({
  base: '/reverb/',
  build: { outDir: 'dist-reverb', rollupOptions: { input: { reverb: resolve(import.meta.dirname, 'reverb.html') } } },
});
