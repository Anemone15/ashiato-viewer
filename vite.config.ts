import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * data/ フォルダに置いた CSV を /userdata/ で配信する（Mac で起動したサーバーを iPhone から開いたときに使う）。
 * index.json はファイル名・サイズ・更新時刻の一覧。
 */
function userData(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'data');
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/userdata/')) return next();
    const name = decodeURIComponent(req.url.slice('/userdata/'.length).split('?')[0]);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort() : [];
    if (name === 'index.json') {
      const list = files.map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(list));
      return;
    }
    if (!files.includes(name)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(dir, name)).pipe(res);
  };
  return {
    name: 'user-data',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), userData()],
  server: { port: 5180 },
  preview: { port: 5180 },
  build: { chunkSizeWarningLimit: 2000 },
});
