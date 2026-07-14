import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageCheck, RefreshCw, Truck } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useProductionRealtime } from '../socket/socketContext';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';

export default function ReadyForDispatchPage() {
  const navigate = useNavigate();
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/production/ready-for-dispatch');
      setLots(data.lots || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load ready-for-dispatch queue.');
      setLots([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(() => load({ silent: true }), [load]);

  async function dispatchOne(lotId) {
    setBusyId(lotId);
    setError(null);
    try {
      await api.post(`/production/lots/${lotId}/dispatch`);
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Dispatch failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="Ready for Dispatch"
        subtitle="Lots that finished packing (or landed on a dispatch AF node). Dispatch clears them from the queue."
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/work-centers')}
            >
              WC Board
            </button>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !lots.length ? (
        <EmptyState
          icon={PackageCheck}
          title="Nothing ready"
          description="Lots appear here after packing (or a terminal dispatch node) completes."
          actionLabel="Open WC Board"
          onAction={() => navigate('/production/work-centers')}
        />
      ) : (
        <div className="mes-task-queue">
          {lots.map((lot) => {
            const busy = busyId === lot.id;
            return (
              <article key={lot.id} className="mes-task-card">
                <div className="mes-task-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="mes-task-id">
                      <Truck size={16} aria-hidden />
                      <span>{lot.lot_number}</span>
                      {lot.card_number ? (
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                          onClick={() => navigate(`/production/cards/${lot.production_card_id}`)}
                        >
                          {lot.card_number}
                        </button>
                      ) : null}
                    </p>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
                      <TruncatedText>{lot.component_label || 'Component'}</TruncatedText>
                    </h2>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Qty <strong>{Number(lot.quantity || 0)}</strong>
                      {lot.schedule_due_date
                        ? ` · Due ${formatDueLabel(lot.schedule_due_date)}`
                        : ''}
                      {lot.current_node_label ? ` · ${lot.current_node_label}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={lot.status} />
                </div>
                <button
                  type="button"
                  className="mes-btn mes-btn-primary"
                  style={{ width: '100%', padding: '14px', fontSize: 15, marginTop: 12 }}
                  disabled={busy}
                  onClick={() => dispatchOne(lot.id)}
                >
                  {busy ? 'Dispatching…' : 'Dispatch'}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
