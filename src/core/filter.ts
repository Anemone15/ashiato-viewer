// 高度なフィルター検索（UI・CLI・HTTP API・MCP で共通）
import { haversine } from './geo';
import { Analysis, Leg, Mode, Trip } from './types';

/** フィルターの解決に必要な名前・地理情報 */
export interface FilterContext {
  a: Analysis;
  stationName: (st: number) => string;
  lineLabel: (l: number) => string;
  lineOp: (l: number) => string;
  placeLabel: (id: number) => string;
  homeId: number;
  /** 点 → 市区町村（海上・国外は null）。市区町村/都道府県での絞り込みに使う */
  muniAt?: (lat: number, lon: number) => { code: string; pref: string; name: string } | null;
}

export interface Filter {
  // ---- 日時（トリップ検索ではトリップの出発、区間検索では区間の開始時刻で判定。JST） ----
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  /** 0=日〜6=土 */
  weekdays?: number[];
  /** 出発時刻の「時」の範囲（両端を含む）。hourFrom > hourTo なら日付をまたぐ（例: 22〜5） */
  hourFrom?: number;
  hourTo?: number;

  // ---- 駅（鉄道区間の乗車・通過・降車駅） ----
  from?: string;
  via?: string[];
  to?: string;
  /** true（既定）: from は乗車駅、to は降車駅として一致したものだけ。false: 通過も含める */
  strictEnds?: boolean;

  // ---- 区間（乗り物に乗っている間）の条件 ----
  modes?: Mode[];
  /** 路線名の部分一致（例: "環状線", "奈良線"） */
  line?: string;
  /** 事業者名の部分一致（例: "近畿日本鉄道", "西日本旅客鉄道"） */
  operator?: string;
  minKmh?: number; // 平均時速
  maxKmh?: number;
  /** 区間内の最高速度（95パーセンタイル）の下限 */
  minTopKmh?: number;
  minMinutes?: number;
  maxMinutes?: number;
  minKm?: number;
  maxKm?: number;
  /** true: 記録の途切れを推定で補った区間だけ / false: 除外 */
  inferred?: boolean;

  // ---- 場所・エリア ----
  /** 出発地の名前の部分一致。"home" または "自宅" で自宅（推定） */
  fromPlace?: string;
  toPlace?: string;
  /** この地点の半径 radiusM 以内を通った */
  near?: { lat: number; lon: number; radiusM: number };
  /** 通過した都道府県・市区町村（部分一致。例: "京都府", "大阪市北区"） */
  prefecture?: string;
  municipality?: string;
}

export type SortKey = 'start' | '-start' | 'distance' | '-distance' | 'duration' | '-duration' | 'speed' | '-speed';

export class FilterError extends Error {
  constructor(message: string, readonly hint?: unknown) {
    super(message);
  }
}

const jst = (t: number) => new Date(t + 9 * 3600e3);

function hourOk(t: number, f: Filter): boolean {
  const h = jst(t).getUTCHours();
  const { hourFrom: a, hourTo: b } = f;
  if (a === undefined && b === undefined) return true;
  if (a !== undefined && b !== undefined && a > b) return h >= a || h <= b;
  return (a === undefined || h >= a) && (b === undefined || h <= b);
}

function dateOk(date: string, t: number, f: Filter): boolean {
  if (f.dateFrom && date < f.dateFrom) return false;
  if (f.dateTo && date > f.dateTo) return false;
  if (f.weekdays?.length && !f.weekdays.includes(jst(t).getUTCDay())) return false;
  return hourOk(t, f);
}

const legDate = (l: Leg) => jst(l.start).toISOString().slice(0, 10);

export function hasLegConditions(f: Filter): boolean {
  return !!(
    f.modes?.length || f.line || f.operator ||
    f.minKmh !== undefined || f.maxKmh !== undefined || f.minTopKmh !== undefined ||
    f.minMinutes !== undefined || f.maxMinutes !== undefined ||
    f.minKm !== undefined || f.maxKm !== undefined || f.inferred !== undefined
  );
}

function legMatches(ctx: FilterContext, l: Leg, f: Filter): boolean {
  if (f.modes?.length && !f.modes.includes(l.mode)) return false;
  if (f.line && !l.lines.some((x) => ctx.lineLabel(x).includes(f.line!))) return false;
  if (f.operator && !l.lines.some((x) => ctx.lineOp(x).includes(f.operator!))) return false;
  if (f.minKmh !== undefined && l.avgKmh < f.minKmh) return false;
  if (f.maxKmh !== undefined && l.avgKmh > f.maxKmh) return false;
  if (f.minTopKmh !== undefined && l.maxKmh < f.minTopKmh) return false;
  const min = (l.end - l.start) / 60e3;
  if (f.minMinutes !== undefined && min < f.minMinutes) return false;
  if (f.maxMinutes !== undefined && min > f.maxMinutes) return false;
  if (f.minKm !== undefined && l.dist / 1000 < f.minKm) return false;
  if (f.maxKm !== undefined && l.dist / 1000 > f.maxKm) return false;
  if (f.inferred !== undefined && l.inferred !== f.inferred) return false;
  return true;
}

function placeOk(ctx: FilterContext, id: number, q?: string): boolean {
  if (!q) return true;
  if (id < 0) return false;
  if ((q === 'home' || q === '自宅') && id === ctx.homeId) return true;
  return ctx.placeLabel(id).includes(q);
}

