// HTTP API のリクエスト処理（scripts/api-server.ts から使う）
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COMMANDS, describeCommand, errorBody, findCommand, runCommand } from './commands';

function send(res: ServerResponse, status: number, body: unknown) {
  const isText = typeof body === 'string';
  const looksCsv = isText && (body as string).startsWith('﻿');
  res.statusCode = status;
  res.setHeader('Content-Type', looksCsv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(isText ? body : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

/** クエリ文字列を引数に。同じキーの繰り返しは配列、JSON らしい値（{…} [ … ]）は JSON として読む */
function queryParams(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const vals = url.searchParams.getAll(key).map((v) => (/^[{[]/.test(v) ? JSON.parse(v) : v));
    out[key] = vals.length > 1 ? vals : vals[0];
  }
  return out;
}

export interface ApiOptions {
  /** 設定すると Authorization: Bearer <token> か ?token= が必要になる */
  token?: string;
  dataDir?: string;
}

/**
 * GET  /api                 → コマンド一覧と引数の説明
 * GET  /api/<command>?k=v   → 実行（同じキーの繰り返しで配列）
 * POST /api/<command>       → 実行（引数は JSON ボディ）
 */
export async function handleApi(req: IncomingMessage, res: ServerResponse, opts: ApiOptions = {}) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (opts.token) {
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token');
    if (auth !== opts.token) return send(res, 401, { error: '認証が必要です（Authorization: Bearer <token>）' });
    url.searchParams.delete('token');
  }
  const name = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  if (!name) {
    return send(res, 200, {
      name: 'ashiato-viewer API',
      usage: 'GET /api/<command>?param=value（繰り返しで配列） または POST /api/<command>（JSON ボディ）',
      commands: COMMANDS.map(describeCommand),
    });
  }
  if (!findCommand(name)) return send(res, 404, errorBody(new Error(`不明なコマンド: ${name}`)));
  try {
    const params = req.method === 'POST' ? await readBody(req) : queryParams(url);
    return send(res, 200, runCommand(name, params, { dataDir: opts.dataDir }));
  } catch (err) {
    const body = errorBody(err);
    return send(res, 'details' in body || body.error.includes('見つかりません') ? 400 : 500, body);
  }
}
