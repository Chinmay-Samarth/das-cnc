import { Link } from 'react-router-dom';
import { EmptyState, StatusBadge } from '../../components/mes';

export default function HorizonWavePanel({ waves }) {
  const stuck = waves?.stuck || [];
  const inWindow = waves?.in_window || [];
  const counts = waves?.counts || { stuck: 0, in_progress: 0, locked: 0 };

  if (!stuck.length && !inWindow.length) {
    return <EmptyState title="No active waves" description="Horizon planner is quiet." />;
  }

  return (
    <div>
      <div className="mes-dash-legend" style={{ marginBottom: 8 }}>
        <span>{counts.stuck} stuck</span>
        <span>{counts.in_progress} in progress</span>
        <span>{counts.locked} locked</span>
      </div>
      <ul className="mes-dash-list">
        {[...stuck, ...inWindow].slice(0, 5).map((w) => (
          <li key={w.id}>
            <Link to="/production/horizon-planner" className="mes-dash-list-row">
              <div>
                <strong>{w.work_center_code || w.work_center_name || 'WC'}</strong>
                <p className="muted">Wave #{w.horizon_index} · {w.horizon_end}</p>
              </div>
              <StatusBadge status={w.stuck ? 'OVERDUE' : 'RUNNING'}>
                {w.stuck ? 'Stuck' : w.status}
              </StatusBadge>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
