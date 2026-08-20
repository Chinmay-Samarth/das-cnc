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
import { CHART, DashChartTooltip } from './chartUtils';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <DashChartTooltip
      title={row?.fullName || label}
      rows={[
        { label: 'Running', value: String(row?.running ?? 0), color: CHART.running },
        { label: 'Scheduled', value: String(row?.scheduled ?? 0), color: CHART.scheduled },
        { label: 'Overdue', value: String(row?.overdue ?? 0), color: CHART.overdue },
      ]}
    />
  );
}

export default function WcLoadPanel({ workCenters }) {
  const items = (workCenters?.items || [])
    .map((wc) => ({
      id: wc.id,
      code: wc.code || wc.name || 'WC',
      fullName: wc.name || wc.code,
      running: wc.running_cards || 0,
      scheduled: wc.scheduled_cards || 0,
      overdue: wc.overdue_cards || 0,
      total: (wc.running_cards || 0) + (wc.scheduled_cards || 0) + (wc.overdue_cards || 0),
    }))
    .filter((w) => w.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  if (!items.length) {
    return (
      <EmptyState
        title="Work centers idle"
        description="No running, scheduled, or overdue cards on active work centers today."
      />
    );
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <div className="mes-dash-legend" style={{ marginBottom: 6 }}>
        <span>{workCenters?.counts?.running || 0} WC running</span>
        <span>{workCenters?.counts?.idle || 0} idle</span>
        <span>{workCenters?.counts?.overdue || 0} overdue</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={items} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="code"
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={28}
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
          <Bar dataKey="running" name="Running" stackId="wc" fill={CHART.running} maxBarSize={26} />
          <Bar dataKey="scheduled" name="Scheduled" stackId="wc" fill={CHART.scheduled} maxBarSize={26} />
          <Bar
            dataKey="overdue"
            name="Overdue"
            stackId="wc"
            fill={CHART.overdue}
            radius={[3, 3, 0, 0]}
            maxBarSize={26}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
