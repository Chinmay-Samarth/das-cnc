import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import { PageHeader, StatusBadge, AlertBanner } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';

function fmtMoney(val) {
  return `₹${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
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

  return (
    <div>
      <PageHeader
        title={po.po_number}
        subtitle={po.supplier_name || 'No supplier assigned'}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isDraft ? (
              <>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => runAction('Split', async () => { await api.post(`/purchase-orders/${id}/split`); })}>
                  Split halves
                </button>
                <button type="button" className="primary-button" disabled={busy} onClick={() => runAction('Send PO', async () => { await api.post(`/purchase-orders/${id}/send`); })}>
                  Send to supplier
                </button>
              </>
            ) : null}
            {isDue ? (
              <>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => navigate(`/girn/create?purchase_order_id=${id}`)}>
                  Receive via GIRN
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await appConfirm({
                      title: 'Mark paid',
                      message: po.match_status === 'exceptions' ? 'Unresolved match exceptions exist. Mark paid anyway?' : 'Record payment for this PO?',
                      confirmLabel: 'Mark paid',
                    });
                    if (!ok) return;
                    await runAction('Mark paid', async () => {
                      await api.post(`/purchase-orders/${id}/mark-paid`, { override: po.match_status === 'exceptions' });
                    });
                  }}
                >
                  Mark paid
                </button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          <div><span className="muted">Status</span><div><StatusBadge status={po.status}>{po.status?.toUpperCase()}</StatusBadge></div></div>
          <div><span className="muted">Match</span><div>{po.match_status}</div></div>
          <div><span className="muted">Total</span><div>{fmtMoney(po.total_amount)}</div></div>
          <div><span className="muted">Expected delivery</span><div>{po.expected_delivery_date ? formatDisplayDate(po.expected_delivery_date) : '—'}</div></div>
          <div><span className="muted">Payment due</span><div>{po.due_date ? formatDisplayDate(po.due_date) : '—'}</div></div>
          <div><span className="muted">Fulfillment</span><div>{po.fulfillment_pct ?? 0}%</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Lines</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
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
                <td>{l.campaign_requirement ?? '—'}</td>
                <td>{l.moq ?? '—'}</td>
                <td>{l.quantity} {l.unit}</td>
                <td>{l.received_qty ?? 0}</td>
                <td>{l.open_qty ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(po.match_exceptions || []).length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Match exceptions</h3>
          <ul>
            {po.match_exceptions.filter((e) => !e.resolved).map((e) => (
              <li key={e.id} style={{ marginBottom: 8 }}>
                {e.exception_type}: expected {e.expected_value}, actual {e.actual_value}
                <button
                  type="button"
                  className="link-button"
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={() => runAction('Resolve', async () => {
                    await api.post(`/purchase-orders/${id}/match/${e.id}/resolve`);
                  })}
                >
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isDue || po.status === 'paid' ? (
        <div className="card">
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
              className="secondary-button"
              disabled={busy || !invoiceId.trim()}
              onClick={() => runAction('Link invoice', async () => {
                await api.post(`/purchase-orders/${id}/link-invoice`, { invoice_id: invoiceId.trim() });
              })}
            >
              Link
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => runAction('Re-run match', async () => { await api.get(`/purchase-orders/${id}/match`); })}>
              Re-run match
            </button>
          </div>
        </div>
      ) : null}

      {(po.girns || []).length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Linked GIRNs</h3>
          <ul>
            {po.girns.map((g) => (
              <li key={g.id}>
                <button type="button" className="link-button" onClick={() => navigate(`/girn/${g.id}`)}>
                  {g.girn_number} — {g.status}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
