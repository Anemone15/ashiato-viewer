import { useEffect, useMemo, useState } from 'react';
import { emptyQuery, modeTotals, monthlyByMode, railRankings, weekHourMatrix, type RankItem, type TripQuery } from '../core/query';
import type { Mode } from '../core/types';
import { MODE_LABEL } from '../core/types';
import { lineLabel, type AppData } from './appdata';
import { PeriodPicker } from './AllPanel';
import { StackedBars, WeekHourHeat } from './charts';
import { fmtHours, fmtKm, MODE_COLOR_VAR, MODE_ORDER } from './format';
import type { MapCtl } from './mapctl';

type RankKind = 'sections' | 'boards' | 'alights' | 'passes' | 'lines';
const RANK_LABEL: Record<RankKind, string> = {
  sections: 'よく乗る区間',
  boards: '乗車駅',
  alights: '降車駅',
  passes: '通過した駅',
  lines: '路線',
};

export function StatsPanel({ data, ctl, onSearch }: { data: AppData; ctl: MapCtl; onSearch: (q: TripQuery) => void }) {
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [metric, setMetric] = useState<'dist' | 'time'>('dist');
  const [rankKind, setRankKind] = useState<RankKind>('sections');

  useEffect(() => {
    ctl.filterAll(from, to, MODE_ORDER);
  }, [ctl, from, to]);

  const trips = useMemo(() => data.a.trips.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)), [data, from, to]);
  const totals = useMemo(() => modeTotals(trips), [trips]);
  const monthly = useMemo(() => {
    const byDist = monthlyByMode(trips);
    if (metric === 'dist') return byDist;
    // 時間（時間単位）
    const m = new Map(byDist.map((r) => [r.month, Object.fromEntries(MODE_ORDER.map((x) => [x, 0])) as Record<Mode, number>]));
    for (const t of trips) for (const l of t.legs) m.get(t.date.slice(0, 7))![l.mode] += (l.end - l.start) / 3600e3;
    return byDist.map((r) => ({ month: r.month, values: m.get(r.month)! }));
  }, [trips, metric]);
  const ranks = useMemo(() => railRankings(trips, data.stations, (l) => lineLabel(data, l)), [trips, data]);
  const wh = useMemo(() => weekHourMatrix(trips), [trips]);

  const days = new Set(trips.map((t) => t.date)).size;
  const totalDist = totals.reduce((s, x) => s + x.dist, 0);
  const munis = data.a.munis.filter((m) => {
    const d = new Date(m.first + 9 * 3600e3).toISOString().slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  });
  const prefs = new Set(data.a.munis.map((m) => m.pref)).size;
  const shownModes = MODE_ORDER.filter((m) => totals.find((t) => t.mode === m)!.count > 0);

  const clickRank = (r: RankItem) => {
    const q = { ...emptyQuery(), dateFrom: from, dateTo: to };
    if (rankKind === 'sections') {
      const [a, b] = r.key.split('→');
      onSearch({ ...q, from: a, to: b });
    } else if (rankKind === 'boards') onSearch({ ...q, from: r.key });
    else if (rankKind === 'alights') onSearch({ ...q, to: r.key });
    else if (rankKind === 'passes') onSearch({ ...q, via: [r.key] });
  };

  return (
    <div>
      <PeriodPicker data={data} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />

      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="v">{fmtKm(totalDist)}</div><div className="l">総移動距離（地球{(totalDist / 40075e3).toFixed(2)}周）</div></div>
        <div className="kpi"><div className="v">{trips.length.toLocaleString()}回</div><div className="l">移動回数（{days.toLocaleString()}日分）</div></div>
        <div className="kpi"><div className="v">{munis.length.toLocaleString()}</div><div className="l">{from || to ? 'この期間に初めて訪れた市区町村' : '訪れた市区町村'}</div></div>
        <div className="kpi"><div className="v">{prefs}</div><div className="l">訪れた都道府県（全期間）</div></div>
      </div>

      <div className="section">移動手段ごとの合計</div>
      <table className="data">
        <thead>
          <tr><th>手段</th><th className="num">距離</th><th className="num">時間</th><th className="num">回数</th><th className="num">平均時速</th></tr>
        </thead>
        <tbody>
          {totals.filter((t) => t.count > 0).sort((a, b) => b.dist - a.dist).map((t) => (
            <tr key={t.mode}>
              <td><span className="row" style={{ gap: 6 }}><i className="key" style={{ background: MODE_COLOR_VAR[t.mode] }} />{MODE_LABEL[t.mode]}</span></td>
              <td className="num">{fmtKm(t.dist)}</td>
              <td className="num">{fmtHours(t.ms)}</td>
              <td className="num">{t.count.toLocaleString()}</td>
              <td className="num">{t.ms ? Math.round(t.dist / 1000 / (t.ms / 3600e3)) : 0}km/h</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section">
        月別の移動
        <span className="grow" />
        <span className="seg">
          <button aria-pressed={metric === 'dist'} onClick={() => setMetric('dist')}>距離</button>
          <button aria-pressed={metric === 'time'} onClick={() => setMetric('time')}>時間</button>
        </span>
      </div>
      <div className="legend">
        {shownModes.map((m) => <span key={m}><i className="key" style={{ background: MODE_COLOR_VAR[m] }} />{MODE_LABEL[m]}</span>)}
      </div>
      <StackedBars
        rows={monthly.map((r) => ({ label: r.month, values: r.values }))}
        modes={shownModes}
        unit={metric === 'dist' ? 'km' : '時間'}
        fmt={(v) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(v >= 10 ? 0 : 1))}
      />

      <div className="section">曜日・時間帯ごとの出発回数</div>
      <WeekHourHeat m={wh} />

      <div className="section">鉄道のランキング</div>
      <div className="row" style={{ marginBottom: 6 }}>
        {(Object.keys(RANK_LABEL) as RankKind[]).map((k) => (
          <button key={k} className="chip" aria-pressed={rankKind === k} onClick={() => setRankKind(k)}>{RANK_LABEL[k]}</button>
        ))}
      </div>
      <table className="data">
        <thead>
          <tr><th>#</th><th>{RANK_LABEL[rankKind]}</th><th className="num">回数</th>{(rankKind === 'sections' || rankKind === 'lines') && <th className="num">距離計</th>}</tr>
        </thead>
        <tbody>
          {ranks[rankKind].map((r, i) => (
            <tr key={r.key} className={rankKind !== 'lines' ? 'clickable' : ''} onClick={() => rankKind !== 'lines' && clickRank(r)}>
              <td className="muted">{i + 1}</td>
              <td>{r.label}</td>
              <td className="num">{r.count.toLocaleString()}</td>
              {(rankKind === 'sections' || rankKind === 'lines') && <td className="num">{Math.round(r.extra ?? 0).toLocaleString()}km</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rankKind !== 'lines' && <p className="muted small">行をクリックすると、その条件で経路検索します。</p>}
    </div>
  );
}
