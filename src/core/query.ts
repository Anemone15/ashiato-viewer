import { Analysis, Leg, Mode, MODES, Trip } from './types';

export interface StationName { name: string }

// ------------------------------------------------------------
// 経路検索
// ------------------------------------------------------------
export interface TripQuery {
  /** 乗車駅（または通過駅）名 */
  from?: string;
  /** 途中で通過/乗降した駅（順序どおり） */
  via: string[];
  /** 降車駅（または通過駅）名 */
  to?: string;
  /** true: 乗車駅/降車駅として一致したものだけ。false: 通過も含める */
  strictEnds: boolean;
  modes: Mode[]; // 空 = すべて
  dateFrom?: string;
  dateTo?: string;
  minKmh?: number;
  minMinutes?: number;
  minKm?: number;
  /** 0=日〜6=土。空 = すべて */
  weekdays: number[];
  hourFrom?: number;
  hourTo?: number;
}

export const emptyQuery = (): TripQuery => ({ via: [], strictEnds: true, modes: [], weekdays: [] });

export interface TripHit {
  trip: Trip;
  /** 条件に一致した区間の index */
  legs: number[];
}

function legMatches(l: Leg, q: TripQuery): boolean {
  if (q.modes.length && !q.modes.includes(l.mode)) return false;
  if (q.minKmh !== undefined && l.avgKmh < q.minKmh) return false;
  if (q.minMinutes !== undefined && (l.end - l.start) / 60e3 < q.minMinutes) return false;
  if (q.minKm !== undefined && l.dist / 1000 < q.minKm) return false;
  return true;
}

const jstDate = (t: number) => new Date(t + 9 * 3600e3);

export function searchTrips(a: Analysis, stationNames: StationName[], q: TripQuery): TripHit[] {
  const hits: TripHit[] = [];
  const via = q.via.filter(Boolean);
  const hasStation = !!(q.from || q.to || via.length);
  const hasLegCond = q.modes.length > 0 || q.minKmh !== undefined || q.minMinutes !== undefined || q.minKm !== undefined;
  for (const trip of a.trips) {
    if (q.dateFrom && trip.date < q.dateFrom) continue;
    if (q.dateTo && trip.date > q.dateTo) continue;
    const d = jstDate(trip.start);
    if (q.weekdays.length && !q.weekdays.includes(d.getUTCDay())) continue;
    if (q.hourFrom !== undefined && d.getUTCHours() < q.hourFrom) continue;
    if (q.hourTo !== undefined && d.getUTCHours() > q.hourTo) continue;

    let legs: number[] = [];
    if (hasStation) {
      // トリップ内の全駅イベントを時刻順に並べ、from → via... → to の順に現れるかを見る
      const evs: { name: string; kind: string; leg: number }[] = [];
      trip.legs.forEach((l, li) => l.stations.forEach((s) => evs.push({ name: stationNames[s.st].name, kind: s.kind, leg: li })));
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
      if (q.from && !find(q.from, q.strictEnds ? 'board' : undefined)) continue;
      let ok = true;
      for (const v of via) if (!find(v)) { ok = false; break; }
      if (!ok) continue;
      if (q.to && !find(q.to, q.strictEnds ? 'alight' : undefined)) continue;
      legs = [...used];
      if (hasLegCond && !legs.some((li) => legMatches(trip.legs[li], q))) continue;
    } else if (hasLegCond) {
      legs = trip.legs.map((l, i) => (legMatches(l, q) ? i : -1)).filter((i) => i >= 0);
      if (!legs.length) continue;
    } else {
      legs = trip.legs.map((_, i) => i);
    }
    hits.push({ trip, legs });
  }
  return hits;
}

// ------------------------------------------------------------
// 集計
// ------------------------------------------------------------
export interface ModeTotal { mode: Mode; count: number; dist: number; ms: number }

export function inRange(trip: Trip, from?: string, to?: string) {
  return (!from || trip.date >= from) && (!to || trip.date <= to);
}

export function modeTotals(trips: Trip[]): ModeTotal[] {
  const m = new Map<Mode, ModeTotal>(MODES.map((mode) => [mode, { mode, count: 0, dist: 0, ms: 0 }]));
  for (const t of trips) for (const l of t.legs) {
    const e = m.get(l.mode)!;
    e.count++;
    e.dist += l.dist;
    e.ms += l.end - l.start;
  }
  return [...m.values()];
}

/** 月別・手段別の距離 (km) */
export function monthlyByMode(trips: Trip[]): { month: string; values: Record<Mode, number> }[] {
  const m = new Map<string, Record<Mode, number>>();
  for (const t of trips) {
    const key = t.date.slice(0, 7);
    let v = m.get(key);
    if (!v) m.set(key, (v = Object.fromEntries(MODES.map((x) => [x, 0])) as Record<Mode, number>));
    for (const l of t.legs) v[l.mode] += l.dist / 1000;
  }
  // 空の月も埋める
  const keys = [...m.keys()].sort();
  if (!keys.length) return [];
  const out: { month: string; values: Record<Mode, number> }[] = [];
  let [y, mo] = keys[0].split('-').map(Number);
  const [y1, m1] = keys[keys.length - 1].split('-').map(Number);
  while (y < y1 || (y === y1 && mo <= m1)) {
    const k = `${y}-${String(mo).padStart(2, '0')}`;
    out.push({ month: k, values: m.get(k) ?? (Object.fromEntries(MODES.map((x) => [x, 0])) as Record<Mode, number>) });
    if (++mo > 12) { mo = 1; y++; }
  }
  return out;
}

export interface RankItem { key: string; label: string; count: number; extra?: number }

function rank(map: Map<string, RankItem>, n: number) {
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

/** よく乗る区間（乗車駅→降車駅）、乗車駅、降車駅、路線 */
export function railRankings(trips: Trip[], stationNames: StationName[], lineLabel: (l: number) => string, n = 30) {
  const sections = new Map<string, RankItem>();
  const boards = new Map<string, RankItem>();
  const alights = new Map<string, RankItem>();
  const passes = new Map<string, RankItem>();
  const lines = new Map<string, RankItem>();
  const inc = (m: Map<string, RankItem>, key: string, label: string, extra = 0) => {
    const e = m.get(key) ?? { key, label, count: 0, extra: 0 };
    e.count++;
    e.extra! += extra;
    m.set(key, e);
  };
  for (const t of trips) for (const l of t.legs) {
    if (l.mode !== 'train' && l.mode !== 'shinkansen') continue;
    if (l.lines.length) inc(lines, String(l.lines[0]), lineLabel(l.lines[0]), l.dist / 1000);
    const evs = l.stations;
    for (const s of evs) inc(passes, stationNames[s.st].name, stationNames[s.st].name);
    if (evs.length < 2) continue;
    const a = stationNames[evs[0].st].name, b = stationNames[evs[evs.length - 1].st].name;
    inc(boards, a, a);
    inc(alights, b, b);
    inc(sections, `${a}→${b}`, `${a} → ${b}`, l.dist / 1000);
  }
  return {
    sections: rank(sections, n),
    boards: rank(boards, n),
    alights: rank(alights, n),
    passes: rank(passes, n),
    lines: rank(lines, n),
  };
}

/** 曜日×時間帯の移動回数（トリップ開始時刻） */
export function weekHourMatrix(trips: Trip[]): number[][] {
  const m = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const t of trips) {
    const d = jstDate(t.start);
    m[d.getUTCDay()][d.getUTCHours()]++;
  }
  return m;
}
