import type { Mode } from '../core/types';

export const MODE_COLOR_VAR: Record<Mode, string> = {
  train: 'var(--m-train)',
  car: 'var(--m-car)',
  walk: 'var(--m-walk)',
  bicycle: 'var(--m-bicycle)',
  shinkansen: 'var(--m-shinkansen)',
  ship: 'var(--m-ship)',
  plane: 'var(--m-plane)',
  unknown: 'var(--m-unknown)',
};

/** 凡例・積み上げの並び順（カテゴリ色の固定順） */
export const MODE_ORDER: Mode[] = ['train', 'car', 'walk', 'bicycle', 'shinkansen', 'ship', 'plane', 'unknown'];

/** 地図(WebGL)用に CSS 変数を実際の色に解決する */
export function cssColor(v: string): string {
  const m = /var\((--[^)]+)\)/.exec(v);
  if (!m) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888';
}

const jst = (t: number) => new Date(t + 9 * 3600e3);
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtTime(t: number): string {
  const d = jst(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDate(key: string, withYear = true): string {
  const [y, m, d] = key.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}年` : ''}${m}月${d}日(${wd})`;
}

export function fmtDateTime(t: number): string {
  const d = jst(t);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${fmtTime(t)}`;
}

export function fmtKm(m: number): string {
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km).toLocaleString()}km`;
}

export function fmtDur(ms: number): string {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}時間${min % 60 ? `${min % 60}分` : ''}`;
  return `${Math.round(h / 24)}日`;
}

export function fmtHours(ms: number): string {
  const h = ms / 3600e3;
  return h < 10 ? `${h.toFixed(1)}時間` : `${Math.round(h).toLocaleString()}時間`;
}

export function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
