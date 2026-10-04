import type { Analysis, Place, RailLine, Trip } from '../core/types';
import type { PlaceName } from '../data/storage';
import { haversine } from '../core/geo';
import type { StationMeta } from '../worker';

export interface AppData {
  a: Analysis;
  lines: RailLine[];
  stations: StationMeta[];
  byDate: Map<string, Trip[]>;
  /** トリップのある日付（昇順） */
  dates: string[];
  /** 滞在時間が最も長い場所（自宅と推定） */
  homeId: number;
  files: { name: string; size: number }[];
}

export function buildAppData(a: Analysis, lines: RailLine[], stations: StationMeta[], files: { name: string; size: number }[]): AppData {
  const byDate = new Map<string, Trip[]>();
  for (const t of a.trips) {
    const arr = byDate.get(t.date) ?? [];
    arr.push(t);
    byDate.set(t.date, arr);
  }
  let homeId = -1, best = 0;
  for (const p of a.places) if (p.totalMs > best) { best = p.totalMs; homeId = p.id; }
  return { a, lines, stations, byDate, dates: [...byDate.keys()].sort(), homeId, files };
}

export function lineLabel(d: AppData, l: number): string {
  const x = d.lines[l];
  return x ? `${x.op.replace(/旅客鉄道$/, '').replace('大阪市高速電気軌道', 'Osaka Metro')} ${x.name}` : '';
}

export function userPlaceName(p: Place, names: PlaceName[]): string | undefined {
  let best: PlaceName | undefined, bd = 150;
  for (const n of names) {
    const d = haversine(p.lat, p.lon, n.lat, n.lon);
    if (d < bd) { bd = d; best = n; }
  }
  return best?.name;
}

export function placeLabel(d: AppData, names: PlaceName[], id: number): string {
  const p = d.a.places[id];
  if (!p) return '不明';
  return userPlaceName(p, names) ?? (id === d.homeId ? '自宅（推定）' : p.autoName);
}
