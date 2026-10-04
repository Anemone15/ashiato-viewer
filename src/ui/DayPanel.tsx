import { useEffect, useMemo } from 'react';
import type { Mode } from '../core/types';
import { MODE_LABEL } from '../core/types';
import type { PlaceName } from '../data/storage';
import { placeLabel, type AppData } from './appdata';
import { fmtDate, fmtDur, fmtKm, MODE_COLOR_VAR, MODE_ORDER } from './format';
import { boundsOf, tripFeatures, type MapCtl } from './mapctl';
import { TripCard } from './TripCard';

export function DayPanel({
  data, ctl, date, setDate, selTrip, setSelTrip, names,
}: {
  data: AppData;
  ctl: MapCtl;
  date: string;
  setDate: (d: string) => void;
  selTrip: number | null;
  setSelTrip: (id: number | null) => void;
  names: PlaceName[];
}) {
  const trips = useMemo(() => data.byDate.get(date) ?? [], [data, date]);
  const idx = data.dates.indexOf(date);
  const prev = idx > 0 ? data.dates[idx - 1] : idx < 0 ? data.dates.filter((d) => d < date).pop() : undefined;
  const next = idx >= 0 ? data.dates[idx + 1] : data.dates.find((d) => d > date);

  const stays = useMemo(() => {
    if (!trips.length) return [];
    const t0 = trips[0].start, t1 = trips[trips.length - 1].end;
    return data.a.stays.filter((s) => s.end >= t0 && s.start <= t1);
  }, [data, trips]);

  useEffect(() => {
    ctl.setData('day', { type: 'FeatureCollection', features: trips.flatMap((t) => tripFeatures(data.a, t)) });
    ctl.setData('stays', {
      type: 'FeatureCollection',
      features: stays.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
    });
    ctl.whenReady().then(() => {
      const seen = new Set<number>();
      ctl.setStayLabels(
        stays.filter((s) => (seen.has(s.place) ? false : (seen.add(s.place), true)))
          .map((s) => ({ lon: s.lon, lat: s.lat, text: placeLabel(data, names, s.place) })),
      );
    });
    if (selTrip === null || !trips.some((t) => t.id === selTrip)) ctl.fit(boundsOf(data.a, trips), 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, data, trips, stays, names]);

  const totals = useMemo(() => {
    const m = new Map<Mode, { dist: number; ms: number }>();
    for (const t of trips) for (const l of t.legs) {
      const e = m.get(l.mode) ?? { dist: 0, ms: 0 };
      e.dist += l.dist;
      e.ms += l.end - l.start;
      m.set(l.mode, e);
    }
    return MODE_ORDER.filter((x) => m.has(x)).map((x) => ({ mode: x, ...m.get(x)! }));
  }, [trips]);
  const dayDist = totals.reduce((s, x) => s + x.dist, 0);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn icon" onClick={() => prev && setDate(prev)} disabled={!prev} aria-label="前の記録がある日">◀</button>
        <input
          className="input grow"
          type="date"
          value={date}
          min={data.dates[0]}
          max={data.dates[data.dates.length - 1]}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <button className="btn icon" onClick={() => next && setDate(next)} disabled={!next} aria-label="次の記録がある日">▶</button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{date && fmtDate(date)}</strong>
        <span className="muted">{trips.length ? `${trips.length}回の移動 · ${fmtKm(dayDist)}` : ''}</span>
      </div>
      {totals.length > 0 && (
        <div className="legend" style={{ marginTop: 6 }}>
          {totals.map((t) => (
            <span key={t.mode}><i className="key" style={{ background: MODE_COLOR_VAR[t.mode] }} />{MODE_LABEL[t.mode]} {fmtKm(t.dist)} / {fmtDur(t.ms)}</span>
          ))}
        </div>
      )}
      {!trips.length && <div className="empty">この日の移動記録はありません</div>}
      <div style={{ marginTop: 10 }}>
        {trips.map((t) => (
          <TripCard
            key={t.id}
            data={data}
            trip={t}
            names={names}
            selected={t.id === selTrip}
            onClick={() => setSelTrip(t.id === selTrip ? null : t.id)}
          />
        ))}
      </div>
    </div>
  );
}
