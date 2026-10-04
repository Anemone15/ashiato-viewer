import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyQuery, type TripQuery } from './core/query';
import {
  clearFiles, fetchServerFile, fetchServerIndex, loadFiles, loadPlaceNames, sameAsServer, saveFiles, savePlaceNames,
  type PlaceName, type StoredFile,
} from './data/storage';
import { buildAppData, type AppData } from './ui/appdata';
import { boundsOf, dateNum, MapCtl, tripFeatures, type LayerGroup } from './ui/mapctl';
import { dateKey } from './core/geo';
import { MODE_LABEL } from './core/types';
import { cssColor, MODE_COLOR_VAR, MODE_ORDER } from './ui/format';
import { DayPanel } from './ui/DayPanel';
import { AllPanel, type AllView } from './ui/AllPanel';
import { StatsPanel } from './ui/StatsPanel';
import { SearchPanel } from './ui/SearchPanel';
import { PlacesPanel } from './ui/PlacesPanel';
import { DataPanel } from './ui/DataPanel';
import type { WorkerResponse } from './worker';

type Tab = 'day' | 'all' | 'stats' | 'search' | 'places' | 'data';
const TABS: [Tab, string][] = [
  ['day', '日別'],
  ['all', '全期間'],
  ['stats', '集計'],
  ['search', '経路検索'],
  ['places', '場所'],
  ['data', 'データ'],
];

