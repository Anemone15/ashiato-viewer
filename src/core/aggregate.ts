// 条件に合う移動を、指定したキーでグループ化して集計する
import type { FilterContext, LegMatch, TripMatch } from './filter';
import { FilterError } from './filter';
import { Leg, MODE_LABEL, Trip } from './types';

export const LEG_GROUP_KEYS = [
  'mode', 'year', 'month', 'date', 'weekday', 'hour', 'line', 'operator',
  'board', 'alight', 'station', 'section', 'fromPlace', 'toPlace',
] as const;
export const TRIP_GROUP_KEYS = ['year', 'month', 'date', 'weekday', 'hour', 'fromPlace', 'toPlace', 'route', 'mainMode'] as const;
export type GroupKey = (typeof LEG_GROUP_KEYS)[number] | (typeof TRIP_GROUP_KEYS)[number];

export interface AggRow {
  /** groupBy の各キーの値 */
  key: Record<string, string>;
  count: number;
  distanceKm: number;
  durationHours: number;
  /** 合計距離 ÷ 合計時間 */
  avgKmh: number;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const jst = (t: number) => new Date(t + 9 * 3600e3);

function timeKey(k: string, t: number): string {
  const d = jst(t);
  const iso = d.toISOString();
  switch (k) {
    case 'year': return iso.slice(0, 4);
    case 'month': return iso.slice(0, 7);
    case 'date': return iso.slice(0, 10);
    case 'weekday': return `${d.getUTCDay()}:${WD[d.getUTCDay()]}`;
    case 'hour': return String(d.getUTCHours()).padStart(2, '0');
  }
  return '';
}

/** 区間1つに対するキーの値（駅などは複数になりうる） */
function legKeyValues(ctx: FilterContext, trip: Trip, l: Leg, k: string): string[] {
  const st = l.stations;
  const name = (i: number) => ctx.stationName(i);
  switch (k) {
    case 'mode': return [MODE_LABEL[l.mode]];
    case 'year': case 'month': case 'date': case 'weekday': case 'hour': return [timeKey(k, l.start)];
    case 'line': return l.lines.length ? [ctx.lineLabel(l.lines[0])] : [];
    case 'operator': return l.lines.length ? [ctx.lineOp(l.lines[0])] : [];
    case 'board': return st.length ? [name(st[0].st)] : [];
    case 'alight': return st.length >= 2 ? [name(st[st.length - 1].st)] : [];
    case 'station': return [...new Set(st.map((s) => name(s.st)))];
    case 'section': return st.length >= 2 ? [`${name(st[0].st)}→${name(st[st.length - 1].st)}`] : [];
    case 'fromPlace': return [trip.fromPlace >= 0 ? ctx.placeLabel(trip.fromPlace) : '不明'];
    case 'toPlace': return [trip.toPlace >= 0 ? ctx.placeLabel(trip.toPlace) : '不明'];
  }
  throw new FilterError(`区間の集計では groupBy に "${k}" は使えません`, { allowed: LEG_GROUP_KEYS });
}

function tripKeyValues(ctx: FilterContext, t: Trip, k: string): string[] {
  switch (k) {
    case 'year': case 'month': case 'date': case 'weekday': case 'hour': return [timeKey(k, t.start)];
    case 'fromPlace': return [t.fromPlace >= 0 ? ctx.placeLabel(t.fromPlace) : '不明'];
    case 'toPlace': return [t.toPlace >= 0 ? ctx.placeLabel(t.toPlace) : '不明'];
    case 'route': return [`${t.fromPlace >= 0 ? ctx.placeLabel(t.fromPlace) : '不明'}→${t.toPlace >= 0 ? ctx.placeLabel(t.toPlace) : '不明'}`];
    case 'mainMode': {
      const main = [...t.legs].sort((x, y) => y.dist - x.dist)[0];
      return [main ? MODE_LABEL[main.mode] : '不明'];
    }
  }
  throw new FilterError(`トリップの集計では groupBy に "${k}" は使えません`, { allowed: TRIP_GROUP_KEYS });
}

function cross(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, vals) => acc.flatMap((a) => vals.map((v) => [...a, v])), [[]]);
}

function finish(m: Map<string, AggRow & { ms: number; m: number }>, sort: 'count' | 'distance' | 'duration' | 'key'): AggRow[] {
  const rows = [...m.values()].map((r) => ({
    key: r.key,
    count: r.count,
    distanceKm: Math.round(r.m / 100) / 10,
    durationHours: Math.round((r.ms / 3600e3) * 10) / 10,
    avgKmh: r.ms ? Math.round((r.m / 1000 / (r.ms / 3600e3)) * 10) / 10 : 0,
  }));
  const keyStr = (r: AggRow) => Object.values(r.key).join('\u0000');
  return rows.sort((a, b) =>
    sort === 'key' ? keyStr(a).localeCompare(keyStr(b)) :
    sort === 'distance' ? b.distanceKm - a.distanceKm :
    sort === 'duration' ? b.durationHours - a.durationHours :
    b.count - a.count,
  );
}

type Acc = Map<string, AggRow & { ms: number; m: number }>;
function add(m: Acc, groupBy: string[], vals: string[], dist: number, ms: number) {
  const id = vals.join('\u0000');
  let r = m.get(id);
  if (!r) {
    r = { key: Object.fromEntries(groupBy.map((g, i) => [g, vals[i]])), count: 0, distanceKm: 0, durationHours: 0, avgKmh: 0, ms: 0, m: 0 };
    m.set(id, r);
  }
  r.count++;
  r.m += dist;
  r.ms += ms;
}

export function aggregateLegs(ctx: FilterContext, legs: LegMatch[], groupBy: string[], sort: 'count' | 'distance' | 'duration' | 'key' = 'count'): AggRow[] {
  const m: Acc = new Map();
  for (const { trip, leg } of legs) {
    for (const vals of cross(groupBy.map((k) => legKeyValues(ctx, trip, leg, k)))) add(m, groupBy, vals, leg.dist, leg.end - leg.start);
  }
  return finish(m, sort);
}

export function aggregateTrips(ctx: FilterContext, trips: TripMatch[], groupBy: string[], sort: 'count' | 'distance' | 'duration' | 'key' = 'count'): AggRow[] {
  const m: Acc = new Map();
  for (const { trip } of trips) {
    for (const vals of cross(groupBy.map((k) => tripKeyValues(ctx, trip, k)))) add(m, groupBy, vals, trip.dist, trip.end - trip.start);
  }
  return finish(m, sort);
}
