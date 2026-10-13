import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Both pages share the same source. `npm run dev` serves /index.html (the mixer) and /pipe.html (MOA-PIPE);
// the mixer's production build is the default, MOA-PIPE has its own (vite.pipe.config.ts).
export default defineConfig({
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), pipe: resolve(import.meta.dirname, 'pipe.html') } } },
});
