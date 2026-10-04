// 解析ロジックを Node で実行して結果を確認するための CLI
// 使い方: npm run analyze -- <csv...> [--date YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../src/core/analyze';
import { parseCsvTexts } from '../src/core/csv';
import { MuniIndex } from '../src/core/land';
import { RailIndex } from '../src/core/rail';
import { MODE_LABEL, MODES } from '../src/core/types';

const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
const date = dateIdx >= 0 ? args.splice(dateIdx, 2)[1] : undefined;
const files = args.length ? args : fs.readdirSync('data').filter((f) => f.endsWith('.csv')).map((f) => path.join('data', f));

const geoDir = path.resolve('public/geo');
let t0 = Date.now();
const rail = new RailIndex(
  JSON.parse(fs.readFileSync(path.join(geoDir, 'rail.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(geoDir, 'stations.json'), 'utf8')),
);
const muni = new MuniIndex(JSON.parse(fs.readFileSync(path.join(geoDir, 'municipalities.json'), 'utf8')).features);
console.log(`geo index: ${Date.now() - t0}ms`);
t0 = Date.now();
const raw = parseCsvTexts(files.map((f) => fs.readFileSync(f, 'utf8')));
console.log(`parse: ${Date.now() - t0}ms, ${raw.t.length} rows`);
t0 = Date.now();
const a = analyze(raw, { rail, muni }, (m) => console.log(' ', m));
console.log(`analyze: ${Date.now() - t0}ms`);
console.log(a.stats, `stays=${a.stays.length} places=${a.places.length} trips=${a.trips.length} munis=${a.munis.length}`);

const tot = new Map<string, { n: number; km: number; h: number }>();
for (const tr of a.trips) for (const l of tr.legs) {
  const e = tot.get(l.mode) ?? { n: 0, km: 0, h: 0 };
  e.n++; e.km += l.dist / 1000; e.h += (l.end - l.start) / 3600e3;
  tot.set(l.mode, e);
}
for (const m of MODES) {
  const e = tot.get(m);
  if (e) console.log(`${MODE_LABEL[m].padEnd(5)} ${String(e.n).padStart(6)}区間 ${e.km.toFixed(0).padStart(7)}km ${e.h.toFixed(0).padStart(5)}h`);
}

const fmt = (t: number) => new Date(t + 9 * 3600e3).toISOString().slice(11, 16);
const show = date ? a.trips.filter((t) => t.date === date) : [];
for (const tr of show) {
  const from = a.places[tr.fromPlace]?.autoName ?? '?', to = a.places[tr.toPlace]?.autoName ?? '?';
  console.log(`\n${fmt(tr.start)}-${fmt(tr.end)} ${from} → ${to} ${(tr.dist / 1000).toFixed(1)}km`);
  for (const l of tr.legs) {
    const st = l.stations.map((s) => (s.kind === 'pass' ? '' : s.kind === 'board' ? '[乗]' : '[降]') + rail.stationLabel(s.st)).join(' ');
    console.log(`  ${fmt(l.start)}-${fmt(l.end)} ${MODE_LABEL[l.mode]}${l.inferred ? '*' : ''} ${(l.dist / 1000).toFixed(1)}km avg${l.avgKmh.toFixed(0)} p95 ${l.maxKmh.toFixed(0)}km/h ${l.lines.slice(0, 2).map((x) => rail.lineLabel(x)).join(',')} ${st}`);
  }
}
