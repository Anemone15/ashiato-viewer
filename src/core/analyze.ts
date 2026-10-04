import { dateKey, GridIndex, haversine, median, mToDeg, pointSegment, quantile } from './geo';
import { MuniIndex } from './land';
import { RailIndex } from './rail';
import { Analysis, Leg, Mode, MuniVisit, Place, RawLog, StationEvent, STATUS, Stay, Trip } from './types';

export interface GeoContext {
  rail: RailIndex;
  muni: MuniIndex;
}

const MIN = 60e3;

// ---- しきい値（調整用） ----
const MAX_ACC_M = 300; // これより精度が悪い点は捨てる
const STAY_RADIUS_M = 150;
const STAY_MIN_MS = 10 * MIN;
const TRIP_SPLIT_GAP_MS = 3 * 60 * MIN; // 3時間以上の空白はトリップを分ける
const GAP_DT_S = 150; // この秒数以上かつ GAP_D_M 以上進んだ区間は「データの空白」
const GAP_D_M = 800;
const WALK_KMH = 7.5;

type Pts = { t: Float64Array; lat: Float64Array; lon: Float64Array; acc: Float32Array };

// ------------------------------------------------------------
// 1. 前処理：並べ替え・重複除去・外れ値除去
// ------------------------------------------------------------
function cleanPoints(raw: RawLog): { pts: Pts; removed: number } {
  const idx: number[] = [];
  for (let i = 0; i < raw.t.length; i++) {
    const s = raw.status[i];
    // 「Point出発」は登録地点の座標で記録されるので軌跡には使わない
    if (s !== STATUS.pass && s !== STATUS.move) continue;
    if (raw.acc[i] > MAX_ACC_M) continue;
    idx.push(i);
  }
  idx.sort((a, b) => raw.t[a] - raw.t[b]);

  // 同時刻の点は精度の良い方を残す
  const kept: number[] = [];
  for (const i of idx) {
    const last = kept[kept.length - 1];
    if (last !== undefined && raw.t[last] === raw.t[i]) {
      const al = raw.acc[last], ai = raw.acc[i];
      if (Number.isNaN(al) || (!Number.isNaN(ai) && ai < al)) kept[kept.length - 1] = i;
      continue;
    }
    kept.push(i);
  }

  // 外れ値除去（双方向リンクリストで A→B→A 型のスパイクと物理的にあり得ない速度を消す）
  const n = kept.length;
  const lat = (k: number) => raw.lat[kept[k]];
  const lon = (k: number) => raw.lon[kept[k]];
  const tt = (k: number) => raw.t[kept[k]];
  const prev = new Int32Array(n), next = new Int32Array(n), alive = new Uint8Array(n).fill(1);
  for (let k = 0; k < n; k++) { prev[k] = k - 1; next[k] = k + 1 < n ? k + 1 : -1; }
  const kmh = (a: number, b: number) =>
    (haversine(lat(a), lon(a), lat(b), lon(b)) / Math.max(1, (tt(b) - tt(a)) / 1000)) * 3.6;
  const remove = (k: number) => {
    alive[k] = 0;
    if (prev[k] >= 0) next[prev[k]] = next[k];
    if (next[k] >= 0) prev[next[k]] = prev[k];
  };
  const isSpike = (k: number) => {
    const p = prev[k], q = next[k];
    if (p < 0 || q < 0) return false;
    const d1 = haversine(lat(p), lon(p), lat(k), lon(k));
    const d2 = haversine(lat(k), lon(k), lat(q), lon(q));
    if (d1 < 150 || d2 < 150) return false;
    const d3 = haversine(lat(p), lon(p), lat(q), lon(q));
    return d3 < 0.35 * Math.min(d1, d2) && kmh(p, k) > 80 && kmh(k, q) > 80;
  };
  let removed = 0;
  const stack: number[] = [];
  for (let k = n - 1; k >= 0; k--) stack.push(k);
  while (stack.length) {
    const k = stack.pop()!;
    if (!alive[k]) continue;
    if (isSpike(k)) {
      const p = prev[k], q = next[k];
      remove(k);
      removed++;
      if (p >= 0) stack.push(p);
      if (q >= 0) stack.push(q);
    }
  }
  // 1100km/h を超える移動は後ろの点を捨てる
  for (let k = 0; k < n; k++) {
    if (!alive[k]) continue;
    const p = prev[k];
    if (p >= 0 && kmh(p, k) > 1100 && haversine(lat(p), lon(p), lat(k), lon(k)) > 2000) {
      remove(k);
      removed++;
    }
  }

  const out: number[] = [];
  for (let k = 0; k < n; k++) if (alive[k]) out.push(kept[k]);
  const pts: Pts = {
    t: Float64Array.from(out, (i) => raw.t[i]),
    lat: Float64Array.from(out, (i) => raw.lat[i]),
    lon: Float64Array.from(out, (i) => raw.lon[i]),
    acc: Float32Array.from(out, (i) => raw.acc[i]),
  };
  return { pts, removed };
}

// ------------------------------------------------------------
// 2. 滞在の検出
// ------------------------------------------------------------
interface StayIdx { i0: number; i1: number; start: number; end: number; lat: number; lon: number }

