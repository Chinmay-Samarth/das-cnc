import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/mes';

export default function WcHeatmapPanel({ workCenters }) {
  const navigate = useNavigate();
  const items = workCenters?.items || [];
  if (!items.length) {
    return <EmptyState title="No work centers" description="Add work centers to see shop-floor heat." />;
  }

  return (
    <div>
      <div className="mes-dash-legend" style={{ marginBottom: 10 }}>
        <span>{workCenters?.counts?.running || 0} running</span>
        <span>{workCenters?.counts?.idle || 0} idle</span>
        <span>{workCenters?.counts?.overdue || 0} overdue</span>
      </div>
      <div className="mes-dash-heatmap">
        {items.map((wc) => (
          <button
            key={wc.id}
            type="button"
            className={`mes-dash-heat mes-dash-heat-${wc.status}`}
            onClick={() => navigate('/production/work-centers')}
            title={`${wc.name || wc.code}: ${wc.running_cards} running, ${wc.scheduled_cards} scheduled`}
          >
            <strong>{wc.code || wc.name}</strong>
            <span>{wc.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
