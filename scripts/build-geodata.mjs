// 国土数値情報（鉄道 N02）と市区町村境界（smartnews-smri/japan-topography, N03由来）を
// アプリ用の軽量JSONに変換して public/geo/ に出力する。
//
// 入力: geodata/raw/N02/UTF-8/N02-24_RailroadSection.geojson
//       geodata/raw/N02/UTF-8/N02-24_Station.geojson
//       geodata/raw/municipalities.json
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = path.join(root, 'geodata/raw');
const out = path.join(root, 'public/geo');
fs.mkdirSync(out, { recursive: true });

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------- 鉄道 ----------
// N02_002 事業者種別: 1 新幹線, 2 JR在来線, 3 公営, 4 民営, 5 第三セクター
const sections = JSON.parse(fs.readFileSync(path.join(raw, 'N02/UTF-8/N02-24_RailroadSection.geojson'), 'utf8'));
const stationsRaw = JSON.parse(fs.readFileSync(path.join(raw, 'N02/UTF-8/N02-24_Station.geojson'), 'utf8'));

const lineKey = (p) => `${p.N02_004}|${p.N02_003}`;
const lineIndex = new Map();
const lines = [];
const getLine = (p) => {
  const k = lineKey(p);
  if (!lineIndex.has(k)) {
    lineIndex.set(k, lines.length);
    lines.push({ name: p.N02_003, op: p.N02_004, kind: Number(p.N02_002) });
  }
  return lineIndex.get(k);
};

const segs = [];
const pushLine = (li, coords) => {
  const flat = [];
  let prev = null;
  for (const [x, y] of coords) {
    const c = [r5(x), r5(y)];
    if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
    flat.push(c[0], c[1]);
    prev = c;
  }
  if (flat.length >= 4) segs.push([li, flat]);
};
for (const f of sections.features) {
  const li = getLine(f.properties);
  const g = f.geometry;
  if (g.type === 'LineString') pushLine(li, g.coordinates);
  else if (g.type === 'MultiLineString') g.coordinates.forEach((c) => pushLine(li, c));
}
// 駅（ホーム）のジオメトリも線路として扱う（駅部分の区間は RailroadSection に含まれないことがある）
for (const f of stationsRaw.features) {
  const li = getLine(f.properties);
  if (f.geometry.type === 'LineString') pushLine(li, f.geometry.coordinates);
}

// 駅: 駅グループコード(N02_005g)で同一駅を束ねる。路線ごとのホーム中心も保持
const groups = new Map();
for (const f of stationsRaw.features) {
  const p = f.properties;
  const cs = f.geometry.coordinates;
  let sx = 0, sy = 0;
  for (const [x, y] of cs) { sx += x; sy += y; }
  const cx = sx / cs.length, cy = sy / cs.length;
  const li = getLine(p);
  const g = p.N02_005g;
  if (!groups.has(g)) groups.set(g, { name: p.N02_005, plats: [] });
  groups.get(g).plats.push([li, r5(cx), r5(cy)]);
}
const stations = [];
for (const [code, g] of groups) {
  let sx = 0, sy = 0;
  for (const [, x, y] of g.plats) { sx += x; sy += y; }
  stations.push({ code, name: g.name, x: r5(sx / g.plats.length), y: r5(sy / g.plats.length), plats: g.plats });
}

fs.writeFileSync(path.join(out, 'rail.json'), JSON.stringify({ lines, segs }));
fs.writeFileSync(path.join(out, 'stations.json'), JSON.stringify(stations));
console.log(`rail: ${lines.length} lines, ${segs.length} segments; stations: ${stations.length}`);

// ---------- 市区町村 ----------
const muni = JSON.parse(fs.readFileSync(path.join(raw, 'municipalities.json'), 'utf8'));
const roundRing = (ring) => {
  const outRing = [];
  let prev = null;
  for (const [x, y] of ring) {
    const c = [r4(x), r4(y)];
    if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
    outRing.push(c);
    prev = c;
  }
  return outRing;
};
const feats = [];
for (const f of muni.features) {
  const p = f.properties;
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rounded = polys.map((poly) => poly.map(roundRing).filter((r) => r.length >= 4)).filter((p) => p.length);
  if (!rounded.length) continue;
  // 政令市の区は「大阪市北区」のように表記
  const city = p.N03_003 && p.N03_003.endsWith('市') ? p.N03_003 : '';
  const name = (city || '') + (p.N03_004 || '');
  feats.push({
    type: 'Feature',
    properties: { code: p.N03_007, pref: p.N03_001, name },
    geometry: { type: 'MultiPolygon', coordinates: rounded },
  });
}
fs.writeFileSync(path.join(out, 'municipalities.json'), JSON.stringify({ type: 'FeatureCollection', features: feats }));
console.log(`municipalities: ${feats.length}`);
for (const f of fs.readdirSync(out)) console.log(f, (fs.statSync(path.join(out, f)).size / 1e6).toFixed(1) + 'MB');