function detectStays(p: Pts): StayIdx[] {
  const n = p.t.length;
  const out: StayIdx[] = [];
  const d = (a: number, b: number) => haversine(p.lat[a], p.lon[a], p.lat[b], p.lon[b]);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && d(i, j) <= STAY_RADIUS_M) j++;
    let end = p.t[j - 1];
    // 次の点まで長い空白があり、ゆっくりしか動いていない → 空白の大半はその場に滞在していたとみなす
    if (j < n) {
      const gap = p.t[j] - p.t[j - 1];
      const dist = d(j - 1, j);
      if (gap > 20 * MIN && (dist / (gap / 1000)) * 3.6 < 3) end = p.t[j] - (dist / 1.2) * 1000;
    }
    if (end - p.t[i] >= STAY_MIN_MS) {
      let sl = 0, so = 0;
      for (let k = i; k < j; k++) { sl += p.lat[k]; so += p.lon[k]; }
      out.push({ i0: i, i1: j - 1, start: p.t[i], end, lat: sl / (j - i), lon: so / (j - i) });
      i = j;
    } else {
      i++;
    }
  }
  // GPS のふらつきで分断された同じ場所の滞在をつなぐ
  const merged: StayIdx[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && haversine(last.lat, last.lon, s.lat, s.lon) < 250) {
      let far = false;
      for (let k = last.i1; k <= s.i0; k++) {
        if (haversine(last.lat, last.lon, p.lat[k], p.lon[k]) > 400) { far = true; break; }
      }
      if (!far) {
        const w1 = last.i1 - last.i0 + 1, w2 = s.i1 - s.i0 + 1;
        last.lat = (last.lat * w1 + s.lat * w2) / (w1 + w2);
        last.lon = (last.lon * w1 + s.lon * w2) / (w1 + w2);
        last.i1 = s.i1;
        last.end = s.end;
        continue;
      }
    }
    merged.push({ ...s });
  }
  return merged;
}

// ------------------------------------------------------------
// 3. 区間（レグ）の分割と移動手段の判定
// ------------------------------------------------------------
interface Run { i0: number; i1: number; kind: 'walk' | 'veh' | 'gap' }

function pointSpeeds(p: Pts, a: number, b: number, isGap: (k: number) => boolean): Float64Array {
  // 前後±20秒の窓で平均速度 (km/h)
  const sp = new Float64Array(b - a + 1);
  for (let k = a; k <= b; k++) {
    let lo = k, hi = k;
    while (lo > a && !isGap(lo - 1) && p.t[k] - p.t[lo - 1] <= 20e3) lo--;
    while (hi < b && !isGap(hi) && p.t[hi + 1] - p.t[k] <= 20e3) hi++;
    if (lo === hi) {
      if (lo > a && !isGap(lo - 1)) lo--;
      else if (hi < b && !isGap(hi)) hi++;
    }
    if (lo === hi) { sp[k - a] = 0; continue; }
    let dist = 0;
    for (let m = lo; m < hi; m++) dist += haversine(p.lat[m], p.lon[m], p.lat[m + 1], p.lon[m + 1]);
    sp[k - a] = (dist / Math.max(1, (p.t[hi] - p.t[lo]) / 1000)) * 3.6;
  }
  return sp;
}

function pathDist(p: Pts, i0: number, i1: number): number {
  let d = 0;
  for (let k = i0; k < i1; k++) d += haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
  return d;
}

