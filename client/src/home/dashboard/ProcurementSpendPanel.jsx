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
import { CHART, DashChartTooltip, formatInr, formatShortDate } from './chartUtils';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <DashChartTooltip
      title={`Week of ${formatShortDate(label)}`}
      rows={[
        { label: 'PO opened', value: formatInr(row?.po_opened), color: CHART.po },
        { label: 'GIRN received', value: formatInr(row?.girn_received), color: CHART.girn },
      ]}
    />
  );
}

export default function ProcurementSpendPanel({ analytics }) {
  const series = (analytics?.procurement_series || []).map((r) => ({
    ...r,
    label: formatShortDate(r.week),
  }));
  const hasData = series.some((r) => r.po_opened > 0 || r.girn_received > 0);

  if (!hasData) {
    return (
      <EmptyState
        title="No procurement activity"
        description="PO values and GIRN receipts by week will show here."
      />
    );
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v) => formatInr(v).replace('₹', '')}
          />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#64748b', paddingBottom: 4 }}
          />
          <Bar dataKey="po_opened" name="PO opened" fill={CHART.po} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="girn_received" name="GIRN" fill={CHART.girn} radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
