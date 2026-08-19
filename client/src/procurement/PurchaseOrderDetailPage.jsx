import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import { PageHeader, StatusBadge, AlertBanner, ProgressRing } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { downloadPurchaseOrderPdf, printPurchaseOrderPdf, formatInr } from './downloadPurchaseOrderPdf';
import { Download, Printer, Pencil, Split, PackagePlus, Truck, Banknote, ExternalLink, Link2, RefreshCw, Check, ClipboardList } from 'lucide-react';

function poStatusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'pending';
  if (status === 'delivered') return 'running';
  return 'draft';
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get(`/purchase-orders/${id}`);
      setPo(data.purchase_order);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load purchase order.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function runAction(label, fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      await appAlert({ title: label, message: `${label} completed.`, tone: 'success' });
    } catch (err) {
      await appAlert({
        title: 'Action failed',
        message: err.response?.data?.error || err.message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <AlertBanner tone="danger">{error}</AlertBanner>;
  if (!po) return null;

  const isDraft = po.status === 'draft';
  const isDue = po.status === 'due';
  const isDelivered = po.status === 'delivered';
  const openExceptions = (po.match_exceptions || []).filter((e) => !e.resolved);
  const allReceived = (po.lines || []).length > 0 && (po.lines || []).every((l) => Number(l.received_qty) >= Number(l.quantity));

  return (
    <div>
      <PageHeader
        title={po.po_number}
        subtitle={po.supplier_name || 'No supplier assigned'}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isDraft ? (
              <>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => navigate(`/purchase-orders/create?id=${id}`)}
                >
                  <Pencil size={16} />
                  Edit in wizard
                </button>
                <button
                  type="button"
                  className="neutral-button"
                  disabled={busy}
                  onClick={() =>
                    runAction('Split', async () => {
                      await api.post(`/purchase-orders/${id}/split`);
                    })
                  }
                >
                  <Split size={16} />
                  Split halves
                </button>
              </>
            ) : null}
            {isDue || isDelivered ? (
              <button
                type="button"
                className="neutral-button"
                disabled={busy}
                onClick={() => navigate(`/girn/create?purchase_order_id=${id}`)}
              >
                <PackagePlus size={16} />
                Receive via GIRN
              </button>
            ) : null}
            {isDue && allReceived ? (
              <button
                type="button"
                className="neutral-button"
                disabled={busy}
                onClick={() =>
                  runAction('Mark delivered', async () => {
                    await api.post(`/purchase-orders/${id}/delivered`);
                  })
                }
              >
                <Truck size={16} />
                Mark delivered
              </button>
            ) : null}
            {isDue || isDelivered ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  const ok = await appConfirm({
                    title: 'Mark paid',
                    message:
                      po.match_status === 'exceptions'
                        ? 'Unresolved match exceptions exist. Mark paid anyway?'
                        : 'Record payment for this PO?',
                    confirmLabel: 'Mark paid',
                  });
                  if (!ok) return;
                  await runAction('Mark paid', async () => {
                    await api.post(`/purchase-orders/${id}/mark-paid`, {
                      override: po.match_status === 'exceptions',
                    });
                  });
                }}
              >
                <Banknote size={16} />
                Mark paid
              </button>
            ) : null}
          </div>
        }
      />

      {openExceptions.length > 0 ? (
        <AlertBanner tone="danger">
          {openExceptions.length} unmatched GIRN/invoice exception(s) on this PO. Resolve them below before paying.
        </AlertBanner>
      ) : null}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <ProgressRing value={po.fulfillment_pct || 0} max={100} label={`${Math.round(po.fulfillment_pct || 0)}%`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, flex: 1 }}>
          <div>
            <span className="muted">Status</span>
            <div>
              <StatusBadge status={poStatusTone(po.status)}>{po.status?.toUpperCase()}</StatusBadge>
            </div>
          </div>
          <div>
            <span className="muted">Match</span>
            <div>{po.match_status}</div>
          </div>
          <div>
            <span className="muted">Total</span>
            <div>{formatInr(po.total_amount)}</div>
          </div>
          <div>
            <span className="muted">Expected delivery</span>
            <div>{po.expected_delivery_date ? formatDisplayDate(po.expected_delivery_date) : '—'}</div>
          </div>
          <div>
            <span className="muted">Payment due</span>
            <div>{po.due_date ? formatDisplayDate(po.due_date) : '—'}</div>
          </div>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 16 }}>
        Created by {po.created_by_name || '—'}
        {po.edited_by_name ? ` · Edited by ${po.edited_by_name}` : ''}
        {po.sent_by_name ? ` · Ordered by ${po.sent_by_name}` : ''}
        {po.payment_recorded_by_name ? ` · Payment recorded by ${po.payment_recorded_by_name}` : ''}
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Lines</h3>
        <div className="app-table-wrap">
        <table className="app-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Trigger</th>
              <th>Campaign need</th>
              <th>MOQ</th>
              <th>Ordered</th>
              <th>Received</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {(po.lines || []).map((l) => (
              <tr key={l.id}>
                <td>{l.line_no}</td>
                <td>{l.item_label}</td>
                <td>{l.trigger_reason || '—'}</td>
                <td>{l.campaign_requirement ?? '—'}</td>
                <td>{l.moq ?? '—'}</td>
                <td>
                  {l.quantity} {l.unit}
                </td>
                <td>{l.received_qty ?? 0}</td>
                <td>{l.open_qty ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>PDF</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="neutral-button"
            disabled={busy}
            onClick={() =>
              runAction('Download PDF', async () => {
                const stored = await downloadPurchaseOrderPdf(po);
                setPo(stored);
              })
            }
          >
            <Download size={16} />
            Download PDF
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() =>
              runAction('Print PDF', async () => {
                const stored = await printPurchaseOrderPdf(po);
                setPo(stored);
              })
            }
          >
            <Printer size={16} />
            Print PDF
          </button>
          {po.pdf_url ? (
            <a href={po.pdf_url} target="_blank" rel="noreferrer" className="neutral-button">
              <ExternalLink size={16} />
              View stored PDF
            </a>
          ) : null}
        </div>
      </div>

      {openExceptions.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Match exceptions</h3>
          <ul>
            {openExceptions.map((e) => (
              <li key={e.id} style={{ marginBottom: 8 }}>
                {e.exception_type}: expected {e.expected_value}, actual {e.actual_value}
                <button
                  type="button"
                  className="link-button"
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={() =>
                    runAction('Resolve', async () => {
                      await api.post(`/purchase-orders/${id}/match/${e.id}/resolve`);
                    })
                  }
                >
                  <Check size={14} />
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isDue || isDelivered || po.status === 'paid' ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Link vendor invoice</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Invoice UUID"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="neutral-button"
              disabled={busy || !invoiceId.trim()}
              onClick={() =>
                runAction('Link invoice', async () => {
                  await api.post(`/purchase-orders/${id}/link-invoice`, { invoice_id: invoiceId.trim() });
                })
              }
            >
              <Link2 size={16} />
              Link
            </button>
            <button
              type="button"
              className="neutral-button"
              disabled={busy}
              onClick={() =>
                runAction('Re-run match', async () => {
                  await api.get(`/purchase-orders/${id}/match`);
                })
              }
            >
              <RefreshCw size={16} />
              Re-run match
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Linked GIRNs</h3>
        {(po.girns || []).length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {po.girns.map((g) => (
              <li key={g.id}>
                <Link to={`/girn/${g.id}`} className="neutral-button" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <ClipboardList size={16} />
                  {g.girn_number} — {g.status}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ marginBottom: isDue || isDelivered ? 12 : 0 }}>
            No GIRN receipts linked yet.
          </p>
        )}
        {isDue || isDelivered ? (
          <button
            type="button"
            className="neutral-button"
            disabled={busy}
            onClick={() => navigate(`/girn/create?purchase_order_id=${id}`)}
          >
            <PackagePlus size={16} />
            Receive via GIRN
          </button>
        ) : null}
      </div>
    </div>
  );
}