function buildRuns(p: Pts, a: number, b: number): { runs: Run[]; speeds: Float64Array } {
  const gapAt = new Uint8Array(b - a + 1);
  const ikmh = (k: number) =>
    (haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]) / Math.max(1, (p.t[k + 1] - p.t[k]) / 1000)) * 3.6;
  for (let k = a; k < b; k++) {
    const dt = (p.t[k + 1] - p.t[k]) / 1000;
    const d = haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
    if (dt > GAP_DT_S && d > GAP_D_M) gapAt[k - a] = 1;
    // 記録再開直後の古い位置などによる「瞬間移動」も空白として扱う（飛行中の連続した高速とは区別）
    else if (d > 300 && ikmh(k) > 250 && (k === a || ikmh(k - 1) < 150) && (k + 1 >= b || ikmh(k + 1) < 150)) gapAt[k - a] = 1;
  }
  const isGap = (k: number) => gapAt[k - a] === 1;
  const speeds = pointSpeeds(p, a, b, isGap);

  const runs: Run[] = [];
  let chunkStart = a;
  const flushChunk = (c0: number, c1: number) => {
    if (c1 <= c0) return;
    const chunkRuns: Run[] = [];
    let s = c0;
    let kind: Run['kind'] = speeds[c0 - a] < WALK_KMH ? 'walk' : 'veh';
    for (let k = c0 + 1; k <= c1; k++) {
      const kk: Run['kind'] = speeds[k - a] < WALK_KMH ? 'walk' : 'veh';
      if (kk !== kind) {
        chunkRuns.push({ i0: s, i1: k, kind });
        s = k;
        kind = kk;
      }
    }
    if (s < c1 || chunkRuns.length === 0) chunkRuns.push({ i0: s, i1: c1, kind });
    // 短い停止（駅停車・信号）は乗り物に、短い乗り物区間（GPSのぶれ）は徒歩に吸収
    let changed = true;
    while (changed && chunkRuns.length > 1) {
      changed = false;
      for (let r = 0; r < chunkRuns.length; r++) {
        const run = chunkRuns[r];
        const dur = p.t[run.i1] - p.t[run.i0];
        const dist = pathDist(p, run.i0, run.i1);
        const prevK = chunkRuns[r - 1]?.kind, nextK = chunkRuns[r + 1]?.kind;
        if (run.kind === 'walk' && prevK === 'veh' && nextK === 'veh' && dur < 150e3 && dist < 200) {
          run.kind = 'veh';
          changed = true;
        } else if (run.kind === 'veh' && (dur < 60e3 || dist < 250) && prevK !== 'veh' && nextK !== 'veh') {
          run.kind = 'walk';
          changed = true;
        }
      }
      // 同種を結合
      for (let r = chunkRuns.length - 1; r > 0; r--) {
        if (chunkRuns[r].kind === chunkRuns[r - 1].kind) {
          chunkRuns[r - 1].i1 = chunkRuns[r].i1;
          chunkRuns.splice(r, 1);
        }
      }
    }
    runs.push(...chunkRuns);
  };
  for (let k = a; k < b; k++) {
    if (isGap(k)) {
      flushChunk(chunkStart, k);
      runs.push({ i0: k, i1: k + 1, kind: 'gap' });
      chunkStart = k + 1;
    }
  }
  flushChunk(chunkStart, b);
  return { runs, speeds };
}

interface LegFeat {
  railFrac: number;
  shinFrac: number;
  seaFrac: number;
  lineCounts: Map<number, number>;
  v95: number;
  vMedMoving: number;
  innerStops: number;
  stopsAtStation: number;
  dist: number;
  avgKmh: number;
}

function legFeatures(p: Pts, i0: number, i1: number, speeds: Float64Array, a: number, geo: GeoContext): LegFeat {
  const lineCounts = new Map<number, number>();
  let considered = 0, nearRail = 0, nearShin = 0, sea = 0, total = 0;
  const sp: number[] = [];
  for (let k = i0; k <= i1; k++) {
    const v = speeds[k - a];
    sp.push(v);
    total++;
    if (geo.muni.lookup(p.lat[k], p.lon[k]) < 0) sea++;
    const acc = p.acc[k];
    if (acc > 80) continue;
    considered++;
    const near = geo.rail.nearLines(p.lat[k], p.lon[k], 45);
    if (near.size) {
      nearRail++;
      let shin = false;
      for (const l of near.keys()) {
        lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
        if (geo.rail.rail.lines[l].kind === 1) shin = true;
      }
      if (shin) nearShin++;
    }
  }
  // 区間内の停止（速度3km/h未満が15秒以上）が駅の近くかどうか
  const top = [...lineCounts.entries()].sort((x, y) => y[1] - x[1]);
  const mainLines = new Set(top.filter(([, c]) => c >= Math.max(2, top[0]?.[1] * 0.3)).map(([l]) => l));
  // 約200mごとに記録されるため、停止は「時間がかかった短い区間」として現れる
  let innerStops = 0, stopsAtStation = 0;
  for (let k = i0 + 1; k < i1 - 1; k++) {
    const dt = (p.t[k + 1] - p.t[k]) / 1000;
    const d = haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
    if (dt < 25 || (d / dt) * 3.6 > 15) continue;
    innerStops++;
    if (
      mainLines.size &&
      (geo.rail.nearPlatforms(p.lat[k], p.lon[k], 250, mainLines).length ||
        geo.rail.nearPlatforms(p.lat[k + 1], p.lon[k + 1], 250, mainLines).length)
    )
      stopsAtStation++;
  }
  const moving = sp.filter((v) => v >= WALK_KMH);
  return {
    railFrac: considered ? nearRail / considered : 0,
    shinFrac: considered ? nearShin / considered : 0,
    seaFrac: total ? sea / total : 0,
    lineCounts,
    v95: quantile(sp, 0.95),
    vMedMoving: median(moving),
    innerStops,
    stopsAtStation,
    dist: pathDist(p, i0, i1),
    avgKmh: (pathDist(p, i0, i1) / Math.max(1, (p.t[i1] - p.t[i0]) / 1000)) * 3.6,
  };
}

function classifyVehicle(f: LegFeat): Mode {
  if (f.avgKmh < 6) return 'walk'; // GPS のぶれで一瞬速く見えただけ
  if (f.dist > 20e3 && f.avgKmh > 150 && (f.v95 > 330 || (f.v95 > 250 && f.shinFrac < 0.3))) return 'plane';
  if (f.seaFrac > 0.5 && f.vMedMoving < 60 && f.dist > 1500) return 'ship';
  if (f.shinFrac > 0.5 && f.v95 > 120) return 'shinkansen';
  if (f.railFrac > 0.7 && f.v95 >= 35) {
    // 地下鉄の上の道路を車で走った場合など：停止位置の大半が駅でなければ車
    const carLike = f.innerStops >= 2 && f.stopsAtStation / f.innerStops < 0.5;
    if (!carLike) return 'train';
  }
  if (f.v95 < 30) return 'bicycle';
  return 'car';
}

