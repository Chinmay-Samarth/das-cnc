import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '../../components/mes';
import { CHART, DashChartTooltip, formatQty } from './chartUtils';

function campaignColor(runOutDays, progress) {
  if (runOutDays != null && runOutDays <= 3) return CHART.campaignCritical;
  if (runOutDays != null && runOutDays <= 7) return CHART.campaignRisk;
  if (progress >= 80) return CHART.campaignOk;
  return CHART.billed;
}

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <DashChartTooltip
      title={row?.name}
      rows={[
        { label: 'Progress', value: `${row?.progress_pct ?? 0}%`, color: row?.color },
        { label: 'Good / target', value: `${formatQty(row?.good_quantity)} / ${formatQty(row?.target_quantity)}` },
        {
          label: 'Run-out',
          value: row?.run_out_days != null ? `${row.run_out_days}d` : '—',
        },
      ]}
    />
  );
}

export default function CampaignBarsPanel({ campaigns }) {
  const items = [...(campaigns?.active || [])]
    .sort((a, b) => (b.progress_pct || 0) - (a.progress_pct || 0))
    .slice(0, 8)
    .map((c) => {
      const name = c.component_label || c.work_center_code || 'Campaign';
      const short = name.length > 18 ? `${name.slice(0, 16)}…` : name;
      return {
        id: c.id,
        name: short,
        fullName: name,
        progress_pct: c.progress_pct || 0,
        good_quantity: c.good_quantity,
        target_quantity: c.target_quantity,
        run_out_days: c.run_out_days,
        color: campaignColor(c.run_out_days, c.progress_pct || 0),
      };
    });

  if (!items.length) {
    return <EmptyState title="No active campaigns" description="Lock a horizon wave to start production." />;
  }

  return (
    <div className="emp-chart-body mes-dash-chart">
      <ResponsiveContainer width="100%" height={Math.max(180, items.length * 28)}>
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: CHART.axis, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={88}
            tick={{ fill: '#475569', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
          <Bar dataKey="progress_pct" name="Progress" radius={[0, 4, 4, 0]} barSize={14}>
            {items.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
