export type Mode = 'walk' | 'bicycle' | 'car' | 'train' | 'shinkansen' | 'ship' | 'plane' | 'unknown';

export const MODES: Mode[] = ['walk', 'bicycle', 'car', 'train', 'shinkansen', 'ship', 'plane', 'unknown'];

export const MODE_LABEL: Record<Mode, string> = {
  walk: '徒歩',
  bicycle: '自転車',
  car: '車・バス',
  train: '電車',
  shinkansen: '新幹線',
  ship: '船',
  plane: '飛行機',
  unknown: '不明',
};

/** CSVの「状態」列 */
export const STATUS = { pass: 0, move: 1, depart: 2, stay: 3, other: 4 } as const;

/** CSVから読み込んだ生データ（列指向） */
export interface RawLog {
  t: Float64Array; // epoch ms
  lat: Float64Array;
  lon: Float64Array;
  acc: Float32Array; // NaN = 不明
  status: Uint8Array;
}

/** 鉄道データ（public/geo/rail.json） */
export interface RailLine {
  name: string;
  op: string;
  /** 1 新幹線, 2 JR在来線, 3 公営, 4 民営, 5 第三セクター */
  kind: number;
}
export interface RailData {
  lines: RailLine[];
  segs: [number, number[]][]; // [lineIdx, [lon,lat,lon,lat,...]]
}
export interface StationData {
  code: string;
  name: string;
  x: number;
  y: number;
  plats: [number, number, number][]; // [lineIdx, lon, lat]
}

export interface Stay {
  start: number;
  end: number;
  lat: number;
  lon: number;
  place: number;
}

export interface StationEvent {
  /** stations 配列の index */
  st: number;
  t: number;
  kind: 'board' | 'pass' | 'alight';
}

export interface Leg {
  mode: Mode;
  /** cleaned points の index 範囲 [i0, i1] */
  i0: number;
  i1: number;
  start: number;
  end: number;
  dist: number; // m
  avgKmh: number;
  maxKmh: number;
  /** 判定に使った主な路線（lines の index） */
  lines: number[];
  stations: StationEvent[];
  /** データの空白区間を推定で補ったか */
  inferred: boolean;
}

export interface Trip {
  id: number;
  start: number;
  end: number;
  fromPlace: number; // -1 = 不明
  toPlace: number;
  legs: Leg[];
  dist: number;
  date: string;
}

export interface Place {
  id: number;
  lat: number;
  lon: number;
  visits: number;
  totalMs: number;
  first: number;
  last: number;
  /** 自動で付けた名前 */
  autoName: string;
  muni: string;
}

export interface MuniVisit {
  code: string;
  pref: string;
  name: string;
  first: number;
  days: number;
}

export interface Analysis {
  /** 外れ値除去・時刻順に並べ替えた軌跡 */
  pts: { t: Float64Array; lat: Float64Array; lon: Float64Array };
  stays: Stay[];
  trips: Trip[];
  places: Place[];
  munis: MuniVisit[];
  stats: {
    rawRows: number;
    trackPoints: number;
    removedOutliers: number;
    firstT: number;
    lastT: number;
    days: number;
  };
}