function classifyGap(p: Pts, k: number, geo: GeoContext): Mode {
  const d = haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
  const kmh = (d / Math.max(1, (p.t[k + 1] - p.t[k]) / 1000)) * 3.6;
  const a = geo.rail.nearLines(p.lat[k], p.lon[k], 120);
  const b = geo.rail.nearLines(p.lat[k + 1], p.lon[k + 1], 120);
  const shared = [...a.keys()].filter((l) => b.has(l));
  const sharedShin = shared.some((l) => geo.rail.rail.lines[l].kind === 1);
  if (sharedShin && kmh > 100 && kmh < 330) return 'shinkansen';
  if (d > 50e3 && kmh > 200) return 'plane';
  if (shared.length && kmh > 12 && kmh < 160) return 'train';
  // 地下鉄の直通運転など：両端が線路の近くで、鉄道らしい速度
  if (a.size && b.size && kmh > 12 && kmh < 120 && d < 40e3) return 'train';
  const mid = geo.muni.lookup((p.lat[k] + p.lat[k + 1]) / 2, (p.lon[k] + p.lon[k + 1]) / 2);
  if (mid < 0 && kmh < 70 && d > 3000) return 'ship';
  return 'unknown';
}

/** 電車区間の中で、近くの線路の事業者がはっきり切り替わる位置（乗り換え駅で速度が最も遅い点）を返す */
function operatorCuts(p: Pts, i0: number, i1: number, speeds: Float64Array, a: number, geo: GeoContext): number[] {
  const lines = geo.rail.rail.lines;
  type Seg = { op: string; first: number; last: number; n: number };
  let segs: Seg[] = [];
  for (let k = i0; k <= i1; k++) {
    if (p.acc[k] > 80) continue;
    const ops = new Set([...geo.rail.nearLines(p.lat[k], p.lon[k], 45).keys()].map((l) => lines[l].op));
    if (ops.size !== 1) continue;
    const op = [...ops][0];
    const last = segs[segs.length - 1];
    if (last && last.op === op) { last.last = k; last.n++; }
    else segs.push({ op, first: k, last: k, n: 1 });
  }
  // 数点だけの一致はノイズとして無視し、同じ事業者を結合し直す
  const long = (sg: Seg) => sg.n >= 4 && haversine(p.lat[sg.first], p.lon[sg.first], p.lat[sg.last], p.lon[sg.last]) > 800;
  segs = segs.filter(long);
  const merged: Seg[] = [];
  for (const sg of segs) {
    const last = merged[merged.length - 1];
    if (last && last.op === sg.op) { last.last = sg.last; last.n += sg.n; }
    else merged.push({ ...sg });
  }
  const cuts: number[] = [];
  for (let j = 0; j + 1 < merged.length; j++) {
    // 両方の事業者の駅（乗り換え駅）に最も近い点で切る。見つからなければ最も遅い点
    const opA = merged[j].op, opB = merged[j + 1].op;
    let best = -1, bd = 300;
    for (let k = merged[j].last; k <= merged[j + 1].first; k++) {
      for (const pl of geo.rail.nearPlatforms(p.lat[k], p.lon[k], bd)) {
        const ops = new Set(geo.rail.stations[pl.st].plats.map(([l]) => lines[l].op));
        if (ops.has(opA) && ops.has(opB) && pl.d < bd) { bd = pl.d; best = k; }
      }
    }
    if (best < 0) {
      let bv = Infinity;
      best = merged[j].last;
      for (let k = merged[j].last; k <= merged[j + 1].first; k++) {
        if (speeds[k - a] < bv) { bv = speeds[k - a]; best = k; }
      }
    }
    if (best > i0 && best < i1 && (!cuts.length || best > cuts[cuts.length - 1])) cuts.push(best);
  }
  return cuts;
}

const VEHICLE: Mode[] = ['bicycle', 'car', 'train', 'shinkansen', 'ship', 'plane'];

