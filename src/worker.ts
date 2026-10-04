/// <reference lib="webworker" />
import { analyze } from './core/analyze';
import { parseCsvTexts } from './core/csv';
import { MuniIndex } from './core/land';
import { RailIndex } from './core/rail';
import type { Analysis, RailLine } from './core/types';

export type WorkerRequest = { type: 'analyze'; texts: string[] };
export type StationMeta = { name: string; x: number; y: number; lines: number[] };
export type WorkerResponse =
  | { type: 'progress'; msg: string }
  | { type: 'done'; analysis: Analysis; lines: RailLine[]; stations: StationMeta[] }
  | { type: 'error'; msg: string };

let geoPromise: Promise<{ rail: RailIndex; muni: MuniIndex }> | null = null;

function loadGeo() {
  geoPromise ??= (async () => {
    const get = (f: string) => fetch(new URL(`${import.meta.env.BASE_URL}geo/${f}`, self.location.origin)).then((r) => {
      if (!r.ok) throw new Error(`${f} を読み込めませんでした`);
      return r.json();
    });
    const [rail, stations, munis] = await Promise.all([get('rail.json'), get('stations.json'), get('municipalities.json')]);
    return { rail: new RailIndex(rail, stations), muni: new MuniIndex(munis.features) };
  })();
  return geoPromise;
}

const post = (m: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    post({ type: 'progress', msg: '鉄道・地図データを読み込んでいます' });
    const geo = await loadGeo();
    post({ type: 'progress', msg: 'CSV を読み込んでいます' });
    const raw = parseCsvTexts(e.data.texts);
    const analysis = analyze(raw, geo, (msg) => post({ type: 'progress', msg }));
    const stations: StationMeta[] = geo.rail.stations.map((s) => ({
      name: s.name,
      x: s.x,
      y: s.y,
      lines: [...new Set(s.plats.map((p) => p[0]))],
    }));
    post({ type: 'done', analysis, lines: geo.rail.rail.lines, stations }, [
      analysis.pts.t.buffer,
      analysis.pts.lat.buffer,
      analysis.pts.lon.buffer,
    ]);
  } catch (err) {
    post({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
  }
};
