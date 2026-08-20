import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SHIFT_COLOR = '#2563eb';
const OT_COLOR = '#dc2626';
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

function buildDaySeries(records, monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = new Map();
  for (const row of records || []) {
    const ymd = toYmd(row.shift_date);
    if (!ymd) continue;
    const worked = Math.max(0, Number(row.minutes_worked) || 0);
    const ot = Math.max(0, Number(row.overtime_minutes) || 0);
    const shift = Math.max(0, worked - ot);
    const prev = byDate.get(ymd) || { shiftMinutes: 0, otMinutes: 0 };
    byDate.set(ymd, {
      shiftMinutes: prev.shiftMinutes + shift,
      otMinutes: prev.otMinutes + ot,
    });
  }

  const points = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const agg = byDate.get(ymd) || { shiftMinutes: 0, otMinutes: 0 };
    points.push({
      day,
      label: String(day),
      ymd,
      shiftMinutes: agg.shiftMinutes,
      otMinutes: agg.otMinutes,
      total: agg.shiftMinutes + agg.otMinutes,
    });
  }
  return points;
}

function MinutesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const shift = row?.shiftMinutes ?? 0;
  const ot = row?.otMinutes ?? 0;
  const total = row?.total ?? shift + ot;
  return (
    <div className="emp-chart-tooltip">
      <p className="emp-chart-tooltip-title">Day {label}</p>
      <p>
        <span className="emp-chart-swatch" style={{ background: SHIFT_COLOR }} />
        Shift: {shift} min
      </p>
      <p>
        <span className="emp-chart-swatch" style={{ background: OT_COLOR }} />
        OT: {ot} min
      </p>
      <p className="emp-chart-tooltip-total">Total: {total} min</p>
    </div>
  );
}

export default function EmployeeMinutesBarChart({ records, monthDate }) {
  const data = useMemo(() => buildDaySeries(records, monthDate), [records, monthDate]);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, d) => ({
        shift: acc.shift + d.shiftMinutes,
        ot: acc.ot + d.otMinutes,
        total: acc.total + d.total,
      }),
      { shift: 0, ot: 0, total: 0 }
    );
  }, [data]);

  return (
    <div className="emp-chart-body">
      <p className="emp-chart-summary muted">
        Total {totals.total.toLocaleString('en-IN')} min · OT {totals.ot.toLocaleString('en-IN')} min
      </p>
      <div className="emp-chart-plot">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap="18%">
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: AXIS, fontSize: 11 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
            />
            <Tooltip content={<MinutesTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: '#64748b', paddingBottom: 8 }}
            />
            <Bar
              dataKey="shiftMinutes"
              name="Shift"
              stackId="minutes"
              fill={SHIFT_COLOR}
              radius={[0, 0, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="otMinutes"
              name="OT"
              stackId="minutes"
              fill={OT_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
