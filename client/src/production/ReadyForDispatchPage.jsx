import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, PackageCheck, RefreshCw, Truck } from 'lucide-react';
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
        subtitle="Invoice must be issued and confirmed printed before a lot can ship."
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/sales-invoices')}
            >
              <FileText size={16} />
              Sales invoices
            </button>
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
            const inv = lot.sales_invoice;
            const canDispatch = !!lot.can_dispatch;
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
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                      {!inv
                        ? 'Invoice: not created'
                        : inv.invoice_status === 'draft'
                          ? 'Invoice: draft (issue required)'
                          : inv.printed
                            ? `Invoice: ${inv.invoice_number || inv.invoice_status} · printed`
                            : `Invoice: ${inv.invoice_number || inv.invoice_status} · print confirmation needed`}
                    </p>
                  </div>
                  <StatusBadge status={lot.status} />
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {!inv ? (
                    <button
                      type="button"
                      className="mes-btn mes-btn-primary"
                      style={{ flex: 1, padding: '12px', fontSize: 14 }}
                      onClick={() => navigate(`/sales-invoices/new?lotId=${lot.id}`)}
                    >
                      Create invoice
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mes-btn mes-btn-secondary"
                      style={{ flex: 1, padding: '12px', fontSize: 14 }}
                      onClick={() =>
                        inv.invoice_status === 'draft' || !inv.printed
                          ? navigate(`/sales-invoices/new?lotId=${lot.id}`)
                          : navigate(`/sales-invoices/${inv.invoice_id}`)
                      }
                    >
                      {!inv.printed || inv.invoice_status === 'draft'
                        ? 'Open invoice wizard'
                        : 'View invoice'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary"
                    style={{ flex: 1, padding: '12px', fontSize: 14 }}
                    disabled={busy || !canDispatch}
                    title={
                      canDispatch
                        ? undefined
                        : 'Confirm invoice print before dispatch'
                    }
                    onClick={() => dispatchOne(lot.id)}
                  >
                    {busy ? 'Dispatching…' : 'Dispatch'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
