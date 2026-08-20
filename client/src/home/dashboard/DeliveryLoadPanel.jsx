import {
  Area,
  AreaChart,
  CartesianGrid,
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
        { label: 'Qty due', value: formatQty(row?.qty), color: CHART.delivery },
        { label: 'Schedules', value: String(row?.count ?? 0) },
      ]}
    />
  );
}

export default function DeliveryLoadPanel({ analytics, schedules }) {
  const raw = analytics?.delivery_series?.length
    ? analytics.delivery_series
    : schedules?.delivery_series || schedules?.week || [];
  const series = raw.map((r) => ({
    ...r,
    label: formatShortDate(r.date),
  }));
  const hasData = series.some((r) => r.qty > 0 || r.count > 0);

  if (!hasData) {
    return (
      <EmptyState
        title="No delivery load"
        description="Nothing planned in the next two weeks."
      />
    );
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mesDelFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.delivery} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART.delivery} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={22}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip content={<Tip />} />
          <Area
            type="monotone"
            dataKey="qty"
            name="Qty"
            stroke={CHART.delivery}
            strokeWidth={2}
            fill="url(#mesDelFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
