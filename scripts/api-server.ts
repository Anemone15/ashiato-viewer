// HTTP API サーバー。既定ではこの Mac の中（127.0.0.1）からだけ接続できる。
//
//   npm run api:serve                       # http://127.0.0.1:5190/api
//   npm run api:serve -- --port 5191
//   ASHIATO_API_TOKEN=秘密 npm run api:serve -- --host 0.0.0.0   # LAN に公開する場合はトークン必須
import http from 'node:http';
import { getEngine } from '../src/api/engine';
import { handleApi } from '../src/api/http';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const host = opt('host') ?? process.env.ASHIATO_API_HOST ?? '127.0.0.1';
const port = Number(opt('port') ?? process.env.ASHIATO_API_PORT ?? 5190);
const token = process.env.ASHIATO_API_TOKEN || undefined;
const dataDir = opt('data-dir');
const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';

if (!local && !token) {
  console.error('LAN などに公開する場合は ASHIATO_API_TOKEN を設定してください（位置履歴が他の端末から読めてしまうため）');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (!req.url?.startsWith('/api')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'API は /api 以下です。GET /api で一覧を返します' }));
    return;
  }
  handleApi(req, res, { token, dataDir });
});

server.listen(port, host, () => {
  // 起動時に一度解析しておく（最初のリクエストを速くする）
  try {
    const e = getEngine({ dataDir });
    console.error(`解析済み: ${e.a.trips.length} 件の移動（${e.ms}ms）`);
  } catch (err) {
    console.error(String(err));
  }
  console.error(`足跡ビューア API: http://${host}:${port}/api${token ? '（トークン認証あり）' : ''}`);
});
