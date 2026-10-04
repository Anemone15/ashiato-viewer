import { useRef, useState, type ReactNode } from 'react';
import type { Mode } from '../core/types';
import { MODE_LABEL } from '../core/types';
import { MODE_COLOR_VAR } from './format';

interface Tip { x: number; y: number; content: ReactNode }

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, content: ReactNode) => {
    const box = ref.current!.getBoundingClientRect();
    let x: number, y: number;
    if ('clientX' in e) {
      x = e.clientX - box.left;
      y = e.clientY - box.top;
    } else {
      const r = (e.target as Element).getBoundingClientRect();
      x = r.left + r.width / 2 - box.left;
      y = r.top - box.top;
    }
    setTip({ x, y, content });
  };
  const node = tip && (
    <div
      className="tooltip"
      style={{
        left: Math.min(Math.max(tip.x + 12, 0), (ref.current?.clientWidth ?? 300) - 150),
        top: Math.max(tip.y - 10, 0),
        transform: 'translateY(-100%)',
      }}
    >
      {tip.content}
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};

/** 月別・手段別の積み上げ棒グラフ */
export function StackedBars({
  rows, modes, unit, fmt,
}: {
  rows: { label: string; values: Record<Mode, number> }[];
  modes: Mode[];
  unit: string;
  fmt: (v: number) => string;
}) {
  const { ref, show, hide, node } = useTip();
  const W = 400, H = 180, L = 36, B = 18, T = 6;
  const totals = rows.map((r) => modes.reduce((s, m) => s + r.values[m], 0));
  const max = niceMax(Math.max(0, ...totals));
  const bw = (W - L) / Math.max(rows.length, 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(rows.length / 8);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`月別の移動${unit}`} onPointerLeave={hide}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} />
            <text className="axis" x={L - 4} y={y(t) + 3} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          let acc = 0;
          const x = L + i * bw + 1;
          const w = Math.max(bw - 2, 1);
          return (
            <g
              key={r.label}
              tabIndex={0}
              onPointerMove={(e) => show(e, <TipContent title={r.label} values={r.values} modes={modes} fmt={fmt} unit={unit} />)}
              onFocus={(e) => show(e, <TipContent title={r.label} values={r.values} modes={modes} fmt={fmt} unit={unit} />)}
              onBlur={hide}
            >
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {modes.map((m) => {
                const v = r.values[m];
                if (v <= 0) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const h = Math.max(y0 - y1 - 1, 0.5);
                return <rect key={m} x={x} y={y1} width={w} height={h} rx={Math.min(2, w / 2)} fill={MODE_COLOR_VAR[m]} />;
              })}
              {i % labelEvery === 0 && (
                <text className="axis" x={x + w / 2} y={H - 4} textAnchor="middle">{r.label.replace(/^20(\d\d)-0?/, '$1/')}</text>
              )}
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

function TipContent({ title, values, modes, fmt, unit }: { title: string; values: Record<Mode, number>; modes: Mode[]; fmt: (v: number) => string; unit: string }) {
  const total = modes.reduce((s, m) => s + values[m], 0);
  return (
    <>
      <div className="tt-title">{title} · 計 <b>{fmt(total)}{unit}</b></div>
      {modes.filter((m) => values[m] > 0).map((m) => (
        <div className="tt-row" key={m}>
          <i className="key line" style={{ background: MODE_COLOR_VAR[m] }} />
          <b>{fmt(values[m])}{unit}</b>
          <span className="muted">{MODE_LABEL[m]}</span>
        </div>
      ))}
    </>
  );
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];

/** 曜日×時間帯のヒートマップ */
export function WeekHourHeat({ m }: { m: number[][] }) {
  const { ref, show, hide, node } = useTip();
  const max = Math.max(1, ...m.flat());
  const W = 400, L = 18, T = 4, cw = (W - L) / 24, ch = 14, H = T + ch * 7 + 14;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const step = (v: number) => (v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999)));
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="曜日と時間帯ごとの移動回数" onPointerLeave={hide}>
        {order.map((d, r) => (
          <g key={d}>
            <text className="axis" x={L - 4} y={T + r * ch + ch / 2 + 3} textAnchor="end">{WD[d]}</text>
            {m[d].map((v, h) => (
              <rect
                key={h}
                x={L + h * cw + 1}
                y={T + r * ch + 1}
                width={cw - 2}
                height={ch - 2}
                rx={2}
                fill={`var(--seq-${step(v)})`}
                tabIndex={-1}
                onPointerMove={(e) => show(e, <><div className="tt-title">{WD[d]}曜 {h}時台</div><b>{v}回</b> の移動開始</>)}
              />
            ))}
          </g>
        ))}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} className="axis" x={L + h * cw + cw / 2} y={H - 2} textAnchor="middle">{h}時</text>
        ))}
      </svg>
      {node}
    </div>
  );
}
