import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The mono synth on its own: `npm run build:synth` writes dist-synth/ (served from moaswift.no/synth/).
export default defineConfig({
  base: '/synth/',
  build: { outDir: 'dist-synth', rollupOptions: { input: { synth: resolve(import.meta.dirname, 'synth.html') } } },
});
