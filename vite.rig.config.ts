import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MOA-RIG on its own: `npm run build:rig` writes dist-rig/ (served from moaswift.no/rig/).
export default defineConfig({
  base: '/rig/',
  build: { outDir: 'dist-rig', rollupOptions: { input: { rig: resolve(import.meta.dirname, 'rig.html') } } },
});
