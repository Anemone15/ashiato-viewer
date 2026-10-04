import { useEffect, useMemo } from 'react';
import type { Mode, Trip } from '../core/types';
import { MODE_LABEL } from '../core/types';
import type { PlaceName } from '../data/storage';
import type { AppData } from './appdata';
import { fmtDate, fmtKm, MODE_COLOR_VAR, MODE_ORDER } from './format';
import { boundsOf, type MapCtl } from './mapctl';
import { TripCard } from './TripCard';

export interface AllView {
  style: 'lines' | 'heat';
  modes: Mode[];
  from?: string;
  to?: string;
}

export function PeriodPicker({ data, from, to, onChange }: {
  data: AppData;
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
}) {
  const years = useMemo(() => [...new Set(data.dates.map((d) => d.slice(0, 4)))], [data]);
  const yearOf = from && to && from.endsWith('-01-01') && to.endsWith('-12-31') && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : '';
  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="chip" aria-pressed={!from && !to} onClick={() => onChange(undefined, undefined)}>全期間</button>
        {years.map((y) => (
          <button key={y} className="chip" aria-pressed={yearOf === y} onClick={() => onChange(`${y}-01-01`, `${y}-12-31`)}>{y}年</button>
        ))}
      </div>
      <div className="row">
        <input className="input grow" type="date" value={from ?? ''} onChange={(e) => onChange(e.target.value || undefined, to)} aria-label="開始日" />
        <span className="muted">〜</span>
        <input className="input grow" type="date" value={to ?? ''} onChange={(e) => onChange(from, e.target.value || undefined)} aria-label="終了日" />
      </div>
    </div>
  );
}

export function ModeChips({ modes, onChange }: { modes: Mode[]; onChange: (m: Mode[]) => void }) {
  return (
    <div className="row">
      {MODE_ORDER.map((m) => (
        <button
          key={m}
          className="chip"
          aria-pressed={modes.includes(m)}
          onClick={() => onChange(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m])}
        >
          <i className="key" style={{ background: MODE_COLOR_VAR[m] }} />{MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

export function AllPanel({
  data, ctl, view, setView, selected, names, openDay,
}: {
  data: AppData;
  ctl: MapCtl;
  view: AllView;
  setView: (v: AllView) => void;
  selected: Trip | null;
  names: PlaceName[];
  openDay: (d: string, tripId?: number) => void;
}) {
  useEffect(() => {
    ctl.filterAll(view.from, view.to, view.modes);
  }, [ctl, view]);

  const trips = useMemo(
    () => data.a.trips.filter((t) => (!view.from || t.date >= view.from) && (!view.to || t.date <= view.to)),
    [data, view.from, view.to],
  );
  useEffect(() => {
    if (!selected) ctl.fit(boundsOf(data.a, trips.length > 400 ? trips.filter((_, i) => i % 10 === 0) : trips), 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  const dist = trips.reduce((s, t) => s + t.legs.filter((l) => view.modes.includes(l.mode)).reduce((a, l) => a + l.dist, 0), 0);

  return (
    <div>
      <div className="section">表示</div>
      <div className="seg">
        <button aria-pressed={view.style === 'lines'} onClick={() => setView({ ...view, style: 'lines' })}>移動手段ごとの軌跡</button>
        <button aria-pressed={view.style === 'heat'} onClick={() => setView({ ...view, style: 'heat' })}>ヒートマップ</button>
      </div>
      <div className="section">期間</div>
      <PeriodPicker data={data} from={view.from} to={view.to} onChange={(from, to) => setView({ ...view, from, to })} />
      {view.style === 'lines' && (
        <>
          <div className="section">移動手段</div>
          <ModeChips modes={view.modes} onChange={(modes) => setView({ ...view, modes })} />
        </>
      )}
      <p className="muted small">
        {trips.length.toLocaleString()}回の移動 · {fmtKm(dist)}
        {view.style === 'lines' ? '（線をクリックするとその移動の詳細を表示）' : ''}
      </p>
      {selected && (
        <>
          <div className="section">選択中の移動</div>
          <TripCard data={data} trip={selected} names={names} selected showDate />
          <button className="btn" onClick={() => openDay(selected.date, selected.id)}>{fmtDate(selected.date)} の記録を見る</button>
        </>
      )}
    </div>
  );
}
