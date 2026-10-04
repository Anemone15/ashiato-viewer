import { GridIndex } from './geo';

export interface MuniFeature {
  properties: { code: string; pref: string; name: string };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

interface MuniRef {
  idx: number;
  minX: number; minY: number; maxX: number; maxY: number;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 市区町村ポリゴンによる点→市区町村の判定（陸/海の判定にも使う） */
export class MuniIndex {
  private grid = new GridIndex<MuniRef>(0.1);
  private cache = new Map<number, number>();

  constructor(readonly features: MuniFeature[]) {
    features.forEach((f, idx) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const poly of f.geometry.coordinates) {
        for (const [x, y] of poly[0]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      this.grid.insertBBox(minY, minX, maxY, maxX, { idx, minX, minY, maxX, maxY });
    });
  }

  /** 点を含む市区町村の index（海上・国外は -1）。約100m単位でキャッシュ */
  lookup(lat: number, lon: number): number {
    const key = Math.round(lat * 1000) * 1e6 + Math.round(lon * 1000);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let res = -1;
    const cands = this.grid.at(lat, lon);
    if (cands) {
      for (const c of cands) {
        if (lon < c.minX || lon > c.maxX || lat < c.minY || lat > c.maxY) continue;
        const f = this.features[c.idx];
        for (const poly of f.geometry.coordinates) {
          if (!inRing(lon, lat, poly[0])) continue;
          let hole = false;
          for (let h = 1; h < poly.length; h++) if (inRing(lon, lat, poly[h])) { hole = true; break; }
          if (!hole) { res = c.idx; break; }
        }
        if (res >= 0) break;
      }
    }
    this.cache.set(key, res);
    return res;
  }
}
