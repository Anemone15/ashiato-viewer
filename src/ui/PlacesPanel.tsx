import { Fragment, useEffect, useMemo, useState } from 'react';
import type { MuniFeature } from '../core/land';
import type { PlaceName } from '../data/storage';
import { placeLabel, userPlaceName, type AppData } from './appdata';
import { cssColor, fmtDate, fmtDateTime, fmtHours } from './format';
import type { MapCtl } from './mapctl';

type Sort = 'time' | 'visits' | 'first' | 'last';
const SORT_LABEL: Record<Sort, string> = { time: '滞在時間', visits: '訪問回数', first: '初めて行った順（新しい順）', last: '最後に行った順' };

let muniCache: Promise<MuniFeature[]> | null = null;
const loadMunis = () =>
  (muniCache ??= fetch(`${import.meta.env.BASE_URL}geo/municipalities.json`).then((r) => r.json()).then((j) => j.features));

const jstDate = (t: number) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

export function PlacesPanel({
  data, ctl, names, setNames, sub, setSub, openDay,
}: {
  data: AppData;
  ctl: MapCtl;
  names: PlaceName[];
  setNames: (n: PlaceName[]) => void;
  sub: 'places' | 'munis';
  setSub: (s: 'places' | 'munis') => void;
  openDay: (d: string) => void;
}) {
  return (
    <div>
      <div className="seg" style={{ marginBottom: 8 }}>
        <button aria-pressed={sub === 'places'} onClick={() => setSub('places')}>よく行く場所</button>
        <button aria-pressed={sub === 'munis'} onClick={() => setSub('munis')}>市区町村の制覇</button>
      </div>
      {sub === 'places' ? (
        <Places data={data} ctl={ctl} names={names} setNames={setNames} openDay={openDay} />
      ) : (
        <Munis data={data} ctl={ctl} />
      )}
    </div>
  );
}

