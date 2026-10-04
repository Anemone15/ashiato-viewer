import type { Leg, Trip } from '../core/types';
import { MODE_LABEL } from '../core/types';
import type { PlaceName } from '../data/storage';
import { lineLabel, placeLabel, type AppData } from './appdata';
import { fmtDate, fmtDur, fmtKm, fmtTime, MODE_COLOR_VAR } from './format';

export function legSummary(data: AppData, l: Leg): string {
  const parts: string[] = [MODE_LABEL[l.mode]];
  if ((l.mode === 'train' || l.mode === 'shinkansen') && l.lines.length) parts[0] += ` ${lineLabel(data, l.lines[0])}`;
  return parts.join(' ');
}

function LegRow({ data, l, expanded }: { data: AppData; l: Leg; expanded: boolean }) {
  const st = l.stations;
  const first = st[0], last = st[st.length - 1];
  const name = (i: number) => data.stations[i].name;
  return (
    <li>
      <span className="t">{fmtTime(l.start)}</span>
      <span className={`bar${l.inferred ? ' inferred' : ''}`} style={{ background: MODE_COLOR_VAR[l.mode] }} />
      <span>
        <span>{legSummary(data, l)}</span>
        <span className="muted small"> · {fmtKm(l.dist)} · {fmtDur(l.end - l.start)}{l.mode !== 'walk' ? ` · 平均${Math.round(l.avgKmh)}km/h` : ''}{l.inferred ? ' · 記録の途切れを推定' : ''}</span>
        {st.length >= 2 && (
          <div className="stations">
            <b>{name(first.st)}</b> → <b>{name(last.st)}</b>
            {expanded && st.length > 2 && <> （経由: {st.slice(1, -1).map((s) => name(s.st)).join('・')}）</>}
            {!expanded && st.length > 2 && <span className="muted"> （{st.length - 2}駅通過）</span>}
          </div>
        )}
        {expanded && l.mode !== 'walk' && st.length < 2 && l.lines.length > 0 && l.mode !== 'train' && l.mode !== 'shinkansen' && (
          <div className="stations muted">近くの路線: {l.lines.slice(0, 2).map((x) => lineLabel(data, x)).join('、')}</div>
        )}
      </span>
    </li>
  );
}

export function TripCard({
  data, trip, names, selected, onClick, showDate, legFilter,
}: {
  data: AppData;
  trip: Trip;
  names: PlaceName[];
  selected?: boolean;
  onClick?: () => void;
  showDate?: boolean;
  legFilter?: number[];
}) {
  const total = trip.legs.reduce((s, l) => s + l.dist, 0) || 1;
  const from = trip.fromPlace >= 0 ? placeLabel(data, names, trip.fromPlace) : '不明';
  const to = trip.toPlace >= 0 ? placeLabel(data, names, trip.toPlace) : '不明';
  const legs = trip.legs.map((l, i) => ({ l, i })).filter(({ l, i }) => (legFilter ? legFilter.includes(i) || selected : l.mode !== 'walk' || selected));
  return (
    <div className={`card${onClick ? ' clickable' : ''}${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="trip-head">
        {showDate && <span className="muted small">{fmtDate(trip.date)}</span>}
        <span className="time">{fmtTime(trip.start)}–{fmtTime(trip.end)}</span>
        <span className="dist">{fmtKm(trip.dist)}</span>
      </div>
      <div className="trip-route">{from} → {to}</div>
      <div className="modebar" aria-hidden>
        {trip.legs.map((l, i) => (
          <span key={i} style={{ flex: Math.max(l.dist / total, 0.02), background: MODE_COLOR_VAR[l.mode] }} />
        ))}
      </div>
      <ul className="legs">
        {legs.map(({ l, i }) => <LegRow key={i} data={data} l={l} expanded={!!selected} />)}
      </ul>
    </div>
  );
}