function buildLegs(p: Pts, a: number, b: number, geo: GeoContext): Leg[] {
  const { runs, speeds } = buildRuns(p, a, b);
  const lines = geo.rail.rail.lines;
  /**
   * lines: 路線ごとの近接点数
   * core: 乗っていたと強く推定できる路線（乗り続け/直通の判定に使う）
   * set: 通過駅の検出に使う路線
   */
  type Proto = {
    mode: Mode; i0: number; i1: number; inferred: boolean;
    lines: Map<number, number>; core: Set<number>; set: Set<number>;
    /** 空白区間の始点・終点付近の路線 */
    ends?: [Set<number>, Set<number>];
  };
  const topLines = (m: Map<number, number>) => {
    const top = [...m.entries()].sort((x, y) => y[1] - x[1]);
    return new Set(top.filter(([, c]) => c >= Math.max(1, (top[0]?.[1] ?? 0) * 0.3)).map(([l]) => l));
  };
  const protos: Proto[] = runs.flatMap((r): Proto | Proto[] => {
    if (r.kind === 'walk') return { mode: 'walk', i0: r.i0, i1: r.i1, inferred: false, lines: new Map(), core: new Set(), set: new Set() };
    if (r.kind === 'gap') {
      const mode = classifyGap(p, r.i0, geo);
      const x = geo.rail.nearLines(p.lat[r.i0], p.lon[r.i0], 120);
      const y = geo.rail.nearLines(p.lat[r.i1], p.lon[r.i1], 120);
      const core = new Set([...x.keys()].filter((l) => y.has(l)));
      const set = new Set([...x.keys(), ...y.keys()]);
      const ends: [Set<number>, Set<number>] = [new Set(x.keys()), new Set(y.keys())];
      return { mode, i0: r.i0, i1: r.i1, inferred: true, lines: new Map([...set].map((l) => [l, 1])), core, set, ends };
    }
    const f = legFeatures(p, r.i0, r.i1, speeds, a, geo);
    const mode = classifyVehicle(f);
    if (mode === 'train') {
      // 乗り換えの徒歩が短く記録に現れない場合（例: 改札内での短い乗り換え）、事業者が変わる所で区間を分ける
      const cuts = operatorCuts(p, r.i0, r.i1, speeds, a, geo);
      if (cuts.length) {
        const bounds = [r.i0, ...cuts, r.i1];
        return bounds.slice(0, -1).map((b0, j) => {
          const fj = legFeatures(p, b0, bounds[j + 1], speeds, a, geo);
          const cj = topLines(fj.lineCounts);
          return { mode, i0: b0, i1: bounds[j + 1], inferred: false, lines: fj.lineCounts, core: cj, set: cj };
        });
      }
    }
    const core = topLines(f.lineCounts);
    return { mode, i0: r.i0, i1: r.i1, inferred: false, lines: f.lineCounts, core, set: core };
  });
  // 電車区間に直接続く空白（地下区間）は、同じ事業者の路線を優先（地下区間で別事業者の路線が並走している場合など）
  const opsOf = (ls: Set<number>) => new Set([...ls].map((l) => lines[l].op));
  protos.forEach((pr, r) => {
    if (!pr.inferred) return;
    const nb = [protos[r - 1], protos[r + 1]].find((q) => q && !q.inferred && (q.mode === 'train' || q.mode === 'shinkansen') && q.core.size);
    if (!nb) return;
    const ops = opsOf(nb.core);
    const same = [...pr.set].filter((l) => ops.has(lines[l].op));
    if (same.length) {
      pr.core = new Set(same);
      if (pr.mode === 'unknown') pr.mode = nb.mode;
      // 同じ事業者の路線が片側にしか無い場合は乗り入れ（例: 地下鉄から郊外私鉄への直通運転）とみなし、反対側の路線も駅検出に使う
      const [xs, ys] = pr.ends!;
      const nearX = same.some((l) => xs.has(l)), nearY = same.some((l) => ys.has(l));
      pr.set = new Set(same);
      if (nearX && !nearY) for (const l of ys) pr.set.add(l);
      if (nearY && !nearX) for (const l of xs) pr.set.add(l);
    } else if (pr.core.size) pr.set = pr.core;
  });

  // 同じ乗り物に挟まれた短い乗り物区間（例: 船の途中で岸に近づいた区間）はその乗り物に揃える
  const isShortVeh = (pr: Proto) =>
    pr.mode !== 'walk' && (p.t[pr.i1] - p.t[pr.i0] < 5 * MIN || pathDist(p, pr.i0, pr.i1) < 3000);
  for (let r = 1; r < protos.length - 1; r++) {
    if (!isShortVeh(protos[r])) continue;
    let e = r;
    while (e + 1 < protos.length - 1 && isShortVeh(protos[e + 1])) e++;
    const left = protos[r - 1].mode, right = protos[e + 1].mode;
    if (left === right && VEHICLE.includes(left) && left !== 'train' && left !== 'shinkansen') {
      for (let k = r; k <= e; k++) protos[k].mode = left;
    }
    r = e;
  }

  // 不明な空白区間は隣の乗り物区間の手段で補う
  for (let r = 0; r < protos.length; r++) {
    if (protos[r].mode !== 'unknown') continue;
    const prevM = protos[r - 1]?.mode, nextM = protos[r + 1]?.mode;
    const pv = prevM && VEHICLE.includes(prevM) ? prevM : undefined;
    const nv = nextM && VEHICLE.includes(nextM) ? nextM : undefined;
    if (pv && nv && pv === nv) protos[r].mode = pv;
    else if (pv && !nv) protos[r].mode = pv;
    else if (nv && !pv) protos[r].mode = nv;
    else if (!pv && !nv && haversine(p.lat[protos[r].i0], p.lon[protos[r].i0], p.lat[protos[r].i1], p.lon[protos[r].i1]) < 2000)
      protos[r].mode = 'walk';
  }

  const isRail = (m: Mode) => m === 'train' || m === 'shinkansen';
  /** 同じ電車に乗り続けた/直通運転とみなせるか（路線か事業者が共通。路線が不明なら連続とみなす） */
  const railContinuous = (x: Proto, y: Proto, strict = false) => {
    if (!x.core.size || !y.core.size) return !strict;
    if ([...x.core].some((l) => y.core.has(l))) return true;
    const ox = opsOf(x.core);
    return [...opsOf(y.core)].some((o) => ox.has(o));
  };
  /** x の終わり付近と y の始め付近で進行方向が逆向き（折り返し）か */
  const reverses = (x: Proto, y: Proto) => {
    const back = (i1: number, i0: number) => {
      let k = i1;
      while (k > i0 && haversine(p.lat[k], p.lon[k], p.lat[i1], p.lon[i1]) < 1000) k--;
      return k;
    };
    const fwd = (i0: number, i1: number) => {
      let k = i0;
      while (k < i1 && haversine(p.lat[k], p.lon[k], p.lat[i0], p.lon[i0]) < 1000) k++;
      return k;
    };
    const xa = back(x.i1, x.i0), yb = fwd(y.i0, y.i1);
    const v1 = [p.lon[x.i1] - p.lon[xa], p.lat[x.i1] - p.lat[xa]];
    const v2 = [p.lon[yb] - p.lon[y.i0], p.lat[yb] - p.lat[y.i0]];
    const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
    if (!n1 || !n2) return false;
    return (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2) < -0.5;
  };
  const absorb = (x: Proto, y: Proto) => {
    x.i1 = y.i1;
    x.inferred = x.inferred || y.inferred;
    for (const [l, c] of y.lines) x.lines.set(l, (x.lines.get(l) ?? 0) + c);
    for (const l of y.set) x.set.add(l);
    for (const l of y.core) x.core.add(l);
  };

  let list = protos.map((pr) => ({ ...pr, lines: new Map(pr.lines), set: new Set(pr.set), core: new Set(pr.core) }));
  let changed = true;
  while (changed) {
    changed = false;
    const out: Proto[] = [];
    for (let r = 0; r < list.length; r++) {
      const pr = list[r];
      const last = out[out.length - 1];
      // 駅での短い停車・待ち合わせ（同じ路線/事業者の電車に挟まれた短い徒歩）や、乗り物の間のごく短い徒歩は吸収
      const nx = list[r + 1];
      if (last && nx && pr.mode === 'walk' && last.mode === nx.mode && VEHICLE.includes(last.mode)) {
        const dur = p.t[pr.i1] - p.t[pr.i0];
        const dist = pathDist(p, pr.i0, pr.i1);
        const short =
          dist < 40 ||
          (isRail(last.mode) && dur < 10 * MIN && dist < 1500 && railContinuous(last, nx, true) && !reverses(last, nx));
        if (short) {
          absorb(last, pr);
          absorb(last, nx);
          r++;
          changed = true;
          continue;
        }
      }
      if (last && last.mode === pr.mode && (!isRail(pr.mode) || (railContinuous(last, pr) && !reverses(last, pr)))) {
        absorb(last, pr);
        changed = true;
        continue;
      }
      out.push(pr);
    }
    list = out;
  }

  const legs: Leg[] = [];
  for (const pr of list) {
    const dist = pathDist(p, pr.i0, pr.i1);
    if (pr.mode === 'walk' && dist < 40) continue;
    const start = p.t[pr.i0], end = p.t[pr.i1];
    const sp: number[] = [];
    for (let k = pr.i0; k <= pr.i1; k++) sp.push(speeds[k - a]);
    const leg: Leg = {
      mode: pr.mode,
      i0: pr.i0,
      i1: pr.i1,
      start,
      end,
      dist,
      avgKmh: end > start ? (dist / ((end - start) / 1000)) * 3.6 : 0,
      maxKmh: pr.inferred && pr.i1 - pr.i0 === 1 ? (dist / Math.max(1, (end - start) / 1000)) * 3.6 : quantile(sp, 0.95),
      lines: [...pr.set].sort((x, y) => (pr.lines.get(y) ?? 0) - (pr.lines.get(x) ?? 0)),
      stations: [],
      inferred: pr.inferred,
    };
    if (leg.mode === 'train' || leg.mode === 'shinkansen') leg.stations = detectStations(p, leg, geo);
    legs.push(leg);
  }
  return legs;
}

