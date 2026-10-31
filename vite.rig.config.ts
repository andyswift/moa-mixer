import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// In dev, the page posts its working multi and saved sounds here as they change (see rigMain.ts); when RIG_STATE names
// a file, the server keeps the latest there, so the rig's state can be read from outside the browser.
const devState: Plugin = {
  name: 'rig-dev-state',
  configureServer(server) {
    server.middlewares.use('/__rig-state', (req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (process.env.RIG_STATE) writeFileSync(process.env.RIG_STATE, body);
        res.statusCode = 204;
        res.end();
      });
    });
  },
};

// MOA-RIG on its own: `npm run build:rig` writes dist-rig/ (served from moaswift.no/rig/).
export default defineConfig({
  base: '/rig/',
  plugins: [devState],
  build: { outDir: 'dist-rig', rollupOptions: { input: { rig: resolve(import.meta.dirname, 'rig.html') } } },
});
