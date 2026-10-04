import { useEffect, useMemo, useState } from 'react';
import { emptyQuery, searchTrips, type TripQuery } from '../core/query';
import type { PlaceName } from '../data/storage';
import type { AppData } from './appdata';
import { ModeChips, PeriodPicker } from './AllPanel';
import { fmtKm } from './format';
import { boundsOf, tripFeatures, type MapCtl } from './mapctl';
import { TripCard } from './TripCard';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function NumInput({ value, onChange, label, unit }: { value?: number; onChange: (v?: number) => void; label: string; unit: string }) {
  return (
    <label className="row" style={{ gap: 4 }}>
      <span className="small muted">{label}</span>
      <input
        className="input"
        style={{ width: 72 }}
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      <span className="small muted">{unit}</span>
    </label>
  );
}

export function SearchPanel({
  data, ctl, query, setQuery, selTrip, setSelTrip, names, openDay,
}: {
  data: AppData;
  ctl: MapCtl;
  query: TripQuery;
  setQuery: (q: TripQuery) => void;
  selTrip: number | null;
  setSelTrip: (id: number | null) => void;
  names: PlaceName[];
  openDay: (d: string, tripId?: number) => void;
}) {
  const [limit, setLimit] = useState(30);
  const q = query;
  const set = (patch: Partial<TripQuery>) => {
    setQuery({ ...q, ...patch });
    setLimit(30);
  };

  // 入力候補: 実際に記録のある駅（よく使う順）
  const stationOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of data.a.trips) for (const l of t.legs) for (const s of l.stations) {
      const n = data.stations[s.st].name;
      c.set(n, (c.get(n) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [data]);
  const known = useMemo(() => new Set(stationOptions), [stationOptions]);

  const hits = useMemo(() => searchTrips(data.a, data.stations, q), [data, q]);
  const isEmpty = !q.from && !q.to && !q.via.length && !q.modes.length && q.minKmh === undefined && q.minMinutes === undefined && q.minKm === undefined;

  useEffect(() => {
    const shown = isEmpty ? [] : hits.slice(0, 3000);
    ctl.setData('res', {
      type: 'FeatureCollection',
      features: shown.flatMap((h) => tripFeatures(data.a, h.trip, h.legs)),
    });
    if (shown.length && selTrip === null) ctl.fit(boundsOf(data.a, shown.slice(0, 300).map((h) => h.trip)), 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, data, hits, isEmpty]);

  const hitDist = hits.reduce((s, h) => s + h.legs.reduce((a, li) => a + h.trip.legs[li].dist, 0), 0);
  const days = new Set(hits.map((h) => h.trip.date)).size;
  const years = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hits) m.set(h.trip.date.slice(0, 4), (m.get(h.trip.date.slice(0, 4)) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [hits]);

  const stationInput = (value: string | undefined, onChange: (v?: string) => void, placeholder: string, label: string) => (
    <input
      className="input grow"
      list="station-list"
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value.replace(/駅$/, '') || undefined)}
      style={value && !known.has(value) ? { borderColor: 'var(--danger)' } : undefined}
    />
  );

  return (
    <div>
      <datalist id="station-list">
        {stationOptions.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div className="section">駅で探す</div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="small muted" style={{ width: 36 }}>乗車</span>
        {stationInput(q.from, (from) => set({ from }), '例: 新宿', '乗車駅')}
      </div>
      {q.via.map((v, i) => (
        <div className="row" style={{ marginBottom: 6 }} key={i}>
          <span className="small muted" style={{ width: 36 }}>経由</span>
          {stationInput(v, (nv) => set({ via: q.via.map((x, j) => (j === i ? nv ?? '' : x)) }), '経由駅', `経由駅${i + 1}`)}
          <button className="btn icon" aria-label="経由駅を削除" onClick={() => set({ via: q.via.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="small muted" style={{ width: 36 }}>降車</span>
        {stationInput(q.to, (to) => set({ to }), '例: 東京', '降車駅')}
      </div>
      <div className="row">
        <button className="btn" onClick={() => set({ via: [...q.via, ''] })}>＋ 経由駅を追加</button>
        <label className="row small" style={{ gap: 4 }}>
          <input type="checkbox" checked={!q.strictEnds} onChange={(e) => set({ strictEnds: !e.target.checked })} />
          乗車・降車駅に「通過」も含める
        </label>
      </div>

      <div className="section">移動手段・速さ</div>
      <ModeChips modes={q.modes} onChange={(modes) => set({ modes })} />
      <div className="row" style={{ marginTop: 8 }}>
        <NumInput label="平均時速" unit="km/h以上" value={q.minKmh} onChange={(minKmh) => set({ minKmh })} />
        <NumInput label="所要" unit="分以上" value={q.minMinutes} onChange={(minMinutes) => set({ minMinutes })} />
        <NumInput label="距離" unit="km以上" value={q.minKm} onChange={(minKm) => set({ minKm })} />
      </div>
      <p className="muted small" style={{ margin: '4px 0 0' }}>手段・速さの条件は、ひとつの区間（乗り物に乗っている間）ごとに判定します。</p>

      <details style={{ marginTop: 8 }}>
        <summary className="section" style={{ display: 'list-item' }}>期間・曜日・時間帯</summary>
        <PeriodPicker data={data} from={q.dateFrom} to={q.dateTo} onChange={(dateFrom, dateTo) => set({ dateFrom, dateTo })} />
        <div className="row" style={{ marginTop: 8 }}>
          {WD.map((w, i) => (
            <button key={w} className="chip" aria-pressed={q.weekdays.includes(i)} onClick={() => set({ weekdays: q.weekdays.includes(i) ? q.weekdays.filter((x) => x !== i) : [...q.weekdays, i] })}>{w}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <NumInput label="出発" unit="時から" value={q.hourFrom} onChange={(hourFrom) => set({ hourFrom })} />
          <NumInput label="" unit="時台まで" value={q.hourTo} onChange={(hourTo) => set({ hourTo })} />
        </div>
      </details>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => { setQuery(emptyQuery()); setSelTrip(null); }}>条件をクリア</button>
      </div>

      <div className="section">結果</div>
      {isEmpty ? (
        <div className="empty">駅や移動手段などの条件を入れてください</div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{hits.length.toLocaleString()}回</div><div className="l">{days.toLocaleString()}日</div></div>
            <div className="kpi"><div className="v">{fmtKm(hitDist)}</div><div className="l">該当区間の距離計</div></div>
          </div>
          {years.length > 1 && (
            <p className="muted small">{years.map(([y, n]) => `${y}年 ${n}回`).join(' / ')}</p>
          )}
          <div style={{ marginTop: 8 }}>
            {[...hits].reverse().slice(0, limit).map((h) => (
              <div key={h.trip.id}>
                <TripCard
                  data={data}
                  trip={h.trip}
                  names={names}
                  showDate
                  legFilter={h.legs}
                  selected={selTrip === h.trip.id}
                  onClick={() => setSelTrip(selTrip === h.trip.id ? null : h.trip.id)}
                />
                {selTrip === h.trip.id && (
                  <button className="btn" style={{ margin: '-2px 0 10px' }} onClick={() => openDay(h.trip.date, h.trip.id)}>この日の記録を見る</button>
                )}
              </div>
            ))}
            {hits.length > limit && <button className="btn" onClick={() => setLimit(limit + 50)}>さらに表示（残り{hits.length - limit}件）</button>}
          </div>
        </>
      )}
    </div>
  );
}
