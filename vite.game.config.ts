import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Virtual Rockstar, the band game: `npm run build:game` writes dist-game/ (served from moaswift.no/game/).
export default defineConfig({
  base: '/game/',
  build: { outDir: 'dist-game', rollupOptions: { input: { game: resolve(import.meta.dirname, 'game.html') } } },
});
