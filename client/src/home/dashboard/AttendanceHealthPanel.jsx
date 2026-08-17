import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ProgressRing } from '../../components/mes';

const COLORS = {
  present: '#047857',
  absent: '#b91c1c',
  leave: '#b45309',
};

export default function AttendanceHealthPanel({ attendance }) {
  const summary = attendance?.summary || { present: 0, absent: 0, on_leave: 0, total: 0 };
  const chart = [
    { name: 'On duty', value: summary.present || 0, color: COLORS.present },
    { name: 'Absent', value: summary.absent || 0, color: COLORS.absent },
    { name: 'On leave', value: summary.on_leave || 0, color: COLORS.leave },
  ].filter((d) => d.value > 0);
  const pct = summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : 0;

  return (
    <div className="mes-dash-att">
      <div className="mes-dash-att-visual">
        <ProgressRing value={summary.present} max={summary.total || 1} size={72} label={`${pct}%`} />
        <div className="mes-dash-att-chart">
          {chart.length ? (
            <ResponsiveContainer width="100%" height={88}>
              <PieChart>
                <Pie data={chart} dataKey="value" innerRadius={22} outerRadius={38} paddingAngle={2}>
                  {chart.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              No punches yet today.
            </p>
          )}
        </div>
      </div>
      <div className="mes-dash-legend">
        <span><i style={{ background: COLORS.present }} /> {summary.present} on duty</span>
        <span><i style={{ background: COLORS.absent }} /> {summary.absent} absent</span>
        <span><i style={{ background: COLORS.leave }} /> {summary.on_leave} leave</span>
      </div>
      <div className="mes-dash-chips">
        {(attendance?.absentees || []).slice(0, 4).map((p) => (
          <Link key={p.id} to={`/employees/${p.id}`} className="mes-dash-chip mes-dash-chip-danger">
            {p.full_name}
          </Link>
        ))}
        {(attendance?.on_leave || []).slice(0, 3).map((p) => (
          <Link key={p.id} to={`/employees/${p.id}`} className="mes-dash-chip mes-dash-chip-amber">
            {p.full_name} · leave
          </Link>
        ))}
      </div>
    </div>
  );
}
