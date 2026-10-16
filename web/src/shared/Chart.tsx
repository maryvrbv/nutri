import { useEffect, useRef, useState } from 'react';
import { fmtShort, num } from '../format';

type Point = { date: string; value: number | null; value_text: string; ref_low: number | null; ref_high: number | null; lab: string | null; result_id: string };
type Ev = { date: string; kind: string; title: string };

/** Линия по датам забора с референсным интервалом каждого исследования и событиями курса. */
export function DynamicsChart({ points, unit, events, showEvents }: { points: Point[]; unit: string; events: Ev[]; showEvents: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // Ширина холста равна ширине контейнера, чтобы подписи не мельчали на телефоне
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = points.filter((p) => p.value != null) as (Point & { value: number })[];
  if (pts.length === 0) return <p className="small muted" ref={box as any}>Нет числовых значений для графика</p>;
  const H = W < 500 ? 200 : 240, L = 40, R = 12, T = 16, B = 30;
  const t = (d: string) => new Date(d + 'T00:00:00Z').getTime();
  let t0 = t(pts[0].date), t1 = t(pts[pts.length - 1].date);
  const evs = showEvents ? events.filter((e) => e.date) : [];
  for (const e of evs) { t0 = Math.min(t0, t(e.date)); t1 = Math.max(t1, t(e.date)); }
  if (t1 === t0) { t0 -= 15 * 86400000; t1 += 15 * 86400000; }
  const vals = pts.flatMap((p) => [p.value, p.ref_low, p.ref_high]).filter((v): v is number => v != null);
  let v0 = Math.min(...vals), v1 = Math.max(...vals);
  const pad = (v1 - v0 || Math.abs(v1) || 1) * 0.15;
  v0 = Math.max(0, v0 - pad); v1 += pad;
  const x = (d: string) => L + ((t(d) - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  const ticks = Array.from({ length: 4 }, (_, i) => v0 + ((v1 - v0) * i) / 3);
  const out = (p: Point & { value: number }) => (p.ref_low != null && p.value < p.ref_low) || (p.ref_high != null && p.value > p.ref_high);
  const h = hover != null ? pts[hover] : null;
  return (
    <div style={{ position: 'relative' }} ref={box}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`График: ${pts.map((p) => `${fmtShort(p.date)} — ${num(p.value)} ${unit}`).join('; ')}`}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="axis" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">{num(v, v1 - v0 < 5 ? 2 : 0)}</text>
          </g>
        ))}
        {/* Референсный интервал свой у каждого исследования — рисуем ступеньками */}
        {pts.map((p, i) => {
          if (p.ref_low == null && p.ref_high == null) return null;
          const xa = i === 0 ? L : (x(pts[i - 1].date) + x(p.date)) / 2;
          const xb = i === pts.length - 1 ? W - R : (x(p.date) + x(pts[i + 1].date)) / 2;
          const ya = y(p.ref_high ?? v1), yb = y(p.ref_low ?? v0);
          return <rect key={i} className="band" x={xa} width={Math.max(0, xb - xa)} y={ya} height={Math.max(0, yb - ya)} />;
        })}
        {evs.map((e, i) => (
          <g key={i}>
            <line className="ev" x1={x(e.date)} x2={x(e.date)} y1={T} y2={H - B} />
            <text className="evlabel" x={x(e.date) + 4} y={T + 10 + (i % 3) * 12}>{e.kind === 'course_start' ? 'старт' : e.kind === 'course_change' ? 'изменение' : e.kind === 'course_cancel' ? 'отмена' : 'конец'}</text>
          </g>
        ))}
        <polyline className="line" points={pts.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.result_id}>
            <circle className={`pt ${out(p) ? 'out' : ''}`} cx={x(p.date)} cy={y(p.value)} r={hover === i ? 7 : 5}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
              aria-label={`${fmtShort(p.date)}: ${p.value_text} ${unit}`} />
            {/* Подпись даты не рисуем, если она налезает на предыдущую */}
            {(i === 0 || x(p.date) - x(pts[i - 1].date) > 48) && <text x={x(p.date)} y={H - 10} textAnchor="middle">{fmtShort(p.date)}</text>}
          </g>
        ))}
      </svg>
      {h && (
        <div className="card tight" style={{ position: 'absolute', top: 0, left: `${(x(h.date) / W) * 100}%`, transform: 'translate(-50%, -100%)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2 }}>
          <b className="num">{num(h.value)} {unit}</b>
          <div className="tiny muted">{fmtShort(h.date)}{h.lab ? ` · ${h.lab}` : ''}</div>
          {(h.ref_low != null || h.ref_high != null) && <div className="tiny muted">интервал {num(h.ref_low)}–{num(h.ref_high)}</div>}
        </div>
      )}
    </div>
  );
}
