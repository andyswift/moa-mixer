import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-PIPE on its own: `npm run build:pipe` writes dist-pipe/ (served from moaswift.no/pipe/).
export default defineConfig({
  base: '/pipe/',
  build: { outDir: 'dist-pipe', rollupOptions: { input: { pipe: resolve(import.meta.dirname, 'pipe.html') } } },
});