// ------------------------------------------------------------
// 4. 通過駅の検出
// ------------------------------------------------------------
function detectStations(p: Pts, leg: Leg, geo: GeoContext): StationEvent[] {
  const lines = new Set(leg.lines);
  if (!lines.size) {
    // 路線が取れない場合は始点・終点付近の路線を使う
    for (const l of geo.rail.nearLines(p.lat[leg.i0], p.lon[leg.i0], 150).keys()) lines.add(l);
    for (const l of geo.rail.nearLines(p.lat[leg.i1], p.lon[leg.i1], 150).keys()) lines.add(l);
  }
  if (!lines.size) return [];
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let k = leg.i0; k <= leg.i1; k++) {
    minLat = Math.min(minLat, p.lat[k]); maxLat = Math.max(maxLat, p.lat[k]);
    minLon = Math.min(minLon, p.lon[k]); maxLon = Math.max(maxLon, p.lon[k]);
  }
  const pad = mToDeg(2000);
  const best = new Map<number, { t: number; d: number }>();
  for (const l of lines) {
    for (const pl of geo.rail.platsByLine.get(l) ?? []) {
      if (pl.lat < minLat - pad || pl.lat > maxLat + pad || pl.lon < minLon - pad * 1.25 || pl.lon > maxLon + pad * 1.25) continue;
      for (let k = leg.i0; k < leg.i1; k++) {
        const segLen = haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
        const thr = segLen > 1000 ? Math.max(150, segLen * 0.1) : 150;
        // 粗い棄却
        if (Math.abs(pl.lat - p.lat[k]) > mToDeg(segLen + thr) + 0.001 && Math.abs(pl.lat - p.lat[k + 1]) > mToDeg(segLen + thr) + 0.001) continue;
        const { d, t } = pointSegment(pl.lat, pl.lon, p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]);
        if (d > thr) continue;
        const tt = p.t[k] + t * (p.t[k + 1] - p.t[k]);
        const prev = best.get(pl.st);
        if (!prev || d < prev.d) best.set(pl.st, { t: tt, d });
      }
    }
  }
  const evs = [...best.entries()].sort((x, y) => x[1].t - y[1].t);
  // 始点・終点の駅が軌跡から少し離れていても拾う（乗車直後・降車直前に記録が無い場合）
  const mainOp = leg.lines.length ? geo.rail.rail.lines[leg.lines[0]].op : undefined;
  const endpoint = (k: number) => {
    const cands = geo.rail.nearPlatforms(p.lat[k], p.lon[k], 400, lines);
    return cands.find((c) => geo.rail.rail.lines[c.line].op === mainOp) ?? cands[0];
  };
  const s0 = endpoint(leg.i0), s1 = endpoint(leg.i1);
  if (s0 && !best.has(s0.st)) evs.unshift([s0.st, { t: leg.start, d: s0.d }]);
  if (s1 && !best.has(s1.st)) evs.push([s1.st, { t: leg.end, d: s1.d }]);
  // 始点・終点が別事業者の隣接駅（例: 大阪難波に対する JR難波）になった場合は、乗っていた事業者の駅を優先
  if (mainOp) {
    const hasOp = (st: number) => geo.rail.stations[st].plats.some(([l]) => geo.rail.rail.lines[l].op === mainOp);
    while (evs.length >= 2 && !hasOp(evs[0][0]) && hasOp(evs[1][0]) && evs[1][1].t - evs[0][1].t < 120e3) evs.shift();
    while (evs.length >= 2 && !hasOp(evs[evs.length - 1][0]) && hasOp(evs[evs.length - 2][0]) && evs[evs.length - 1][1].t - evs[evs.length - 2][1].t < 120e3) evs.pop();
  }
  return evs.map(([st, v], i) => ({
    st,
    t: v.t,
    kind: i === 0 ? 'board' : i === evs.length - 1 ? 'alight' : 'pass',
  }));
}

