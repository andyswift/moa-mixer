import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-DUO on its own: `npm run build:duo` writes dist-duo/ (served from moaswift.no/duo/).
export default defineConfig({
  base: '/duo/',
  build: { outDir: 'dist-duo', rollupOptions: { input: { duo: resolve(import.meta.dirname, 'duo.html') } } },
});