export function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<MapCtl | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [progress, setProgress] = useState<string | null>('準備しています');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('day');
  const [date, setDate] = useState('');
  const [selTrip, setSelTrip] = useState<number | null>(null);
  const [placeNames, setPlaceNamesState] = useState<PlaceName[]>(loadPlaceNames);
  const [query, setQuery] = useState<TripQuery>(emptyQuery);
  const [allView, setAllView] = useState<AllView>({ style: 'lines', modes: [...MODE_ORDER] });
  const [placesSub, setPlacesSub] = useState<'places' | 'munis'>('places');
  const workerRef = useRef<Worker | null>(null);

  const setPlaceNames = useCallback((n: PlaceName[]) => {
    setPlaceNamesState(n);
    savePlaceNames(n);
  }, []);

  // 地図
  useEffect(() => {
    const c = new MapCtl(mapEl.current!);
    setCtl(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(mapEl.current!);
    return () => {
      ro.disconnect();
      c.map.remove();
    };
  }, []);

  // 解析（Web Worker で実行）
  const analyzeFiles = useCallback((files: StoredFile[]) => {
    setError(null);
    setProgress('解析を始めています');
    workerRef.current?.terminate();
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') setProgress(m.msg);
      else if (m.type === 'error') {
        setError(m.msg);
        setProgress(null);
      } else {
        const d = buildAppData(m.analysis, m.lines, m.stations, files.map((f) => ({ name: f.name, size: f.size })));
        setData(d);
        setDate((cur) => (cur && d.byDate.has(cur) ? cur : d.dates[d.dates.length - 1] ?? ''));
        setSelTrip(null);
        setProgress(null);
        w.terminate();
      }
    };
    w.postMessage({ type: 'analyze', texts: files.map((f) => f.text) });
  }, []);

  // 起動時: Mac の data/ フォルダ → 端末内の保存データ の順に探す
  const syncFromServer = useCallback(async (force = false) => {
    const local = await loadFiles();
    const server = await fetchServerIndex();
    if (server && server.length && (force || !sameAsServer(local, server))) {
      setProgress('サーバーから CSV を取得しています');
      const files: StoredFile[] = [];
      for (const s of server) files.push({ name: s.name, size: s.size, mtime: s.mtime, text: await fetchServerFile(s.name) });
      const manual = local.filter((f) => f.mtime === undefined);
      await saveFiles(files, true);
      await saveFiles(manual);
      analyzeFiles([...files, ...manual]);
    } else if (local.length) {
      analyzeFiles(local);
    } else {
      setProgress(null);
      setTab('data');
    }
  }, [analyzeFiles]);

  useEffect(() => {
    syncFromServer().catch((e) => {
      setError(String(e));
      setProgress(null);
    });
  }, [syncFromServer]);

  const importFiles = useCallback(async (list: File[]) => {
    const added: StoredFile[] = [];
    for (const f of list) added.push({ name: f.name, size: f.size, text: await f.text() });
    await saveFiles(added);
    analyzeFiles(await loadFiles());
    setTab('day');
  }, [analyzeFiles]);

  const clearAll = useCallback(async () => {
    await clearFiles();
    setData(null);
    setSelTrip(null);
  }, []);

  // ---- 地図のレイヤー表示 ----
  const groups: LayerGroup[] = useMemo(() => {
    switch (tab) {
      case 'day': return ['day', 'sel'];
      case 'all': return [allView.style === 'heat' ? 'heat' : 'all', 'sel'];
      case 'stats': return ['all', 'sel'];
      case 'search': return ['results', 'sel'];
      case 'places': return placesSub === 'munis' ? ['munis'] : ['places'];
      default: return ['all'];
    }
  }, [tab, allView.style, placesSub]);

  useEffect(() => {
    ctl?.show(groups);
  }, [ctl, groups]);

  // 全期間の軌跡（重いので必要になったら一度だけ作る）
  const allBuilt = useRef<AppData | null>(null);
  useEffect(() => {
    if (!ctl || !data || allBuilt.current === data) return;
    if (!groups.includes('all') && !groups.includes('heat')) return;
    allBuilt.current = data;
    const features = data.a.trips.flatMap((t) => tripFeatures(data.a, t));
    ctl.setData('all', { type: 'FeatureCollection', features });
    const pts: GeoJSON.Feature[] = [];
    const { lat, lon, t } = data.a.pts;
    for (let k = 0; k < lat.length; k++) {
      pts.push({ type: 'Feature', properties: { d: dateNum(dateKey(t[k])) }, geometry: { type: 'Point', coordinates: [lon[k], lat[k]] } });
    }
    ctl.setData('heatpts', { type: 'FeatureCollection', features: pts });
  }, [ctl, data, groups]);

  // 選択中のトリップ
  const selected = data && selTrip !== null ? data.a.trips[selTrip] : null;
  useEffect(() => {
    if (!ctl || !data) return;
    if (!selected) {
      ctl.setData('sel', { type: 'FeatureCollection', features: [] });
      ctl.setData('sel-st', { type: 'FeatureCollection', features: [] });
      ctl.clearMarkers();
      return;
    }
    ctl.setData('sel', { type: 'FeatureCollection', features: tripFeatures(data.a, selected) });
    const st: GeoJSON.Feature[] = [];
    const labels: { lon: number; lat: number; text: string; cls?: string }[] = [];
    for (const l of selected.legs) {
      const many = l.stations.length > 10;
      for (const s of l.stations) {
        const m = data.stations[s.st];
        const end = s.kind !== 'pass';
        st.push({ type: 'Feature', properties: { end: end ? 1 : 0 }, geometry: { type: 'Point', coordinates: [m.x, m.y] } });
        if (end || !many) labels.push({ lon: m.x, lat: m.y, text: m.name, cls: end ? 'st-label end' : 'st-label' });
      }
    }
    ctl.setData('sel-st', { type: 'FeatureCollection', features: st });
    ctl.whenReady().then(() => ctl.setLabels(labels));
    ctl.fit(boundsOf(data.a, [selected]));
  }, [ctl, data, selected]);

  useEffect(() => {
    if (!ctl) return;
    ctl.onPickTrip = (id) => {
      setSelTrip(id);
      if (tab === 'day' && data) setDate(data.a.trips[id].date);
    };
    ctl.onPickPlace = () => {};
  }, [ctl, tab, data]);

  const openDay = useCallback((d: string, tripId?: number) => {
    setDate(d);
    setSelTrip(tripId ?? null);
    setTab('day');
  }, []);

  const searchFrom = useCallback((q: TripQuery) => {
    setQuery(q);
    setSelTrip(null);
    setTab('search');
  }, []);

  const legend = (
    <div className="map-legend" aria-label="移動手段の凡例">
      {MODE_ORDER.filter((m) => m !== 'unknown').map((m) => (
        <span key={m}><i className="key line" style={{ background: cssColor(MODE_COLOR_VAR[m]) }} />{MODE_LABEL[m]}</span>
      ))}
    </div>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="header">
          <h1>足跡ビューア</h1>
          {data && <span className="sub">{data.dates[0]?.replaceAll('-', '/')} 〜 {data.dates[data.dates.length - 1]?.replaceAll('-', '/')}</span>}
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} disabled={!data && id !== 'data'}>
              {label}
            </button>
          ))}
        </nav>
        <div className="panel">
          {progress ? (
            <div className="loading"><div><div className="spinner" />{progress}</div></div>
          ) : error ? (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>エラー: {error}</div>
          ) : null}
          {!progress && data && ctl && tab === 'day' && (
            <DayPanel data={data} ctl={ctl} date={date} setDate={setDate} selTrip={selTrip} setSelTrip={setSelTrip} names={placeNames} />
          )}
          {!progress && data && ctl && tab === 'all' && (
            <AllPanel data={data} ctl={ctl} view={allView} setView={setAllView} selected={selected} names={placeNames} openDay={openDay} />
          )}
          {!progress && data && ctl && tab === 'stats' && <StatsPanel data={data} ctl={ctl} onSearch={searchFrom} />}
          {!progress && data && ctl && tab === 'search' && (
            <SearchPanel data={data} ctl={ctl} query={query} setQuery={setQuery} selTrip={selTrip} setSelTrip={setSelTrip} names={placeNames} openDay={openDay} />
          )}
          {!progress && data && ctl && tab === 'places' && (
            <PlacesPanel data={data} ctl={ctl} names={placeNames} setNames={setPlaceNames} sub={placesSub} setSub={setPlacesSub} openDay={openDay} />
          )}
          {!progress && tab === 'data' && (
            <DataPanel data={data} onImport={importFiles} onReloadServer={() => syncFromServer(true)} onClear={clearAll} />
          )}
        </div>
      </aside>
      <div className="map-wrap">
        <div ref={mapEl} className="map" />
        {(tab === 'day' || tab === 'all' || tab === 'search' || tab === 'stats') && allView.style !== 'heat' && legend}
      </div>
    </div>
  );
}
