import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Gauge, Hash, Package, RefreshCw, Target } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket } from '../socket/socketContext';
import { useAuth } from '../auth/authContext';
import { appAlert } from '../components/dialog';
import {
  PageHeader,
  MetricCard,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';
import ProductionCardFlowChart from './ProductionCardFlowChart';

export default function ProductionCardTrackingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const { hasAccess } = useAuth();
  const isManager = hasAccess('SUPERVISOR');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitForm, setSplitForm] = useState({
    quantity: '',
    work_date: '',
    employee_id: '',
  });
  const [operators, setOperators] = useState([]);
  const [operatorWcId, setOperatorWcId] = useState(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!id) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/production/cards/${id}`);
        setDetail(data);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load card tracking.');
        setDetail(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('production:updated', (payload) => {
      const cardIds = payload?.cardIds || (payload?.cardId ? [payload.cardId] : []);
      const action = String(payload?.action || '');
      const lotActions = new Set([
        'lot_created',
        'lot_advanced',
        'lot_ready_for_dispatch',
        'lot_dispatched',
        'lot_reassigned',
      ]);
      if (
        !cardIds.length ||
        cardIds.includes(id) ||
        payload?.lotId ||
        payload?.lot_id ||
        lotActions.has(action) ||
        action === 'advanced' ||
        action === 'progress' ||
        action === 'completed' ||
        action === 'rollover'
      ) {
        load({ silent: true });
      }
    });
  }, [subscribe, load, id]);

  const card = detail?.card;
  const metrics = useMemo(() => {
    if (!card) {
      return { goal: 0, good: 0, remaining: 0, opsDone: 0, overdue: 0, movable: 0 };
    }
    const goal = Number(
      card.day_goal ?? Number(card.target_quantity) + Number(card.overdue_quantity)
    );
    const good = Number(card.total_good_produced || 0);
    const tracking = detail?.tracking || [];
    const opsDone = tracking.filter((t) => t.status === 'done').length;
    const remaining = Math.max(0, goal - good);
    const overdue = Number(card.overdue_quantity || 0);
    // Rolled-over qty on this / future cards (from automatic Done carry) — not day remaining
    const movable = Math.max(0, Number(detail?.split_available ?? overdue));
    return {
      goal,
      good,
      remaining,
      overdue,
      opsDone,
      movable,
    };
  }, [card, detail?.tracking, detail?.split_available]);

  const canSplit = isManager && metrics.movable > 0;

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  useEffect(() => {
    if (!splitOpen) {
      setOperators([]);
      return;
    }
    const wcId = card?.work_center_id || operatorWcId;
    if (!wcId) {
      // Resolve Op1 WC from first tracking schedulable node if card WC missing
      const firstWc =
        (detail?.tracking || []).find((t) => t.schedulable && t.work_center_id)?.work_center_id ||
        null;
      if (firstWc) setOperatorWcId(firstWc);
      return;
    }
    api
      .get(`/work-centers/${wcId}/operators`)
      .then(({ data }) => setOperators(data.operators || data || []))
      .catch(() => setOperators([]));
  }, [splitOpen, card?.work_center_id, operatorWcId, detail?.tracking]);

  async function handleSplitRemaining(e) {
    e.preventDefault();
    if (!splitForm.employee_id) {
      await appAlert('Pick an employee to assign the new card.');
      return;
    }
    setSplitBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/production/cards/${id}/split-remaining`, {
        quantity: splitForm.quantity !== '' ? Number(splitForm.quantity) : undefined,
        work_date: splitForm.work_date || todayStr(),
        employee_id: splitForm.employee_id,
      });
      setSplitOpen(false);
      setSplitForm({ quantity: '', work_date: '', employee_id: '' });
      await load();
      if (data?.card?.id) {
        await appAlert({
          title: 'New card created',
          message: `Created ${data.card.card_number} for qty ${data.quantity}.`,
          tone: 'success',
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Split remaining failed.');
    } finally {
      setSplitBusy(false);
    }
  }

  const handoffRows = useMemo(() => {
    const tracking = detail?.tracking || [];
    return tracking
      .filter((t) => t.schedulable || t.outsource || t.activity_type === 'dispatch')
      .slice()
      .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
  }, [detail?.tracking]);

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  if (loading && !detail) {
    return (
      <main className="mes-shell">
        <p className="muted">Loading route tracking…</p>
      </main>
    );
  }

  if (error && !card) {
    return (
      <main className="mes-shell">
        <EmptyState
          title="Card not found"
          description={error}
          actionLabel="Back to production"
          onAction={() => navigate('/production')}
        />
      </main>
    );
  }

  return (
    <main className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Production tracking"
        title={card?.card_number || 'Production card'}
        // subtitle={
        //   <span>
        //     <TruncatedText>
        //       {[card?.component_label, card?.customer_name, card?.schedule_number]
        //         .filter(Boolean)
        //         .join(' · ')}
        //     </TruncatedText>
        //     {' · '}
        //     Due {formatDueLabel(card?.schedule_due_date, card?.schedule_due_weekday_label)}
        //     {detail?.tracking_pointer?.label
        //       ? ` · Lot at: ${detail.tracking_pointer.label}${
        //           detail.tracking_pointer.lot_number
        //             ? ` (${detail.tracking_pointer.lot_number})`
        //             : ''
        //         }`
        //       : card?.current_node_label
        //         ? ` · Current: ${card.current_node_label}`
        //         : ''}
        //     <span className="muted" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
        //       Each machined step credits its operator. Schedule day complete ≠ route complete.
        //     </span>
        //   </span>
        // }
        actions={
          <>
            <StatusBadge status={card?.status} />
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => load()}
              disabled={loading}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            {canSplit ? (
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                onClick={() => {
                  setSplitForm({
                    quantity: String(metrics.movable),
                    work_date: todayStr(),
                    employee_id: '',
                  });
                  setSplitOpen((o) => !o);
                }}
              >
                Split remaining
              </button>
            ) : null}
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      {splitOpen && canSplit ? (
        <form className="mes-card" style={{ marginBottom: 16, padding: 16 }} onSubmit={handleSplitRemaining}>
          <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Split remaining</h3>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
            Pull up to <strong>{metrics.movable}</strong> rolled-over qty from future cards on this
            schedule into a <strong>new JOB card</strong> and assign an employee. Automatic Done
            rollover is unchanged.
          </p>
          <div className="mes-filters" style={{ marginBottom: 12 }}>
            <label>
              Quantity
              <input
                type="number"
                min="0.0001"
                step="any"
                max={metrics.movable}
                value={splitForm.quantity}
                onChange={(e) => setSplitForm((f) => ({ ...f, quantity: e.target.value }))}
                required
              />
            </label>
            <label>
              Work date
              <input
                type="date"
                value={splitForm.work_date}
                onChange={(e) => setSplitForm((f) => ({ ...f, work_date: e.target.value }))}
                required
              />
            </label>
            <label>
              Assign to
              <select
                value={splitForm.employee_id}
                onChange={(e) => setSplitForm((f) => ({ ...f, employee_id: e.target.value }))}
                required
              >
                <option value="">Select employee…</option>
                {operators.map((op) => (
                  <option key={op.employee_id || op.id} value={op.employee_id || op.id}>
                    {op.full_name || op.name}
                    {op.employee_code ? ` (${op.employee_code})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              className="mes-btn mes-btn-primary"
              disabled={splitBusy || !operators.length}
            >
              {splitBusy ? 'Creating…' : 'Create card'}
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              disabled={splitBusy}
              onClick={() => setSplitOpen(false)}
            >
              Cancel
            </button>
          </div>
          {!operators.length ? (
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
              No operators linked to this work center.
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="mes-metric-grid">
        <MetricCard
          label="Day goal (Op1)"
          value={metrics.goal}
          hint="Schedule day target for first op"
          icon={Target}
          tone="info"
        />
        <MetricCard
          label="Op1 good"
          value={metrics.good}
          hint="First-op day output on schedule card"
          icon={Package}
          tone="success"
        />
        <MetricCard
          label="Op1 remaining"
          value={metrics.remaining}
          icon={Hash}
          tone={metrics.remaining > 0 ? 'amber' : 'success'}
        />
        <MetricCard
          label="Ops completed"
          value={metrics.opsDone}
          hint="Schedulable route steps marked done"
          icon={Gauge}
          tone="info"
        />
      </div>

      <div className="pc-track-legend" aria-label="Route status legend">
        <span className="pc-track-legend-item is-done">Done</span>
        <span className="pc-track-legend-item is-running">Running</span>
        <span className="pc-track-legend-item is-pending">Pending</span>
        <span className="pc-track-legend-item is-info">Helper / info</span>
      </div>

      <section className="pc-track-panel">
        <div className="pc-track-panel-head">
          <h2>Activity flow</h2>
          <p className="muted">
            Operator name on each done/running step. Hover for qty and work center. Ready for
            Dispatch only after all route ops, at the AF dispatch node.
          </p>
        </div>
        <ProductionCardFlowChart flow={detail?.flow} tracking={detail?.tracking} />
      </section>

      <section className="pc-track-panel" style={{ marginTop: 20 }}>
        <div className="pc-track-panel-head">
          <h2>Route handoffs</h2>
          <p className="muted">Who ran each step on this schedule card.</p>
        </div>
        {handoffRows.length ? (
          <div className="employees-table-wrap" style={{ margin: 0 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Op</th>
                  <th>WC</th>
                  <th>Operator</th>
                  <th>Good</th>
                  <th>Scrap</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {handoffRows.map((t) => (
                  <tr key={t.node_id || t.id || `${t.label}-${t.status}`}>
                    <td>
                      <strong>{t.label || '—'}</strong>
                      {t.activity_type ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t.activity_type}
                        </div>
                      ) : null}
                    </td>
                    <td>{t.work_center_code || '—'}</td>
                    <td>
                      {t.status === 'pending' || (t.status === 'info' && t.phase !== 'passed')
                        ? '—'
                        : t.operator_name || '—'}
                      {t.operator_code && t.operator_name ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {' '}
                          ({t.operator_code})
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {t.status === 'done' || t.status === 'running'
                        ? Number(t.good_qty || 0)
                        : '—'}
                    </td>
                    <td>
                      {t.status === 'done' ? Number(t.scrap_qty || 0) : '—'}
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {t.status === 'done' ? formatWhen(t.completed_at) : '—'}
                    </td>
                    <td>
                      <StatusBadge
                        status={
                          t.status === 'info'
                            ? t.phase === 'passed'
                              ? 'COMPLETED'
                              : 'READY'
                            : t.status === 'done'
                              ? 'COMPLETED'
                              : t.status === 'running'
                                ? 'RUNNING'
                                : 'READY'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No route steps loaded.</p>
        )}
      </section>
    </main>
  );
}
