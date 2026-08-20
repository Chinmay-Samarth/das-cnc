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
import { EmptyState } from '../../components/mes';
import { CHART, DashChartTooltip, formatQty, formatShortDate } from './chartUtils';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <DashChartTooltip
      title={formatShortDate(label)}
      rows={[
        { label: 'Good', value: formatQty(row?.good), color: CHART.good },
        { label: 'Scrap', value: formatQty(row?.scrap), color: CHART.scrap },
      ]}
    />
  );
}

export default function YieldTrendPanel({ analytics }) {
  const series = (analytics?.yield_series || []).map((r) => ({
    ...r,
    label: formatShortDate(r.date),
  }));
  const hasData = series.some((r) => r.good > 0 || r.scrap > 0);

  if (!hasData) {
    return (
      <EmptyState
        title="No yield data"
        description="Good and scrap quantities appear after production cards record output."
      />
    );
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#64748b', paddingBottom: 4 }}
          />
          <Bar dataKey="good" name="Good" stackId="y" fill={CHART.good} maxBarSize={22} />
          <Bar dataKey="scrap" name="Scrap" stackId="y" fill={CHART.scrap} radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
