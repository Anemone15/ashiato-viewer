const R = 6371008.8;
const RAD = Math.PI / 180;

/** 2点間の距離 (m) */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 局所平面近似で点Pと線分ABの距離と射影パラメータを返す（数km以内の精度で十分）。
 * 経度方向は緯度のcosで補正する。
 */
export function pointSegment(
  plat: number, plon: number,
  alat: number, alon: number,
  blat: number, blon: number,
): { d: number; t: number } {
  const k = Math.cos(plat * RAD);
  const ax = (alon - plon) * k, ay = alat - plat;
  const bx = (blon - plon) * k, by = blat - plat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.sqrt(cx * cx + cy * cy) * RAD * R, t };
}

/** 緯度経度グリッドの空間インデックス */
export class GridIndex<T> {
  private cells = new Map<number, T[]>();
  constructor(readonly size: number) {}
  private key(ix: number, iy: number) {
    return ix * 100000 + iy;
  }
  cellOf(lat: number, lon: number): [number, number] {
    return [Math.floor(lon / this.size), Math.floor(lat / this.size)];
  }
  insertBBox(minLat: number, minLon: number, maxLat: number, maxLon: number, v: T) {
    const [x0, y0] = this.cellOf(minLat, minLon);
    const [x1, y1] = this.cellOf(maxLat, maxLon);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(v);
      }
    }
  }
  insert(lat: number, lon: number, v: T) {
    this.insertBBox(lat, lon, lat, lon, v);
  }
  /** 点を含むセルの要素 */
  at(lat: number, lon: number): T[] | undefined {
    const [x, y] = this.cellOf(lat, lon);
    return this.cells.get(this.key(x, y));
  }
  /** 点の周囲 (2r+1)^2 セルの要素 */
  around(lat: number, lon: number, r = 1): T[] {
    const [cx, cy] = this.cellOf(lat, lon);
    const out: T[] = [];
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        const arr = this.cells.get(this.key(x, y));
        if (arr) for (const v of arr) out.push(v);
      }
    }
    return out;
  }
}

/** メートルを緯度方向の度数に */
export const mToDeg = (m: number) => m / 111320;

export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(arr: number[], q: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** JST の日付キー YYYY-MM-DD */
export function dateKey(t: number): string {
  return new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
}
