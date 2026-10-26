// Node 用: data/ の CSV と public/geo/ を読み込んで解析し、API から使える形にする
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../core/analyze';
import { parseCsvTexts } from '../core/csv';
import { FilterError, type FilterContext } from '../core/filter';
import { haversine } from '../core/geo';
import { MuniIndex, type MuniFeature } from '../core/land';
import { RailIndex } from '../core/rail';
import { MODE_LABEL, type Analysis, type Leg, type Place, type Trip } from '../core/types';

/** プロジェクトのフォルダ（public/geo がある所）。1ファイルにまとめた CLI からも見つけられるよう上へたどる */
function findRoot(): string {
  if (process.env.ASHIATO_ROOT) return path.resolve(process.env.ASHIATO_ROOT);
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'public/geo/rail.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
export const ROOT = findRoot();

export interface EngineOptions {
  /** CSV を置いたフォルダ（既定: <プロジェクト>/data。環境変数 ASHIATO_DATA_DIR でも指定可） */
  dataDir?: string;
  geoDir?: string;
}

interface PlaceName { lat: number; lon: number; name: string }

export interface Engine {
  a: Analysis;
  ctx: FilterContext;
  rail: RailIndex;
  muni: MuniIndex;
  muniFeatures: MuniFeature[];
  files: { name: string; size: number }[];
  dataDir: string;
  /** 記録に登場する駅名 → 乗車/降車/通過回数 */
  stationUse: Map<string, { board: number; alight: number; pass: number }>;
  loadedAt: number;
  ms: number;
}

let geoCache: { rail: RailIndex; muni: MuniIndex; features: MuniFeature[] } | null = null;
let engineCache: { sig: string; engine: Engine } | null = null;

function readGeo(geoDir: string) {
  if (!geoCache) {
    const j = (f: string) => JSON.parse(fs.readFileSync(path.join(geoDir, f), 'utf8'));
    const features: MuniFeature[] = j('municipalities.json').features;
    geoCache = { rail: new RailIndex(j('rail.json'), j('stations.json')), muni: new MuniIndex(features), features };
  }
  return geoCache;
}

function csvFiles(dataDir: string) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort()
    .map((f) => {
      const st = fs.statSync(path.join(dataDir, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    });
}

/** 解析済みデータを返す。CSV が変わっていなければキャッシュを使う */
export function getEngine(opts: EngineOptions = {}): Engine {
  const dataDir = path.resolve(opts.dataDir ?? process.env.ASHIATO_DATA_DIR ?? path.join(ROOT, 'data'));
  const geoDir = path.resolve(opts.geoDir ?? path.join(ROOT, 'public/geo'));
  const files = csvFiles(dataDir);
  const namesFile = path.join(dataDir, 'place-names.json');
  const namesMtime = fs.existsSync(namesFile) ? fs.statSync(namesFile).mtimeMs : 0;
  const sig = JSON.stringify([dataDir, files, namesMtime]);
  if (engineCache?.sig === sig) return engineCache.engine;
  if (!files.length) throw new FilterError(`CSV が見つかりません: ${dataDir} に位置記録アプリの CSV を置いてください`);

  const t0 = Date.now();
  const { rail, muni, features } = readGeo(geoDir);
  const raw = parseCsvTexts(files.map((f) => fs.readFileSync(path.join(dataDir, f.name), 'utf8')));
  const a = analyze(raw, { rail, muni });

  let homeId = -1, best = 0;
  for (const p of a.places) if (p.totalMs > best) { best = p.totalMs; homeId = p.id; }
  const names: PlaceName[] = namesMtime ? JSON.parse(fs.readFileSync(namesFile, 'utf8')) : [];
  const userName = (p: Place) => {
    let hit: string | undefined, bd = 150;
    for (const n of names) {
      const d = haversine(p.lat, p.lon, n.lat, n.lon);
      if (d < bd) { bd = d; hit = n.name; }
    }
    return hit;
  };
  const placeLabels = a.places.map((p) => userName(p) ?? (p.id === homeId ? '自宅（推定）' : p.autoName));

  const lines = rail.rail.lines;
  const ctx: FilterContext = {
    a,
    stationName: (st) => rail.stations[st].name,
    lineLabel: (l) => `${lines[l].op} ${lines[l].name}`,
    lineOp: (l) => lines[l].op,
    placeLabel: (id) => placeLabels[id] ?? '不明',
    homeId,
    muniAt: (lat, lon) => {
      const i = muni.lookup(lat, lon);
      return i < 0 ? null : features[i].properties;
    },
  };

  const stationUse = new Map<string, { board: number; alight: number; pass: number }>();
  for (const t of a.trips) for (const l of t.legs) for (const s of l.stations) {
    const n = rail.stations[s.st].name;
    const e = stationUse.get(n) ?? { board: 0, alight: 0, pass: 0 };
    e[s.kind]++;
    stationUse.set(n, e);
  }

  const engine: Engine = {
    a, ctx, rail, muni, muniFeatures: features, dataDir, stationUse,
    files: files.map(({ name, size }) => ({ name, size })),
    loadedAt: Date.now(),
    ms: Date.now() - t0,
  };
  engineCache = { sig, engine };
  return engine;
}

// ------------------------------------------------------------
// 名前の解決（AI エージェントが表記ゆれで呼んでも通るように）
// ------------------------------------------------------------
export function resolveStation(e: Engine, name: string): string {
  const n = name.trim().replace(/駅$/, '');
  if (e.stationUse.has(n)) return n;
  if (e.rail.byName.has(n)) return n; // 記録に無い駅でも実在すればそのまま（結果は0件）
  const cands = [...e.stationUse.keys()].filter((s) => s.includes(n) || n.includes(s));
  throw new FilterError(`駅「${name}」が見つかりません。stations コマンド（query に駅名の一部）で正しい表記を確認してください`, { suggestions: cands.slice(0, 10) });
}

// ------------------------------------------------------------
// JSON 出力用の整形
// ------------------------------------------------------------
export const iso = (t: number) => new Date(t + 9 * 3600e3).toISOString().replace(/\.\d{3}Z$/, '+09:00');
const r1 = (v: number) => Math.round(v * 10) / 10;

export function legJSON(e: Engine, l: Leg, index: number) {
  const name = (st: number) => e.rail.stations[st].name;
  const st = l.stations;
  return {
    index,
    mode: l.mode,
    modeLabel: MODE_LABEL[l.mode],
    start: iso(l.start),
    end: iso(l.end),
    durationMin: Math.round((l.end - l.start) / 60e3),
    distanceKm: r1(l.dist / 1000),
    avgKmh: r1(l.avgKmh),
    topKmh: r1(l.maxKmh),
    // 鉄道以外では「近くを通った線路」でしかないので出さない
    ...(l.mode === 'train' || l.mode === 'shinkansen' ? { lines: l.lines.slice(0, 3).map((x) => e.ctx.lineLabel(x)) } : {}),
    ...(st.length
      ? {
          board: name(st[0].st),
          alight: st.length >= 2 ? name(st[st.length - 1].st) : undefined,
          via: st.slice(1, -1).map((s) => name(s.st)),
        }
      : {}),
    inferred: l.inferred,
  };
}

export function tripJSON(e: Engine, t: Trip, opts: { legs?: number[]; detail?: 'summary' | 'full' } = {}) {
  const detail = opts.detail ?? 'summary';
  const pick = detail === 'full' ? t.legs.map((_, i) => i) : opts.legs ?? t.legs.map((_, i) => i);
  return {
    id: t.id,
    date: t.date,
    start: iso(t.start),
    end: iso(t.end),
    durationMin: Math.round((t.end - t.start) / 60e3),
    distanceKm: r1(t.dist / 1000),
    from: t.fromPlace >= 0 ? e.ctx.placeLabel(t.fromPlace) : '不明',
    to: t.toPlace >= 0 ? e.ctx.placeLabel(t.toPlace) : '不明',
    modes: [...new Set(t.legs.map((l) => l.mode))],
    ...(opts.legs && detail === 'summary' ? { matchedLegs: opts.legs } : {}),
    legs: pick.filter((i) => detail === 'full' || t.legs[i].mode !== 'walk' || opts.legs).map((i) => legJSON(e, t.legs[i], i)),
  };
}

/** 区間の軌跡を GeoJSON に（maxPoints を超える場合は間引く） */
export function legFeature(e: Engine, t: Trip, l: Leg, index: number, maxPoints = 2000): GeoJSON.Feature {
  const { lat, lon } = e.a.pts;
  const n = l.i1 - l.i0 + 1;
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const coords: [number, number][] = [];
  for (let k = l.i0; k <= l.i1; k += step) coords.push([Math.round(lon[k] * 1e6) / 1e6, Math.round(lat[k] * 1e6) / 1e6]);
  if ((l.i1 - l.i0) % step) coords.push([lon[l.i1], lat[l.i1]]);
  return {
    type: 'Feature',
    properties: { tripId: t.id, date: t.date, ...legJSON(e, l, index), via: undefined },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

/** 配列を CSV に（Excel で開けるよう BOM 付き） */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '﻿';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = Array.isArray(v) ? v.join(' / ') : v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
