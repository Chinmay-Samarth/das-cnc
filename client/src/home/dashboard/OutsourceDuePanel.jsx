import { Link } from 'react-router-dom';
import { EmptyState, StatusBadge } from '../../components/mes';

export default function OutsourceDuePanel({ outsource }) {
  const due = outsource?.due_today || [];
  const overdue = outsource?.overdue || [];
  if (!due.length && !overdue.length) {
    return <EmptyState title="No outsource due" description="Nothing expected back today." />;
  }

  const rows = [...overdue, ...due].slice(0, 5);
  return (
    <div>
      <div className="mes-dash-legend" style={{ marginBottom: 8 }}>
        <span>{outsource?.counts?.due_today || 0} due today</span>
        <span>{outsource?.counts?.overdue || 0} overdue</span>
      </div>
      <ul className="mes-dash-list">
        {rows.map((row) => (
          <li key={row.id}>
            <Link to="/production/outsource" className="mes-dash-list-row">
              <div>
                <strong>{row.shipment_number || 'Shipment'}</strong>
                <p className="muted">{row.component_label || row.supplier_name || '—'}</p>
              </div>
              <StatusBadge status={row.overdue ? 'OVERDUE' : 'READY'}>
                {row.overdue ? 'Overdue' : 'Due today'}
              </StatusBadge>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
