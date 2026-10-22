import type { ReactNode } from "react";

/** Dependency-free SVG charts. Every chart has a text equivalent (aria-label + visible figures) and uses theme colours. */

export interface Point { label: string; value: number }

/** Vertical bars over time (e.g. daily sales). */
export function BarChart({ data, format, height = 180, label }: { data: Point[]; format: (n: number) => string; height?: number; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((a, d) => a + d.value, 0);
  const step = 100 / Math.max(1, data.length);
  const bar = step * 0.62;
  const every = Math.max(1, Math.ceil(data.length / 7));
  return (
    <figure className="chart" aria-label={`${label}: total ${format(total)}`}>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ width: "100%", height }}>
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2="100" y1={(height / 4) * (1 - g)} y2={(height / 4) * (1 - g)} className="chart-grid" vectorEffect="non-scaling-stroke" />)}
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return <rect key={d.label} x={i * step + (step - bar) / 2} y={height / 4 - h} width={bar} height={Math.max(h, d.value > 0 ? 0.8 : 0)} rx="0.8" className="chart-bar"><title>{`${d.label}: ${format(d.value)}`}</title></rect>;
        })}
      </svg>
      <div className="chart-axis" aria-hidden="true">{data.map((d, i) => <span key={d.label} style={{ visibility: i % every === 0 ? "visible" : "hidden" }}>{d.label}</span>)}</div>
    </figure>
  );
}

/** Small trend line for a stat card. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="sparkline" role="img" aria-label={label}>
      <polyline points={`0,30 ${pts} 100,30`} className="spark-fill" />
      <polyline points={pts} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const DONUT = ["var(--color-primary)", "#F59E0B", "#6366F1", "#EF4444", "#14B8A6", "#94A3B8"];

/** Share-of-total ring with a legend that carries the exact numbers. */
export function Donut({ slices, centre, label }: { slices: Point[]; centre?: ReactNode; label: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  const r = 15.9155;
  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${label}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <svg viewBox="0 0 42 42">
          <circle cx="21" cy="21" r={r} className="donut-track" />
          {total > 0 && slices.map((s, i) => {
            const frac = s.value / total;
            const el = <circle key={s.label} cx="21" cy="21" r={r} className="donut-seg" stroke={DONUT[i % DONUT.length]} strokeDasharray={`${frac * 100} ${100 - frac * 100}`} strokeDashoffset={25 - acc * 100} />;
            acc += frac;
            return el;
          })}
        </svg>
        <div className="donut-centre">{centre}</div>
      </div>
      <ul className="legend">
        {slices.map((s, i) => <li key={s.label}><span className="dot" style={{ background: DONUT[i % DONUT.length] }} aria-hidden="true" />{s.label}<strong>{s.value}</strong></li>)}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars (top products, top sellers). */
export function RankBars({ rows, format }: { rows: { label: string; value: number; hint?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="rank">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="row-between"><span className="rank-label">{r.label}</span><strong>{format(r.value)}</strong></div>
          <div className="rank-track" aria-hidden="true"><span style={{ width: `${(r.value / max) * 100}%` }} /></div>
          {r.hint && <span className="muted small">{r.hint}</span>}
        </li>
      ))}
    </ol>
  );
}
