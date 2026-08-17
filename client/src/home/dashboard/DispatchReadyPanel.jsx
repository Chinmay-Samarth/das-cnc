import { Link } from 'react-router-dom';
import { EmptyState, StatusBadge } from '../../components/mes';

export default function DispatchReadyPanel({ dispatch }) {
  const lots = dispatch?.lots || [];
  if (!lots.length) {
    return <EmptyState title="Nothing ready" description="Finished lots will land here." />;
  }

  return (
    <div className="mes-dash-scroll">
      {lots.map((lot) => (
        <Link key={lot.id} to="/production/dispatch" className="mes-dash-lot">
          <div>
            <strong>{lot.lot_number || 'Lot'}</strong>
            <p className="muted">{lot.component_label || '—'}</p>
          </div>
          <StatusBadge status={lot.can_dispatch ? 'READY' : 'blocked'}>
            {lot.can_dispatch ? 'Ready' : 'Blocked'}
          </StatusBadge>
        </Link>
      ))}
    </div>
  );
}
