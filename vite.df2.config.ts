import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-DF2 on its own: `npm run build:df2` writes dist-df2/ (served from moaswift.no/df2/).
export default defineConfig({
  base: '/df2/',
  build: { outDir: 'dist-df2', rollupOptions: { input: { df2: resolve(import.meta.dirname, 'df2.html') } } },
});