// ------------------------------------------------------------
// 5. 場所（滞在地のクラスタ）
// ------------------------------------------------------------
function buildPlaces(stays: StayIdx[], geo: GeoContext): { places: Place[]; stayPlace: number[] } {
  const grid = new GridIndex<number>(0.005);
  const places: Place[] = [];
  const sums: { lat: number; lon: number; n: number }[] = [];
  const stayPlace: number[] = [];
  for (const s of stays) {
    let bestId = -1, bestD = 150;
    for (const id of grid.around(s.lat, s.lon, 1)) {
      const d = haversine(s.lat, s.lon, places[id].lat, places[id].lon);
      if (d < bestD) { bestD = d; bestId = id; }
    }
    const dur = s.end - s.start;
    if (bestId < 0) {
      bestId = places.length;
      places.push({ id: bestId, lat: s.lat, lon: s.lon, visits: 0, totalMs: 0, first: s.start, last: s.start, autoName: '', muni: '' });
      sums.push({ lat: 0, lon: 0, n: 0 });
      grid.insert(s.lat, s.lon, bestId);
    }
    const pl = places[bestId];
    pl.visits++;
    pl.totalMs += dur;
    pl.last = s.start;
    const sm = sums[bestId];
    sm.lat += s.lat; sm.lon += s.lon; sm.n++;
    stayPlace.push(bestId);
  }
  for (const pl of places) {
    const sm = sums[pl.id];
    pl.lat = sm.lat / sm.n;
    pl.lon = sm.lon / sm.n;
    const mi = geo.muni.lookup(pl.lat, pl.lon);
    pl.muni = mi >= 0 ? geo.muni.features[mi].properties.pref + geo.muni.features[mi].properties.name : '';
    const st = geo.rail.nearPlatforms(pl.lat, pl.lon, 500)[0];
    pl.autoName = st ? `${geo.rail.stations[st.st].name}駅付近` : pl.muni || `${pl.lat.toFixed(4)}, ${pl.lon.toFixed(4)}`;
  }
  return { places, stayPlace };
}

