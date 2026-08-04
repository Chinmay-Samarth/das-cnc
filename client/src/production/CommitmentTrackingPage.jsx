import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Target, Hash, TrendingUp, Gauge } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import {
  PageHeader,
  MetricCard,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';
import ProductionCardFlowChart from './ProductionCardFlowChart';

export default function CommitmentTrackingPage() {
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
        const { data } = await api.get(`/campaigns/commitments/${id}`);
        setDetail(data);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load commitment');
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
    return subscribe('production:updated', () => load({ silent: true }));
  }, [subscribe, load]);

  const commitment = detail?.commitment;
  const campaign = detail?.campaign;
  console.dir(campaign ,{depth: null})
  const lots = detail?.lots || [];
  const schedules = detail?.coverage || detail?.schedules || [];
  const tracking = detail?.tracking || [];

  const metrics = useMemo(() => {
    if (!commitment) {
      return { dayProgress: 0, campaignProgress: 0, remaining: 0, opsDone: 0, lotsCount: 0 };
    }
    const dayProgress =
      commitment.committed_qty > 0
        ? Math.round((commitment.good_qty / commitment.committed_qty) * 100)
        : 0;
    const campaignProgress =
      campaign && campaign.target_quantity > 0
        ? Math.round((campaign.good_quantity / campaign.target_quantity) * 100)
        : 0;
    const remaining = Math.max(0, commitment.committed_qty - commitment.good_qty);
    const opsDone = tracking.filter((t) => t.status === 'done').length;
    return {
      dayProgress,
      campaignProgress,
      remaining,
      opsDone,
      lotsCount: lots.length,
    };
  }, [commitment, campaign, lots, tracking]);

  if (loading && !detail) {
    return (
      <main className="mes-shell">
        <p className="muted">Loading commitment…</p>
      </main>
    );
  }

  if (error && !commitment) {
    return (
      <main className="mes-shell">
        <EmptyState
          title="Commitment not found"
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
        eyebrow="Commitment tracking"
        title={campaign?.component_label || 'Commitment'}
        subtitle={`${detail?.work_center?.code || commitment?.work_center_code || 'WC'} · ${commitment?.work_date || ''}`}
        actions={
          <>
            <StatusBadge status={commitment?.status}>{commitment?.status}</StatusBadge>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production')}
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
        <MetricCard
          label="Day goal"
          value={`${commitment?.good_qty || 0} / ${commitment?.committed_qty || 0}`}
          hint={`${metrics.dayProgress}%`}
          icon={Target}
          tone={metrics.dayProgress >= 100 ? 'success' : 'amber'}
        />
        <MetricCard
          label="Campaign"
          value={`${campaign?.good_quantity || 0} / ${campaign?.target_quantity || 0}`}
          hint={`${metrics.campaignProgress}%`}
          icon={TrendingUp}
          tone="info"
        />
        <MetricCard
          label="Remaining today"
          value={metrics.remaining}
          icon={Hash}
          tone={metrics.remaining > 0 ? 'amber' : 'success'}
        />
        <MetricCard
          label="Ops completed"
          value={metrics.opsDone}
          hint="Route steps marked done"
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
            Interactive route for this campaign. Hover a node for qty and work center. Day Done on My
            Today completes the WC operation step.
          </p>
        </div>
        <ProductionCardFlowChart flow={detail?.flow} tracking={detail?.tracking} />
      </section>

      <section className="mes-card" style={{ padding: 16, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px' }}>Campaign details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>
              Component
            </p>
            <TruncatedText>
              <strong>{campaign?.component_label || '—'}</strong>
            </TruncatedText>
          </div>
          <div>
            <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>
              Status
            </p>
            <StatusBadge status={campaign?.status}>{campaign?.status || '—'}</StatusBadge>
          </div>
          <div>
            <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>
              Demand rank
            </p>
            <strong>#{campaign?.demand_rank || '—'}</strong>
          </div>
          <div>
            <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>
              Work center
            </p>
            <TruncatedText>
              <strong>
                {detail?.work_center?.code || '—'}
                {detail?.work_center?.name ? ` — ${detail.work_center.name}` : ''}
              </strong>
            </TruncatedText>
          </div>
        </div>
      </section>

      {lots.length > 0 ? (
        <section className="mes-card" style={{ padding: 16, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px' }}>Lots</h3>
          <div className="data-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Lot #</th>
                  <th>Quantity</th>
                  <th>Status</th>
                  <th>Current node</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <strong>{lot.lot_number}</strong>
                    </td>
                    <td>{lot.quantity || 0}</td>
                    <td>
                      <StatusBadge status={lot.status}>{lot.status}</StatusBadge>
                    </td>
                    <td>
                      <TruncatedText>{lot.current_node_label || '—'}</TruncatedText>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {schedules.length > 0 ? (
        <section className="mes-card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Coverage schedules</h3>
          <div className="data-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Schedule #</th>
                  <th>Due date</th>
                  <th>Qty</th>
                  <th>Covered</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((row) => {
                  const sched = row.schedule || row;
                  return (
                    <tr key={row.id || sched.id}>
                      <td>
                        <TruncatedText>{sched.schedule_number || '—'}</TruncatedText>
                      </td>
                      <td>{sched.due_date || '—'}</td>
                      <td>{row.schedule_qty ?? sched.quantity ?? 0}</td>
                      <td>{row.covered_qty ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
