import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Package, RefreshCw, Send, Warehouse } from 'lucide-react';
import api from '../api/client';
import { useProductionRealtime } from '../socket/socketContext';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
  ProgressBar,
  MetricCard,
  AlertBanner,
} from '../components/mes';
import { appAlert } from '../components/dialog';

function qtyLabel(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toLocaleString() : '0';
}

function ColumnHeader({ title, count, hint }) {
  return (
    <div className="mes-kanban-col-header os-kanban-col-header">
      <div className="os-kanban-col-title-row">
        <h3>{title}</h3>
        <span className="os-kanban-count">{count}</span>
      </div>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

export default function OutsourcingPage() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [mergeByBatch, setMergeByBatch] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [bRes, cRes, sRes] = await Promise.all([
        api.get('/production/outsource/batches', { params: { status: 'open,ready' } }),
        api.get('/production/outsource/stage-candidates'),
        api.get('/production/outsource/shipments', { params: { status: 'sent' } }),
      ]);
      setBatches(bRes.data.batches || []);
      setCandidates(cRes.data.lots || []);
      setShipments(sRes.data.shipments || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load outsourcing queues.');
      setBatches([]);
      setCandidates([]);
      setShipments([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(() => load({ silent: true }), [load]);

  const openBatches = useMemo(
    () => batches.filter((b) => b.status === 'open'),
    [batches]
  );
  const readyBatches = useMemo(
    () => batches.filter((b) => b.status === 'ready'),
    [batches]
  );

  const stagingCount = candidates.length + openBatches.length;
  const stagedQtyWaiting = useMemo(
    () => openBatches.reduce((s, b) => s + Number(b.staged_qty || 0), 0),
    [openBatches]
  );
  const atSupplierQty = useMemo(
    () => shipments.reduce((s, sh) => s + Number(sh.sent_qty_total || 0), 0),
    [shipments]
  );

  function toggleCandidate(id) {
    setSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function stageSelected() {
    if (!selectedCandidateIds.length) return;
    const selected = candidates.filter((c) => selectedCandidateIds.includes(c.id));
    const nodeIds = [...new Set(selected.map((c) => c.current_activity_flow_node_id))];
    if (nodeIds.length !== 1) {
      setError('Select lots that share the same outsource step.');
      return;
    }
    setBusyKey('stage');
    setError(null);
    try {
      await api.post('/production/outsource/stage', {
        lot_ids: selectedCandidateIds,
        activity_flow_node_id: nodeIds[0],
      });
      setSelectedCandidateIds([]);
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Stage failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function sendBatch(batchId) {
    setBusyKey(`send-${batchId}`);
    setError(null);
    try {
      await api.post('/production/outsource/send', {
        batch_id: batchId,
        merge: !!mergeByBatch[batchId],
      });
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Send failed.');
    } finally {
      setBusyKey(null);
    }
  }

  function fileGirn(shipment) {
    const params = new URLSearchParams();
    params.set('outsource_shipment_id', shipment.id);
    if (shipment.supplier_id) params.set('supplier_id', shipment.supplier_id);
    if (shipment.shipment_number) params.set('po_reference', shipment.shipment_number);
    navigate(`/girn/create?${params.toString()}`);
  }

  async function retryReceive(shipment) {
    if (!shipment.girn_id) {
      await appAlert({
        title: 'GIRN required',
        message: 'File a GIRN for this shipment before it can be received.',
        tone: 'warning',
      });
      return;
    }
    setBusyKey(`recv-${shipment.id}`);
    setError(null);
    try {
      await api.post(`/production/outsource/${shipment.id}/receive`, {
        girn_id: shipment.girn_id,
      });
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Receive failed.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="Outsourcing"
        subtitle="Stage to the AF minimum, send the tied batch, then file a GIRN with the supplier invoice to receive."
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/today')}
            >
              My Today
            </button>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </>
        }
      />

      {error ? (
        <AlertBanner tone="danger" title="Something went wrong">
          {error}
        </AlertBanner>
      ) : null}

      {!loading ? (
        <div className="mes-metric-grid os-metric-grid">
          <MetricCard
            label="Staging"
            value={qtyLabel(stagedQtyWaiting + candidates.reduce((s, c) => s + Number(c.quantity || 0), 0))}
            hint={`${stagingCount} card(s) · waiting / candidates`}
            icon={Warehouse}
            tone="neutral"
          />
          <MetricCard
            label="Ready to send"
            value={String(readyBatches.length)}
            hint="Batches at min ship qty"
            icon={Send}
            tone="amber"
          />
          <MetricCard
            label="At supplier"
            value={qtyLabel(atSupplierQty)}
            hint={`${shipments.length} shipment(s)`}
            icon={Package}
            tone="info"
          />
        </div>
      ) : null}

      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <div className="mes-kanban os-kanban">
          {/* ── Staging ───────────────────────────────────────── */}
          <section className="mes-kanban-col os-kanban-col is-staging">
            <ColumnHeader
              title="Staging"
              count={stagingCount}
              hint="Hold lots until min components"
            />
            <div className="mes-kanban-cards">
              {candidates.length ? (
                <article className="mes-kanban-card os-card os-card-select">
                  <p className="os-card-eyebrow">Ready to stage</p>
                  <ul className="os-lot-check-list">
                    {candidates.map((lot) => (
                      <li key={lot.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.includes(lot.id)}
                            onChange={() => toggleCandidate(lot.id)}
                          />
                          <span>
                            <strong>{lot.lot_number}</strong>
                            <span className="muted">
                              {' '}
                              · {qtyLabel(lot.quantity)} · {lot.component_label || 'Component'}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary os-card-action"
                    disabled={busyKey === 'stage' || !selectedCandidateIds.length}
                    onClick={stageSelected}
                  >
                    <Warehouse size={16} />
                    Stage selected
                  </button>
                </article>
              ) : null}

              {openBatches.map((batch) => (
                <article key={batch.id} className="mes-kanban-card os-card">
                  <div className="os-card-top">
                    <p className="os-card-eyebrow">
                      <Warehouse size={14} aria-hidden />
                      Waiting
                    </p>
                    <StatusBadge status={batch.status} />
                  </div>
                  <h4 className="os-card-title">
                    <TruncatedText>{batch.component_label || 'Component'}</TruncatedText>
                  </h4>
                  <p className="os-card-meta">
                    {batch.node_label || 'Outsource'}
                    {batch.supplier_name ? ` · ${batch.supplier_name}` : ''}
                  </p>
                  <ProgressBar
                    value={Number(batch.staged_qty || 0)}
                    max={Number(batch.min_ship_qty || 1)}
                    label="Staged / min ship"
                  />
                  <ul className="os-lot-mini">
                    {(batch.lots || []).map((lot) => (
                      <li key={lot.id}>
                        {lot.lot_number} · {qtyLabel(lot.quantity)}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}

              {!candidates.length && !openBatches.length ? (
                <EmptyState
                  icon={Warehouse}
                  title="Nothing staging"
                  description="Lots land here when they reach an outsource AF step."
                />
              ) : null}
            </div>
          </section>

          {/* ── Ready to send ─────────────────────────────────── */}
          <section className="mes-kanban-col os-kanban-col is-ready">
            <ColumnHeader
              title="Ready to send"
              count={readyBatches.length}
              hint="Min ship qty met"
            />
            <div className="mes-kanban-cards">
              {readyBatches.map((batch) => {
                const busy = busyKey === `send-${batch.id}`;
                return (
                  <article key={batch.id} className="mes-kanban-card os-card os-card-ready">
                    <div className="os-card-top">
                      <p className="os-card-eyebrow">
                        <Send size={14} aria-hidden />
                        Ready
                      </p>
                      <StatusBadge status="ready" />
                    </div>
                    <h4 className="os-card-title">
                      <TruncatedText>{batch.component_label || 'Component'}</TruncatedText>
                    </h4>
                    <p className="os-card-meta">
                      {qtyLabel(batch.staged_qty)} pcs · {(batch.lots || []).length} lot(s)
                      {batch.supplier_name ? ` · ${batch.supplier_name}` : ''}
                    </p>
                    <ul className="os-lot-mini">
                      {(batch.lots || []).map((lot) => (
                        <li key={lot.id}>
                          {lot.lot_number} · {qtyLabel(lot.quantity)}
                        </li>
                      ))}
                    </ul>
                    <label className="os-merge-check">
                      <input
                        type="checkbox"
                        checked={!!mergeByBatch[batch.id]}
                        onChange={(e) =>
                          setMergeByBatch((prev) => ({
                            ...prev,
                            [batch.id]: e.target.checked,
                          }))
                        }
                      />
                      Merge lots on send
                    </label>
                    <button
                      type="button"
                      className="mes-btn mes-btn-primary os-card-action"
                      disabled={busy}
                      onClick={() => sendBatch(batch.id)}
                    >
                      Send tied batch
                    </button>
                  </article>
                );
              })}

              {!readyBatches.length ? (
                <EmptyState
                  icon={Send}
                  title="No batches ready"
                  description="When staged qty reaches the AF minimum, batches appear here."
                />
              ) : null}
            </div>
          </section>

          {/* ── At supplier ───────────────────────────────────── */}
          <section className="mes-kanban-col os-kanban-col is-supplier">
            <ColumnHeader
              title="At supplier"
              count={shipments.length}
              hint="File GIRN to receive"
            />
            <div className="mes-kanban-cards">
              {shipments.map((shipment) => {
                const busy = busyKey === `recv-${shipment.id}`;
                return (
                  <article key={shipment.id} className="mes-kanban-card os-card os-card-supplier">
                    <div className="os-card-top">
                      <p className="os-card-eyebrow">
                        <Package size={14} aria-hidden />
                        {shipment.shipment_number}
                      </p>
                      <StatusBadge status={shipment.status} />
                    </div>
                    <h4 className="os-card-title">
                      <TruncatedText>{shipment.component_label || 'Component'}</TruncatedText>
                    </h4>
                    <p className="os-card-meta">
                      Sent {qtyLabel(shipment.sent_qty_total)}
                      {shipment.supplier_name ? ` · ${shipment.supplier_name}` : ''}
                    </p>
                    <ul className="os-lot-mini">
                      {(shipment.lots || []).map((line) => (
                        <li key={line.lot_id}>
                          {line.lot_number || 'Lot'} · {qtyLabel(line.sent_qty)}
                        </li>
                      ))}
                    </ul>
                    {shipment.girn_id ? (
                      <p className="os-girn-linked muted">
                        GIRN {shipment.girn_number || shipment.girn_id.slice(0, 8)}
                        {shipment.girn_status ? ` · ${shipment.girn_status}` : ''}
                      </p>
                    ) : (
                      <p className="os-girn-hint muted">
                        Capture the supplier invoice via GIRN to complete receive.
                      </p>
                    )}
                    <button
                      type="button"
                      className="mes-btn mes-btn-primary os-card-action"
                      onClick={() => fileGirn(shipment)}
                      disabled={!!shipment.girn_id}
                    >
                      <ClipboardList size={16} />
                      {shipment.girn_id ? 'GIRN filed' : 'File GIRN'}
                    </button>
                    {shipment.girn_id ? (
                      <button
                        type="button"
                        className="mes-btn mes-btn-secondary os-card-action"
                        disabled={busy}
                        onClick={() => retryReceive(shipment)}
                      >
                        Retry receive
                      </button>
                    ) : null}
                  </article>
                );
              })}

              {!shipments.length ? (
                <EmptyState
                  icon={Package}
                  title="Nothing at supplier"
                  description="Sent shipments wait here until a return GIRN is filed."
                />
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