// ------------------------------------------------------------
// メイン
// ------------------------------------------------------------
export function analyze(raw: RawLog, geo: GeoContext, progress?: (msg: string) => void): Analysis {
  progress?.('外れ値を除去しています');
  const { pts: p, removed } = cleanPoints(raw);
  const n = p.t.length;

  progress?.('滞在を検出しています');
  const stayIdx = detectStays(p);
  const { places, stayPlace } = buildPlaces(stayIdx, geo);

  progress?.('移動を区間に分けて手段を判定しています');
  const trips: Trip[] = [];
  const addTrip = (a: number, b: number, fromPlace: number, toPlace: number) => {
    if (b <= a) return;
    // 滞在の最後の点から出発までの長い空白（夜間など）は、ほぼ動いていなければ滞在の続きとみなす
    const near = (k: number) => haversine(p.lat[k], p.lon[k], p.lat[k + 1], p.lon[k + 1]) < 500;
    while (a < b && p.t[a + 1] - p.t[a] > TRIP_SPLIT_GAP_MS && near(a)) a++;
    while (b > a && p.t[b] - p.t[b - 1] > TRIP_SPLIT_GAP_MS && near(b - 1)) b--;
    // 長い空白で分割
    let s = a;
    for (let k = a; k < b; k++) {
      if (p.t[k + 1] - p.t[k] > TRIP_SPLIT_GAP_MS) {
        addTripPart(s, k, s === a ? fromPlace : -1, -1);
        s = k + 1;
      }
    }
    addTripPart(s, b, s === a ? fromPlace : -1, toPlace);
  };
  const addTripPart = (a: number, b: number, fromPlace: number, toPlace: number) => {
    if (b <= a) return;
    // 出発前・到着後に同じ場所付近（GPSのふらつき）で長く過ごした部分は移動から外す
    const edge = 250, edgeMs = 10 * MIN;
    let k = a;
    while (k < b && haversine(p.lat[a], p.lon[a], p.lat[k + 1], p.lon[k + 1]) < edge) k++;
    if (p.t[k] - p.t[a] > edgeMs) a = k;
    k = b;
    while (k > a && haversine(p.lat[b], p.lon[b], p.lat[k - 1], p.lon[k - 1]) < edge) k--;
    if (p.t[b] - p.t[k] > edgeMs) b = k;
    if (b <= a) return;
    const path = pathDist(p, a, b);
    const disp = haversine(p.lat[a], p.lon[a], p.lat[b], p.lon[b]);
    if (path < 300 || (disp < 150 && path < 1000)) return;
    const legs = buildLegs(p, a, b, geo);
    if (!legs.length) return;
    // 滞在の終わり（空白の間も滞在していたと推定した時刻）より前は移動に含めない
    if (fromPlace >= 0 && a === tripStartIdx && legs[0].start < prevStayEnd && prevStayEnd < legs[0].end) {
      const l = legs[0];
      l.start = prevStayEnd;
      l.avgKmh = (l.dist / Math.max(1, (l.end - l.start) / 1000)) * 3.6;
    }
    trips.push({
      id: trips.length,
      start: legs[0].start,
      end: p.t[b],
      fromPlace,
      toPlace,
      legs,
      dist: legs.reduce((s2, l) => s2 + l.dist, 0),
      date: dateKey(p.t[a]),
    });
  };
  let cursor = 0, lastPlace = -1, prevStayEnd = 0, tripStartIdx = -1;
  stayIdx.forEach((s, k) => {
    tripStartIdx = cursor;
    addTrip(cursor, s.i0, lastPlace, stayPlace[k]);
    prevStayEnd = s.end;
    cursor = s.i1;
    lastPlace = stayPlace[k];
  });
  tripStartIdx = cursor;
  addTrip(cursor, n - 1, lastPlace, -1);

  progress?.('市区町村を集計しています');
  const muniMap = new Map<number, { first: number; days: Set<string> }>();
  const days = new Set<string>();
  for (let k = 0; k < n; k++) {
    const dk = dateKey(p.t[k]);
    days.add(dk);
    if (p.acc[k] > 100) continue;
    const mi = geo.muni.lookup(p.lat[k], p.lon[k]);
    if (mi < 0) continue;
    let m = muniMap.get(mi);
    if (!m) muniMap.set(mi, (m = { first: p.t[k], days: new Set() }));
    m.days.add(dk);
  }
  const munis: MuniVisit[] = [...muniMap.entries()].map(([mi, m]) => ({
    code: geo.muni.features[mi].properties.code,
    pref: geo.muni.features[mi].properties.pref,
    name: geo.muni.features[mi].properties.name,
    first: m.first,
    days: m.days.size,
  }));

  const stays: Stay[] = stayIdx.map((s, k) => ({ start: s.start, end: s.end, lat: s.lat, lon: s.lon, place: stayPlace[k] }));
  return {
    pts: { t: p.t, lat: p.lat, lon: p.lon },
    stays,
    trips,
    places,
    munis,
    stats: {
      rawRows: raw.t.length,
      trackPoints: n,
      removedOutliers: removed,
      firstT: p.t[0] ?? 0,
      lastT: p.t[n - 1] ?? 0,
      days: days.size,
    },
  };
}
