import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-SEQ on its own: `npm run build:seq` writes dist-seq/ (served from moaswift.no/seq/).
export default defineConfig({
  base: '/seq/',
  build: { outDir: 'dist-seq', rollupOptions: { input: { seq: resolve(import.meta.dirname, 'seq.html') } } },
});
