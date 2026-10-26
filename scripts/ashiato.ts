// 足跡ビューアの CLI。結果は標準出力に JSON（または CSV/GeoJSON）で出す。
//
//   ./bin/ashiato <command> [--param value ...]
//   ./bin/ashiato <command> --json '{"param": "value"}'
//   ./bin/ashiato help [command]
//
// 例: ./bin/ashiato search_trips --from 新宿 --to 東京 --limit 5
import fs from 'node:fs';
import { COMMANDS, describeCommand, errorBody, findCommand, runCommand } from '../src/api/commands';

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function parseArgs(argv: string[]) {
  const params: Record<string, unknown> = {};
  const opts = { pretty: true, dataDir: undefined as string | undefined, out: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`引数は --名前 値 の形で指定してください: ${a}`);
    let [key, val] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    key = camel(key);
    if (val === undefined) val = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (key === 'json') {
      const text = val === '-' ? fs.readFileSync(0, 'utf8') : val;
      Object.assign(params, JSON.parse(text));
    } else if (key === 'compact') opts.pretty = false;
    else if (key === 'dataDir') opts.dataDir = val;
    else if (key === 'out') opts.out = val;
    else if (key in params) params[key] = [...([] as unknown[]).concat(params[key]), val]; // 繰り返し指定は配列に
    else params[key] = val;
  }
  return { params, opts };
}

function help(name?: string) {
  if (name) {
    const c = findCommand(name);
    if (!c) return { error: `不明なコマンド: ${name}`, commands: COMMANDS.map((x) => x.name) };
    return describeCommand(c);
  }
  return {
    usage: './bin/ashiato <command> [--param value ...] | --json \'{...}\' | help <command>',
    options: {
      '--json <JSON|->': '引数をまとめて JSON で渡す（- で標準入力から）',
      '--compact': '改行なしの JSON で出力',
      '--out <file>': '結果をファイルに書き出す（CSV・GeoJSON の保存に便利）',
      '--data-dir <dir>': 'CSV のフォルダ（既定: data/）',
    },
    commands: COMMANDS.map((c) => ({ name: c.name, title: c.title, description: c.description })),
  };
}

// head などで途中で読むのをやめられても落ちないように
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let out: unknown;
  let failed = false;
  let pretty = true, outFile: string | undefined;
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') out = help(rest[0]);
    else {
      const { params, opts } = parseArgs(rest);
      pretty = opts.pretty;
      outFile = opts.out;
      out = runCommand(cmd, params, { dataDir: opts.dataDir });
    }
  } catch (err) {
    out = errorBody(err);
    failed = true;
  }
  const text = typeof out === 'string' ? out : JSON.stringify(out, null, pretty ? 2 : undefined) + '\n';
  if (outFile && !failed) {
    fs.writeFileSync(outFile, text);
    process.stdout.write(JSON.stringify({ written: outFile, bytes: Buffer.byteLength(text) }) + '\n');
  } else process.stdout.write(text);
  process.exitCode = failed ? 1 : 0;
}

main();
