import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { attachGameServer, handleApi } from './server/game';

// In development the authoritative game server rides on Vite's own HTTP server,
// so `npm run dev` is the only process you need.
function gameServer(): Plugin {
  return {
    name: 'imposterverse-game-server',
    configureServer(server) {
      if (!server.httpServer) return;
      const game = attachGameServer(server.httpServer as any);
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/') && handleApi(game, req, res)) return;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gameServer()],
  server: { port: 5173, strictPort: false },
  build: { chunkSizeWarningLimit: 2500 },
});