function Places({ data, ctl, names, setNames, openDay }: { data: AppData; ctl: MapCtl; names: PlaceName[]; setNames: (n: PlaceName[]) => void; openDay: (d: string) => void }) {
  const [sort, setSort] = useState<Sort>('time');
  const [sel, setSel] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    ctl.setData('places', {
      type: 'FeatureCollection',
      features: data.a.places.map((p) => ({
        type: 'Feature',
        properties: { id: p.id, h: p.totalMs / 3600e3 },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
    });
    ctl.onPickPlace = (id) => setSel(id);
  }, [ctl, data]);

  const list = useMemo(() => {
    const arr = data.a.places.filter((p) => {
      if (!filter) return true;
      const label = placeLabel(data, names, p.id);
      return label.includes(filter) || p.muni.includes(filter);
    });
    const key: Record<Sort, (p: (typeof arr)[0]) => number> = {
      time: (p) => -p.totalMs,
      visits: (p) => -p.visits,
      first: (p) => -p.first,
      last: (p) => -p.last,
    };
    return arr.sort((a, b) => key[sort](a) - key[sort](b));
  }, [data, names, sort, filter]);

  const selPlace = sel !== null ? data.a.places[sel] : null;
  useEffect(() => {
    if (selPlace) ctl.flyTo(selPlace.lon, selPlace.lat, 16);
  }, [ctl, selPlace]);

  const visits = useMemo(() => (sel === null ? [] : data.a.stays.filter((s) => s.place === sel).reverse()), [data, sel]);

  const rename = (name: string) => {
    if (!selPlace) return;
    const others = names.filter((n) => userPlaceName(selPlace, [n]) === undefined);
    setNames(name ? [...others, { lat: selPlace.lat, lon: selPlace.lon, name }] : others);
  };

  return (
    <div>
      {selPlace && (
        <div className="card selected">
          <div className="row">
            <strong className="grow">{placeLabel(data, names, selPlace.id)}</strong>
            <button className="btn icon" aria-label="閉じる" onClick={() => setSel(null)}>×</button>
          </div>
          <div className="muted small">{selPlace.muni} · {selPlace.visits}回 · 計{fmtHours(selPlace.totalMs)}</div>
          <label className="row small" style={{ marginTop: 6 }}>
            名前
            <input
              className="input grow"
              defaultValue={userPlaceName(selPlace, names) ?? ''}
              key={selPlace.id}
              placeholder={selPlace.autoName}
              onBlur={(e) => rename(e.target.value.trim())}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <div className="section">訪問履歴（新しい順）</div>
          <table className="data">
            <tbody>
              {visits.slice(0, 30).map((s, i) => (
                <tr key={i} className="clickable" onClick={() => openDay(jstDate(s.start))}>
                  <td>{fmtDateTime(s.start)}</td>
                  <td className="num">{fmtHours(s.end - s.start)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visits.length > 30 && <p className="muted small">ほか{visits.length - 30}回</p>}
        </div>
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並べ替え">
          {(Object.keys(SORT_LABEL) as Sort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
        <input className="input grow" placeholder="名前・市区町村で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>10分以上とどまった場所を{data.a.places.length.toLocaleString()}か所に分類しました。名前は場所を選んで付けられます。</p>
      <table className="data">
        <thead>
          <tr><th>場所</th><th className="num">回数</th><th className="num">滞在</th><th className="num">{sort === 'last' ? '最終' : '初訪問'}</th></tr>
        </thead>
        <tbody>
          {list.slice(0, limit).map((p) => (
            <tr key={p.id} className="clickable" onClick={() => setSel(p.id)}>
              <td>
                {placeLabel(data, names, p.id)}
                <div className="muted small">{p.muni}</div>
              </td>
              <td className="num">{p.visits}</td>
              <td className="num">{fmtHours(p.totalMs)}</td>
              <td className="num small">{fmtDate(jstDate(sort === 'last' ? p.last : p.first)).replace(/\(.\)/, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > limit && <button className="btn" style={{ marginTop: 8 }} onClick={() => setLimit(limit + 100)}>さらに表示</button>}
    </div>
  );
}

function Munis({ data, ctl }: { data: AppData; ctl: MapCtl }) {
  const [features, setFeatures] = useState<MuniFeature[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    loadMunis().then(setFeatures);
  }, []);
  const visited = useMemo(() => new Map(data.a.munis.map((m) => [m.code, m])), [data]);

  useEffect(() => {
    if (!features) return;
    const max = Math.max(1, ...data.a.munis.map((m) => m.days));
    const step = (d: number) => Math.min(6, 1 + Math.floor((Math.log(d) / Math.log(max + 1)) * 6));
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features
        .filter((f) => visited.has(f.properties.code))
        .map((f) => ({
          type: 'Feature',
          properties: { c: cssColor(`var(--seq-${step(visited.get(f.properties.code)!.days)})`) },
          geometry: f.geometry,
        })),
    };
    ctl.setData('munis', fc);
    ctl.fit([129, 31, 146, 45.5], 6);
  }, [ctl, features, visited, data]);

  const byPref = useMemo(() => {
    if (!features) return [];
    const m = new Map<string, { total: number; visited: { name: string; days: number; first: number }[] }>();
    for (const f of features) {
      const e = m.get(f.properties.pref) ?? { total: 0, visited: [] };
      e.total++;
      const v = visited.get(f.properties.code);
      if (v) e.visited.push({ name: f.properties.name, days: v.days, first: v.first });
      m.set(f.properties.pref, e);
    }
    return [...m.entries()].filter(([, e]) => e.visited.length).sort((a, b) => b[1].visited.length / b[1].total - a[1].visited.length / a[1].total);
  }, [features, visited]);

  if (!features) return <div className="loading"><div><div className="spinner" />境界データを読み込んでいます</div></div>;
  const total = features.length;
  return (
    <div>
      <div className="kpis">
        <div className="kpi"><div className="v">{visited.size} / {total}</div><div className="l">市区町村（政令市は区単位）</div></div>
        <div className="kpi"><div className="v">{byPref.length} / 47</div><div className="l">都道府県</div></div>
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>訪れた日数:</span>
        {[1, 2, 3, 4, 5, 6].map((s) => <span key={s}><i className="key" style={{ background: `var(--seq-${s})` }} /></span>)}
        <span>少 → 多</span>
      </div>
      <p className="muted small">電車などで通過しただけの市区町村も含みます。</p>
      <table className="data">
        <thead><tr><th>都道府県</th><th className="num">訪問</th><th className="num">割合</th></tr></thead>
        <tbody>
          {byPref.map(([pref, e]) => (
            <Fragment key={pref}>
              <tr className="clickable" onClick={() => setOpen(open === pref ? null : pref)}>
                <td>{open === pref ? '▾' : '▸'} {pref}</td>
                <td className="num">{e.visited.length} / {e.total}</td>
                <td className="num">{Math.round((e.visited.length / e.total) * 100)}%</td>
              </tr>
              {open === pref && (
                <tr>
                  <td colSpan={3} className="small">
                    {e.visited.sort((a, b) => b.days - a.days).map((v) => (
                      <span key={v.name} style={{ display: 'inline-block', marginRight: 10 }}>
                        {v.name}<span className="muted">（{v.days}日）</span>
                      </span>
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
