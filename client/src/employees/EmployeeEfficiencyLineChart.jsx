import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const LINE_COLOR = '#047857';
const AXIS = '#94a3b8';
const GRID = '#e2e8f0';

function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return value.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function formatShortDate(ymd) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function buildEfficiencySeries(entries) {
  const buckets = new Map();
  for (const row of entries || []) {
    const ymd = toYmd(row.work_date);
    if (!ymd) continue;
    const pct = Number(row.efficiency_pct);
    if (!Number.isFinite(pct)) continue;
    const prev = buckets.get(ymd) || { sum: 0, count: 0 };
    buckets.set(ymd, { sum: prev.sum + pct, count: prev.count + 1 });
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ymd, { sum, count }]) => {
      const avg = Math.round((sum / count) * 10) / 10;
      return {
        ymd,
        label: formatShortDate(ymd),
        efficiency_pct: avg,
      };
    });
}

function EfficiencyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const pct = payload[0]?.value;
  return (
    <div className="emp-chart-tooltip">
      <p className="emp-chart-tooltip-title">{label}</p>
      <p>
        <span className="emp-chart-swatch" style={{ background: LINE_COLOR }} />
        Efficiency: {pct != null ? `${pct}%` : '—'}
      </p>
    </div>
  );
}

export default function EmployeeEfficiencyLineChart({ entries }) {
  const data = useMemo(() => buildEfficiencySeries(entries), [entries]);

  if (!data.length) return null;

  const maxPct = Math.max(...data.map((d) => d.efficiency_pct), 100);
  const yMax = maxPct > 100 ? Math.ceil(maxPct / 10) * 10 : 100;

  return (
    <div className="emp-chart-body">
      <div className="emp-chart-plot">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: AXIS, fontSize: 11 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fill: AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<EfficiencyTooltip />} />
            <Line
              type="monotone"
              dataKey="efficiency_pct"
              name="Efficiency"
              stroke={LINE_COLOR}
              strokeWidth={2.25}
              dot={{ r: 3.5, fill: LINE_COLOR, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: LINE_COLOR, stroke: '#fff', strokeWidth: 2 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
