import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Gauge, Hash, Package, RefreshCw, Target } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket } from '../socket/socketContext';
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
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      if (
        !cardIds.length ||
        cardIds.includes(id) ||
        payload?.action === 'advanced' ||
        payload?.action === 'progress' ||
        payload?.action === 'rollover'
      ) {
        load({ silent: true });
      }
    });
  }, [subscribe, load, id]);

  const card = detail?.card;
  const metrics = useMemo(() => {
    if (!card) return { goal: 0, good: 0, remaining: 0 };
    const goal = Number(
      card.day_goal ?? Number(card.target_quantity) + Number(card.overdue_quantity)
    );
    const good = Number(card.total_good_produced || 0);
    return {
      goal,
      good,
      remaining: Math.max(0, goal - good),
    };
  }, [card]);

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
        subtitle={
          <span>
            <TruncatedText>
              {[card?.component_label, card?.customer_name, card?.schedule_number]
                .filter(Boolean)
                .join(' · ')}
            </TruncatedText>
            {' · '}
            Due {formatDueLabel(card?.schedule_due_date, card?.schedule_due_weekday_label)}
            {card?.current_node_label ? ` · Current: ${card.current_node_label}` : ''}
          </span>
        }
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
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      <div className="mes-metric-grid">
        <MetricCard label="Day goal" value={metrics.goal} icon={Target} tone="info" />
        <MetricCard
          label="Current-op good"
          value={metrics.good}
          hint="Resets after each handoff"
          icon={Package}
          tone="success"
        />
        <MetricCard
          label="Remaining"
          value={metrics.remaining}
          icon={Hash}
          tone={metrics.remaining > 0 ? 'amber' : 'success'}
        />
        <MetricCard
          label="Ops completed"
          value={(detail?.completions || []).length}
          hint="Ledger handoffs on this card"
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
            Hover a node for operator, work center, and push qty. Live route for this daily card.
          </p>
        </div>
        <ProductionCardFlowChart flow={detail?.flow} tracking={detail?.tracking} />
      </section>
    </main>
  );
}
