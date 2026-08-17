import { Link } from 'react-router-dom';
import { EmptyState, ProgressBar } from '../../components/mes';

export default function CampaignProgressPanel({ campaigns }) {
  const items = campaigns?.active || [];
  if (!items.length) {
    return <EmptyState title="No active campaigns" description="Lock a horizon wave to start production." />;
  }

  return (
    <div className="mes-dash-campaigns">
      {items.slice(0, 5).map((c) => (
        <Link key={c.id} to="/production/campaigns" className="mes-dash-campaign">
          <div className="mes-dash-campaign-top">
            <strong>{c.component_label || 'Component'}</strong>
            <span className="muted">{c.work_center_code || c.work_center_name || 'WC'}</span>
          </div>
          <ProgressBar value={c.good_quantity} max={c.target_quantity || 1} label={`${c.progress_pct}%`} />
        </Link>
      ))}
    </div>
  );
}
