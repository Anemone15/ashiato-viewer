// MCP サーバー（stdio）。Claude Desktop / Claude Code / Cowork などから足跡ビューアの検索・集計を使えるようにする。
// 設定方法は docs/API.md の「MCP サーバー」を参照。標準出力はプロトコル専用なので、ログは標準エラーに出す。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { COMMANDS, errorBody } from '../src/api/commands';
import { getEngine } from '../src/api/engine';

const INSTRUCTIONS = `iPhone の位置記録を解析した、ユーザー本人の移動履歴を検索・集計するツール群です。
- まず summary で期間・手段ごとの合計・よく乗る区間を把握してください。
- 「移動（trip）」は滞在地から次の滞在地までの1回の移動、「区間（leg）」はその中の徒歩・電車などひと続きの部分です。
- 駅名は stations、場所の名前は places で表記を確認してから search_trips / search_legs / aggregate に渡してください（自宅は "home"）。
- 日時はすべて日本時間 (+09:00)。移動手段は速度と線路・海上の位置から推定したもので、車とバスは区別しません。
- 個人の位置履歴なので、結果をユーザーに断りなく外部へ送らないでください。`;

const server = new McpServer({ name: 'ashiato-viewer', version: '0.2.0' }, { instructions: INSTRUCTIONS });

for (const c of COMMANDS) {
  const examples = c.examples?.length ? `\n例: ${c.examples.map((x) => JSON.stringify(x)).join(' / ')}` : '';
  server.registerTool(
    c.name,
    {
      title: c.title,
      description: c.description + examples,
      inputSchema: c.input,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const out = c.run(getEngine(), args as never);
        return { content: [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorBody(err)) }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error('ashiato-viewer MCP server ready');
// 最初の呼び出しを速くするため、接続後に解析しておく
try {
  getEngine();
} catch (err) {
  console.error(String(err));
}
