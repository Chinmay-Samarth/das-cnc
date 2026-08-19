import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../auth/authContext';
import { EmptyState, StatusBadge } from '../../components/mes';

const TYPE_LABEL = {
  insufficient_stock: 'Stock short',
  reorder_purchase_required: 'Reorder',
  predictive_reorder: 'Predictive',
  open_punch_out: 'Punch-out',
  low_attendance: 'Attendance',
  consecutive_absent: 'Absence',
  leave_request_pending: 'Leave',
  dispatch_shortfall_pending: 'Shortfall',
  girn_pending_inspection: 'GIRN inspection',
  girn_ready_for_approval: 'GIRN approval',
  invoice_overdue: 'Invoice',
  op1_schedule_delay: 'Op1 delay',
  outsource_lead_delay: 'Outsource',
  horizon_wave_renewed: 'Wave renew',
  horizon_wave_stuck: 'Wave stuck',
  tool_life_low: 'Tool life',
};

function destFor(n) {
  if (n.type === 'reorder_purchase_required' || n.type === 'predictive_reorder') {
    const cat = n.payload?.item_category || 'raw_material';
    const id = n.payload?.master_record_id;
    return id
      ? `/stock?category=${encodeURIComponent(cat)}&master_record_id=${encodeURIComponent(id)}`
      : '/stock';
  }
  if (n.type === 'insufficient_stock') return '/stock';
  if (n.type === 'dispatch_shortfall_pending' || n.type === 'girn_ready_for_approval') {
    return '/approvals';
  }
  return '/notifications?priority=1';
}

function mergeAlerts(alerts, inventory) {
  const byId = new Map();
  for (const n of inventory?.items || []) {
    if (n?.id) byId.set(n.id, n);
  }
  for (const n of alerts?.items || []) {
    if (n?.id && !byId.has(n.id)) byId.set(n.id, n);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export default function P1AlertsPanel({ alerts, inventory }) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const items = mergeAlerts(alerts, inventory);

  async function handleCreatePo(e, n) {
    e.stopPropagation();
    try {
      const { data } = await api.post('/purchase-orders/from-alert', {
        ...n.payload,
        notification_id: n.id,
      });
      navigate(`/purchase-orders/${data.purchase_order.id}`);
    } catch (err) {
      console.error(err);
    }
  }

  if (!items.length) {
    return <EmptyState title="No P1 alerts" description="Critical unread alerts will show here." />;
  }

  return (
    <ul className="mes-dash-list">
      {items.slice(0, 6).map((n) => {
        const canCreatePo =
          isAdmin() &&
          (n.type === 'reorder_purchase_required' || n.type === 'predictive_reorder');
        return (
          <li key={n.id}>
            <button type="button" className="mes-dash-alert" onClick={() => navigate(destFor(n))}>
              <div className="mes-dash-alert-top">
                <strong>{n.title}</strong>
                <StatusBadge
                  status={
                    n.type === 'insufficient_stock' ||
                    n.type === 'reorder_purchase_required' ||
                    n.type === 'predictive_reorder'
                      ? 'OVERDUE'
                      : 'READY'
                  }
                >
                  {TYPE_LABEL[n.type] || n.type || 'P1'}
                </StatusBadge>
              </div>
              {n.body ? <p className="muted">{n.body}</p> : null}
              {canCreatePo ? (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: 8 }}
                  onClick={(e) => handleCreatePo(e, n)}
                >
                  Create PO
                </button>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