// 区間ごとの通過市区町村（重いので一度だけ計算）
const areaCache = new WeakMap<Leg, { prefs: Set<string>; munis: Set<string> }>();
function legAreas(ctx: FilterContext, l: Leg) {
  let c = areaCache.get(l);
  if (!c) {
    c = { prefs: new Set(), munis: new Set() };
    const { lat, lon } = ctx.a.pts;
    for (let k = l.i0; k <= l.i1; k++) {
      const m = ctx.muniAt?.(lat[k], lon[k]);
      if (m) {
        c.prefs.add(m.pref);
        c.munis.add(m.pref + m.name);
      }
    }
    areaCache.set(l, c);
  }
  return c;
}

function legSpatialOk(ctx: FilterContext, l: Leg, f: Filter): boolean {
  if (f.near) {
    const { lat, lon } = ctx.a.pts;
    let hit = false;
    for (let k = l.i0; k <= l.i1 && !hit; k++) hit = haversine(lat[k], lon[k], f.near.lat, f.near.lon) <= f.near.radiusM;
    if (!hit) return false;
  }
  if (f.prefecture || f.municipality) {
    if (!ctx.muniAt) throw new FilterError('この環境では市区町村での絞り込みが使えません');
    const c = legAreas(ctx, l);
    if (f.prefecture && ![...c.prefs].some((p) => p.includes(f.prefecture!))) return false;
    if (f.municipality && ![...c.munis].some((m) => m.includes(f.municipality!))) return false;
  }
  return true;
}

/** 駅の並び from → via… → to を探し、使った区間の index を返す（見つからなければ null） */
function matchStations(ctx: FilterContext, legs: Leg[], legIdx: number[], f: Filter): Set<number> | null {
  const via = (f.via ?? []).filter(Boolean);
  if (!f.from && !f.to && !via.length) return new Set(legIdx);
  const strict = f.strictEnds !== false;
  const evs: { name: string; kind: string; leg: number }[] = [];
  for (const li of legIdx) for (const s of legs[li].stations) evs.push({ name: ctx.stationName(s.st), kind: s.kind, leg: li });
  let pos = 0;
  const used = new Set<number>();
  const find = (name: string, kind?: string) => {
    for (let i = pos; i < evs.length; i++) {
      if (evs[i].name === name && (!kind || evs[i].kind === kind)) {
        pos = i + 1;
        used.add(evs[i].leg);
        return true;
      }
    }
    return false;
  };
  if (f.from && !find(f.from, strict ? 'board' : undefined)) return null;
  for (const v of via) if (!find(v)) return null;
  if (f.to && !find(f.to, strict ? 'alight' : undefined)) return null;
  return used;
}

export interface TripMatch {
  trip: Trip;
  /** 条件に一致した区間の index */
  legs: number[];
}

/** 条件に合うトリップ（出発〜到着の1回の移動）を探す */
export function filterTrips(ctx: FilterContext, f: Filter): TripMatch[] {
  const out: TripMatch[] = [];
  const legCond = hasLegConditions(f);
  for (const trip of ctx.a.trips) {
    if (!dateOk(trip.date, trip.start, f)) continue;
    if (!placeOk(ctx, trip.fromPlace, f.fromPlace) || !placeOk(ctx, trip.toPlace, f.toPlace)) continue;
    const all = trip.legs.map((_, i) => i);
    const used = matchStations(ctx, trip.legs, all, f);
    if (!used) continue;
    const stationQuery = !!(f.from || f.to || f.via?.some(Boolean));
    let legs = stationQuery ? [...used] : all;
    if (legCond) {
      legs = legs.filter((li) => legMatches(ctx, trip.legs[li], f));
      if (!legs.length) continue;
    }
    if ((f.near || f.prefecture || f.municipality) && !trip.legs.some((l) => legSpatialOk(ctx, l, f))) continue;
    out.push({ trip, legs: legs.sort((x, y) => x - y) });
  }
  return out;
}

export interface LegMatch {
  trip: Trip;
  leg: Leg;
  index: number;
}

/** 条件に合う区間（乗り物に乗っている間・歩いている間）を探す。駅条件は区間内の乗車・通過・降車駅で判定 */
export function filterLegs(ctx: FilterContext, f: Filter): LegMatch[] {
  const out: LegMatch[] = [];
  for (const trip of ctx.a.trips) {
    if (f.dateTo && trip.date > f.dateTo) continue;
    if (!placeOk(ctx, trip.fromPlace, f.fromPlace) || !placeOk(ctx, trip.toPlace, f.toPlace)) continue;
    trip.legs.forEach((leg, index) => {
      if (!dateOk(legDate(leg), leg.start, f)) return;
      if (!legMatches(ctx, leg, f)) return;
      if (!matchStations(ctx, trip.legs, [index], f)) return;
      if (!legSpatialOk(ctx, leg, f)) return;
      out.push({ trip, leg, index });
    });
  }
  return out;
}

const tripDur = (t: Trip) => t.end - t.start;
const tripKmh = (t: Trip) => (t.dist / Math.max(1, tripDur(t) / 1000)) * 3.6;

export function sortTrips(m: TripMatch[], key: SortKey = '-start'): TripMatch[] {
  const desc = key.startsWith('-');
  const k = key.replace('-', '');
  const v = (x: TripMatch) => (k === 'distance' ? x.trip.dist : k === 'duration' ? tripDur(x.trip) : k === 'speed' ? tripKmh(x.trip) : x.trip.start);
  return [...m].sort((x, y) => (desc ? v(y) - v(x) : v(x) - v(y)));
}

export function sortLegs(m: LegMatch[], key: SortKey = '-start'): LegMatch[] {
  const desc = key.startsWith('-');
  const k = key.replace('-', '');
  const v = (x: LegMatch) => (k === 'distance' ? x.leg.dist : k === 'duration' ? x.leg.end - x.leg.start : k === 'speed' ? x.leg.avgKmh : x.leg.start);
  return [...m].sort((x, y) => (desc ? v(y) - v(x) : v(x) - v(y)));
}
