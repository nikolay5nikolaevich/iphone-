import { defineConfig } from 'vite';
import { handle } from './api/data.js';

// В npm run dev функция /api/data работает прямо в Vite (данные в памяти), на Vercel — как серверная функция.
const api = {
  name: 'api',
  configureServer(server) {
    server.middlewares.use('/api/data', async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      res.setHeader('Content-Type', 'application/json');
      try {
        const path = new URL(req.url, 'http://local').searchParams.get('path') || '';
        res.end(JSON.stringify(await handle(req.method, path, raw ? JSON.parse(raw) : undefined, req.headers['x-token'])));
      } catch (err) {
        res.statusCode = err.message === 'auth' ? 401 : 400;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  },
};

export default defineConfig({ root: 'public', plugins: [api], build: { outDir: '../dist', emptyOutDir: true } });
