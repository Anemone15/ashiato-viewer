import { GridIndex, haversine, mToDeg, pointSegment } from './geo';
import { RailData, StationData } from './types';

/** 線路までの距離を判定する最大距離 (m) */
export const RAIL_NEAR_M = 60;

interface SegRef {
  line: number;
  ax: number; ay: number; bx: number; by: number;
}

interface PlatRef {
  st: number; // stations index
  line: number;
  lat: number;
  lon: number;
}

export class RailIndex {
  private segGrid = new GridIndex<SegRef>(0.002);
  private platGrid = new GridIndex<PlatRef>(0.01);
  readonly platsByLine = new Map<number, PlatRef[]>();
  /** 駅名 → stations の index 一覧 */
  readonly byName = new Map<string, number[]>();

  constructor(readonly rail: RailData, readonly stations: StationData[]) {
    const pad = mToDeg(RAIL_NEAR_M) * 1.3;
    for (const [line, c] of rail.segs) {
      for (let i = 0; i + 3 < c.length; i += 2) {
        const ax = c[i], ay = c[i + 1], bx = c[i + 2], by = c[i + 3];
        this.segGrid.insertBBox(
          Math.min(ay, by) - pad, Math.min(ax, bx) - pad,
          Math.max(ay, by) + pad, Math.max(ax, bx) + pad,
          { line, ax, ay, bx, by },
        );
      }
    }
    stations.forEach((s, st) => {
      for (const [line, lon, lat] of s.plats) {
        const p = { st, line, lat, lon };
        this.platGrid.insert(lat, lon, p);
        let arr = this.platsByLine.get(line);
        if (!arr) this.platsByLine.set(line, (arr = []));
        arr.push(p);
      }
      const arr = this.byName.get(s.name) ?? [];
      arr.push(st);
      this.byName.set(s.name, arr);
    });
  }

  /** 点から maxM 以内にある路線と距離 */
  nearLines(lat: number, lon: number, maxM = RAIL_NEAR_M): Map<number, number> {
    const out = new Map<number, number>();
    const segs = this.segGrid.at(lat, lon);
    if (!segs) return out;
    for (const s of segs) {
      const { d } = pointSegment(lat, lon, s.ay, s.ax, s.by, s.bx);
      if (d <= maxM) {
        const prev = out.get(s.line);
        if (prev === undefined || d < prev) out.set(s.line, d);
      }
    }
    return out;
  }

  /** 点の近くのホーム（駅×路線） */
  nearPlatforms(lat: number, lon: number, maxM: number, lines?: Set<number>): (PlatRef & { d: number })[] {
    const r = Math.max(1, Math.ceil(mToDeg(maxM) / 0.01));
    const out: (PlatRef & { d: number })[] = [];
    for (const p of this.platGrid.around(lat, lon, r)) {
      if (lines && !lines.has(p.line)) continue;
      const d = haversine(lat, lon, p.lat, p.lon);
      if (d <= maxM) out.push({ ...p, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  stationLabel(st: number): string {
    return this.stations[st].name;
  }

  /** 同名駅が複数ある場合に区別できるラベル（例: 大久保（JR東日本 中央線）） */
  stationLongLabel(st: number): string {
    const s = this.stations[st];
    const same = this.byName.get(s.name) ?? [];
    if (same.length <= 1) return s.name;
    const l = this.rail.lines[s.plats[0][0]];
    return `${s.name}（${l.op} ${l.name}）`;
  }

  lineLabel(line: number): string {
    const l = this.rail.lines[line];
    return `${l.op} ${l.name}`;
  }
}
