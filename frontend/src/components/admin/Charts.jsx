import React, { useState, useId, useMemo } from 'react';
import { Table2 } from 'lucide-react';

/**
 * Charts for the admin dashboard.
 *
 * Inline SVG rather than a charting library: the bundle is already past the
 * 500 kB warning, and these are four simple forms. Everything here follows the
 * same rules — thin marks, a recessive grid, direct labels rather than a
 * number on every point, and a hover layer, because an SVG chart in a browser
 * is interactive whether or not you plan for it.
 *
 * Colours come from CSS variables validated in both themes (see index.css).
 * They are never the only carrier of meaning: every series is named in a
 * legend or a direct label, and every chart offers a table view, so the
 * figures survive colour blindness, a monochrome print, and a screen reader.
 */

const fmt = (n) => new Intl.NumberFormat('en-IN').format(n ?? 0);

/** The table behind every chart — the accessible reading of the same numbers. */
function DataTable({ columns, rows, caption }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-[11px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-ink-muted">
            {columns.map((c) => (
              <th key={c} scope="col" className="text-left font-semibold py-1 pr-4 border-b border-line">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/50">
              {r.map((cell, j) => (
                <td key={j} className={`py-1 pr-4 ${j === 0 ? 'text-ink' : 'text-ink-muted font-mono'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartFrame({ title, subtitle, children, table, action }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="bg-surface-raised rounded-card border border-line shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-ink">{title}</h3>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              title={showTable ? 'Show chart' : 'Show the numbers as a table'}
              className={`p-1.5 rounded-field border text-ink-muted hover:bg-surface-sunken transition-colors ${
                showTable ? 'border-gov-300 bg-gov-50' : 'border-line'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {showTable && table ? table : children}
    </div>
  );
}

/**
 * Visits over the last fortnight, with the urgent share beneath it.
 *
 * Two series on ONE axis — both are counts of visits, so they share a scale.
 * A second y-axis would let the two lines be drawn at any relative height the
 * author liked, which is the most common way a chart misleads.
 */
export function TrendChart({ data = [] }) {
  const id = useId();
  const [hover, setHover] = useState(null);

  const W = 720, H = 200, PAD = { t: 12, r: 12, b: 26, l: 40 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const max = Math.max(4, ...data.map((d) => d.visits));
  const x = (i) => PAD.l + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => PAD.t + plotH - (v / max) * plotH;

  const line = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = data.length
    ? `${line('visits')} L${x(data.length - 1).toFixed(1)},${PAD.t + plotH} L${x(0).toFixed(1)},${PAD.t + plotH} Z`
    : '';

  const ticks = [0, Math.round(max / 2), max];
  const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

  return (
    <ChartFrame
      title="Visits over the last 14 days"
      subtitle="All visits, with the urgent share (high and emergency) beneath"
      table={<DataTable
        caption="Visits per day for the last fourteen days"
        columns={['Date', 'Visits', 'Urgent']}
        rows={data.map((d) => [dayLabel(d.date), fmt(d.visits), fmt(d.urgent)])}
      />}
    >
      {/* Legend: two series, so identity never rests on colour alone. */}
      <div className="flex items-center gap-4 mb-2 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ background: 'rgb(var(--chart-1))' }} /> All visits
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ background: 'rgb(var(--chart-2))' }} /> Urgent
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label={`Visits per day over fourteen days, peaking at ${fmt(max)}`}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--chart-1))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="rgb(var(--chart-1))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid — present enough to read a value against, quiet
            enough that it never competes with the data. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--chart-grid))" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-ink-muted" style={{ fontSize: 9 }}>{fmt(t)}</text>
          </g>
        ))}

        {area && <path d={area} fill={`url(#${id}-fill)`} />}
        {data.length > 1 && <path d={line('visits')} fill="none" stroke="rgb(var(--chart-1))" strokeWidth="2" strokeLinejoin="round" />}
        {data.length > 1 && <path d={line('urgent')} fill="none" stroke="rgb(var(--chart-2))" strokeWidth="2" strokeLinejoin="round" />}

        {/* First and last date only. A label under every point turns the axis
            into noise at this width. */}
        {data.length > 0 && (
          <>
            <text x={PAD.l} y={H - 8} className="fill-ink-muted" style={{ fontSize: 9 }}>{dayLabel(data[0].date)}</text>
            <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-ink-muted" style={{ fontSize: 9 }}>
              {dayLabel(data[data.length - 1].date)}
            </text>
          </>
        )}

        {hover !== null && data[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH}
                  stroke="rgb(var(--chart-grid))" strokeWidth="1" />
            {/* 2px surface ring so a marker stays legible over the line. */}
            <circle cx={x(hover)} cy={y(data[hover].visits)} r="4"
                    fill="rgb(var(--chart-1))" stroke="rgb(var(--surface-raised))" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(data[hover].urgent)} r="4"
                    fill="rgb(var(--chart-2))" stroke="rgb(var(--surface-raised))" strokeWidth="2" />
          </g>
        )}

        {/* Hit targets wider than the marks. */}
        {data.map((d, i) => (
          <rect key={d.date} x={x(i) - plotW / (data.length * 2 || 1)} y={PAD.t}
                width={Math.max(8, plotW / (data.length || 1))} height={plotH}
                fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      <p className="text-[11px] text-ink-muted h-4 mt-1" aria-live="polite">
        {hover !== null && data[hover]
          ? `${dayLabel(data[hover].date)} — ${fmt(data[hover].visits)} visits, ${fmt(data[hover].urgent)} urgent`
          : ''}
      </p>
    </ChartFrame>
  );
}

/**
 * Risk mix, drawn as a sequential ramp rather than four categorical colours.
 *
 * Severity is ordered, not four identities, and the tier tokens used elsewhere
 * in the app are 4.1 ΔE apart in normal vision — indistinguishable even with
 * full colour vision. Order (worst first) and the labels carry the meaning;
 * the ramp only reinforces it.
 */
export function RiskChart({ distribution = {} }) {
  const rows = [
    { key: 'emergency', label: 'Emergency', step: 4 },
    { key: 'high', label: 'High', step: 3 },
    { key: 'moderate', label: 'Moderate', step: 2 },
    { key: 'low', label: 'Low', step: 1 }
  ].map((r) => ({ ...r, count: Number(distribution[r.key] || 0) }));

  const total = rows.reduce((n, r) => n + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <ChartFrame
      title="Risk mix across all visits"
      subtitle={`${fmt(total)} visits triaged, worst first`}
      table={<DataTable caption="Visits by risk tier" columns={['Tier', 'Visits', 'Share']}
        rows={rows.map((r) => [r.label, fmt(r.count), total ? `${((r.count / total) * 100).toFixed(1)}%` : '—'])} />}
    >
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key} className="group">
            <div className="flex items-baseline justify-between text-[11px] mb-1">
              <span className="text-ink font-medium">{r.label}</span>
              <span className="text-ink-muted font-mono">
                {fmt(r.count)}{total ? <span className="text-ink-subtle"> · {((r.count / total) * 100).toFixed(0)}%</span> : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-sunken overflow-hidden" title={`${r.label}: ${fmt(r.count)} visits`}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(r.count ? 2 : 0, (r.count / max) * 100)}%`, background: `rgb(var(--chart-sev-${r.step}))` }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

/**
 * A ranked list of counts — one series, so one hue.
 *
 * Single-series magnitude never needs a categorical palette, and giving each
 * bar its own colour would imply a distinction between rows that does not
 * exist.
 */
export function BarList({ title, subtitle, items = [], valueLabel = 'Count', emptyText = 'No data yet.' }) {
  const max = Math.max(1, ...items.map((i) => Number(i.count) || 0));
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={<DataTable caption={title} columns={[title, valueLabel]}
        rows={items.map((i) => [i.name ?? i.label, fmt(i.count)])} />}
    >
      {items.length === 0 ? (
        <p className="text-[11px] text-ink-muted py-6 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((i) => {
            const label = i.name ?? i.label;
            const count = Number(i.count) || 0;
            return (
              <div key={label} className="flex items-center gap-3">
                <span className="w-20 sm:w-28 shrink-0 text-[11px] text-ink truncate" title={label}>{label}</span>
                <div className="flex-1 h-2.5 rounded-full bg-surface-sunken overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-500"
                       style={{ width: `${Math.max(count ? 2 : 0, (count / max) * 100)}%`, background: 'rgb(var(--chart-1))' }} />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] font-mono text-ink-muted">{fmt(count)}</span>
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}

/**
 * Where the network's work currently sits.
 *
 * A stat row rather than a chart: five unrelated totals have no shared scale
 * to plot against, and the number itself is the message.
 */
export function VisitFunnel({ visits = {} }) {
  const cells = [
    { label: 'Visits today', value: visits.today, hint: 'Opened today' },
    { label: 'Treated', value: visits.treated, hint: 'Decision recorded' },
    { label: 'Awaiting a doctor', value: visits.awaiting_doctor, hint: 'In a queue now' },
    { label: 'In consultation', value: visits.in_consultation, hint: 'On a call' },
    { label: 'Referred', value: visits.referred, hint: 'Sent to hospital' }
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface-raised rounded-card border border-line shadow-sm p-3">
          <div className="text-xl font-bold text-ink tabular-nums">{fmt(c.value)}</div>
          <div className="text-[11px] font-semibold text-ink mt-0.5">{c.label}</div>
          <div className="text-[10px] text-ink-subtle">{c.hint}</div>
        </div>
      ))}
    </div>
  );
}
