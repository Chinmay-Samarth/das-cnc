import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '../../components/mes';
import { CHART, DashChartTooltip, formatInr, formatShortDate } from './chartUtils';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <DashChartTooltip
      title={formatShortDate(label)}
      rows={[
        { label: 'Billed', value: formatInr(row?.billed), color: CHART.billed },
        { label: 'Paid', value: formatInr(row?.paid), color: CHART.paid },
      ]}
    />
  );
}

export default function RevenuePulsePanel({ analytics }) {
  const series = (analytics?.revenue_series || []).map((r) => ({
    ...r,
    label: formatShortDate(r.date),
  }));
  const hasData = series.some((r) => r.billed > 0 || r.paid > 0);
  const mtd = analytics?.kpis?.revenue_mtd ?? 0;

  if (!hasData) {
    return (
      <EmptyState
        title="No revenue yet"
        description="Issued sales invoices in the last 30 days will appear here."
      />
    );
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <p className="emp-chart-summary muted">MTD {formatInr(mtd)}</p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mesRevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.billed} stopOpacity={0.3} />
              <stop offset="100%" stopColor={CHART.billed} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v) => formatInr(v).replace('₹', '')}
          />
          <Tooltip content={<Tip />} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#64748b', paddingBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="billed"
            name="Billed"
            stroke={CHART.billed}
            strokeWidth={2}
            fill="url(#mesRevFill)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="paid"
            name="Paid"
            stroke={CHART.paid}
            strokeWidth={1.75}
            fill="transparent"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
