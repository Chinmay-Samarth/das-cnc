import { Link } from 'react-router-dom';
import { EmptyState, ProgressBar, StatusBadge } from '../../components/mes';

export default function ProductionPulsePanel({ production }) {
  const running = production?.running || [];
  const scheduled = production?.scheduled || [];
  const counts = production?.counts || { running: 0, scheduled: 0, overdue: 0 };

  if (!running.length && !scheduled.length && !counts.overdue) {
    return <EmptyState title="Quiet shop floor" description="No cards running or scheduled today." />;
  }

  return (
    <div>
      <div className="mes-dash-legend" style={{ marginBottom: 10 }}>
        <span>{counts.running} running</span>
        <span>{counts.scheduled} scheduled</span>
        <span>{counts.overdue} overdue</span>
      </div>
      <ul className="mes-dash-list">
        {running.slice(0, 5).map((card) => (
          <li key={card.id}>
            <Link to={`/production/cards/${card.id}`} className="mes-dash-list-row">
              <div>
                <strong>{card.card_number || 'Card'}</strong>
                <p className="muted">{card.component_label || '—'}</p>
              </div>
              <div className="mes-dash-list-meta">
                <StatusBadge status={card.status}>{card.status}</StatusBadge>
                <ProgressBar
                  value={card.total_good_produced}
                  max={card.target_quantity || 1}
                  showLabel={false}
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {scheduled.length ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Next up: {scheduled.slice(0, 3).map((c) => c.card_number || c.component_label).join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
