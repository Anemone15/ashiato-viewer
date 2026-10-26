// src/api/commands.ts の定義から docs/API-reference.md を作る（npm run docs:api）
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { COMMANDS } from '../src/api/commands';
import { ROOT } from '../src/api/engine';

type JS = { type?: string | string[]; enum?: unknown[]; items?: JS; properties?: Record<string, JS>; anyOf?: JS[]; default?: unknown; minimum?: number; maximum?: number; maxItems?: number };

function typeOf(s: JS | undefined): string {
  if (!s) return 'any';
  if (s.anyOf) return s.anyOf.map(typeOf).filter((t) => t !== 'null').join(' | ');
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(' / ');
  if (s.type === 'array') return `${typeOf(s.items)}[]`;
  if (s.type === 'object' && s.properties) return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}: ${typeOf(v)}`).join(', ')} }`;
  if (s.type === 'integer') return 'integer';
  return Array.isArray(s.type) ? s.type.join(' | ') : s.type ?? 'any';
}

const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

const out: string[] = [
  '# API リファレンス',
  '',
  '> このファイルは `npm run docs:api` で `src/api/commands.ts` から自動生成しています。直接編集しないでください。',
  '> 使い方の説明は [API.md](API.md) を参照。',
  '',
  '| コマンド | 内容 |',
  '|---|---|',
  ...COMMANDS.map((c) => `| [\`${c.name}\`](#${c.name}) | ${c.title} |`),
  '',
];

for (const c of COMMANDS) {
  const schema = z.toJSONSchema(z.object(c.input), { io: 'input', unrepresentable: 'any' }) as JS & { required?: string[] };
  out.push(`## ${c.name}`, '', `**${c.title}** — ${c.description}`, '');
  out.push('| 引数 | 型 | 説明 |', '|---|---|---|');
  for (const [k, s] of Object.entries(c.input)) {
    const js = schema.properties?.[k];
    const req = schema.required?.includes(k) ? '（必須）' : '';
    out.push(`| \`${k}\`${req} | ${esc(typeOf(js))} | ${esc((s as z.ZodType).description ?? '')} |`);
  }
  out.push('');
  if (c.examples?.length) {
    out.push('例:', '', '```bash');
    for (const ex of c.examples) {
      const args = Object.entries(ex)
        .map(([k, v]) => `--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} ${Array.isArray(v) ? v.join(',') : String(v).includes(' ') ? `'${v}'` : v}`)
        .join(' ');
      out.push(`./bin/ashiato ${c.name} ${args}`);
    }
    out.push('```', '');
  }
}

const file = path.join(ROOT, 'docs/API-reference.md');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out.join('\n'));
console.log(`wrote ${file}`);
