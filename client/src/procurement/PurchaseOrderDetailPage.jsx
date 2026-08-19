import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import { PageHeader, StatusBadge, AlertBanner, ProgressRing } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import InvoicePdfViewer from '../components/Invoices/InvoicePdfViewer';
import PurchaseOrderPdfDocument from './PurchaseOrderPdfDocument';
import {
  downloadPurchaseOrderPdf,
  printPurchaseOrderPdf,
  regeneratePurchaseOrderPdf,
  formatInr,
} from './downloadPurchaseOrderPdf';
import {
  Download,
  Printer,
  Pencil,
  Split,
  PackagePlus,
  Truck,
  Banknote,
  RefreshCw,
  Check,
  ClipboardList,
  ExternalLink,
} from 'lucide-react';

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
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const load = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/sales-invoices/company-settings')
      .then(({ data }) => {
        if (!cancelled) setCompany(data?.company_settings || {});
      })
      .catch(() => {
        if (!cancelled) setCompany({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!po) {
      setPdfFile(null);
      setPdfLoading(false);
      return undefined;
    }

    let cancelled = false;
    let blobUrl = null;
    setPdfLoading(true);

    async function resolvePdf() {
      try {
        if (po.pdf_url) {
          if (!cancelled) setPdfFile(po.pdf_url);
          return;
        }
        if (company == null) return;
        const blob = await pdf(
          <PurchaseOrderPdfDocument po={po} company={company || {}} />
        ).toBlob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setPdfFile(blobUrl);
      } catch (err) {
        console.error('Failed to preview purchase order PDF', err);
        if (!cancelled) setPdfFile(null);
      } finally {
        if (!cancelled && (po.pdf_url || company != null)) setPdfLoading(false);
      }
    }

    resolvePdf();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [
    po?.id,
    po?.pdf_url,
    po?.status,
    po?.po_number,
    po?.updated_at,
    po?.notes,
    company,
  ]);

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

  async function handlePrint() {
    if (!po) return;
    setBusy(true);
    try {
      const stored = await printPurchaseOrderPdf({ ...po, company: company || {} });
      if (stored?.id) setPo(stored);
    } catch (err) {
      await appAlert({ title: 'Print failed', message: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!po) return;
    setBusy(true);
    try {
      const stored = await downloadPurchaseOrderPdf({ ...po, company: company || {} });
      if (stored?.id) setPo(stored);
    } catch (err) {
      await appAlert({ title: 'Download failed', message: err.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!po) return;
    setBusy(true);
    try {
      const stored = await regeneratePurchaseOrderPdf({ ...po, company: company || {} });
      if (stored?.id) setPo(stored);
      await appAlert({ title: 'PDF regenerated', message: 'Purchase order PDF regenerated.', tone: 'success' });
    } catch (err) {
      await appAlert({ title: 'Regenerate failed', message: err.message, tone: 'danger' });
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
    <div className='app-shell'>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <button type="button" className="neutral-button" disabled={busy} onClick={handlePrint}>
          <Printer size={16} />
          Print PO
        </button>
        <button type="button" className="neutral-button" disabled={busy} onClick={handleDownload}>
          <Download size={16} />
          Download PDF
        </button>
        <button type="button" className="neutral-button" disabled={busy} onClick={handleRegenerate}>
          <RefreshCw size={16} />
          Regenerate PDF
        </button>
      </div>

      <div className="sales-invoice-detail-layout">
      <div>
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
                {g.invoice_id ? (
                  <Link to={`/invoices/${g.invoice_id}`} className="link-button" style={{ marginLeft: 8 }}>
                    <ExternalLink size={14} />
                    Vendor invoice
                  </Link>
                ) : null}
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

      <section className="mes-card sales-invoice-pdf-card">
        <InvoicePdfViewer
          file={pdfFile}
          title={`Purchase order ${po.po_number || 'draft'}`}
          loading={pdfLoading}
          emptyTitle="PDF not ready"
          emptyDescription="Generate the purchase order PDF to preview it here."
          emptyActionLabel={busy ? 'Printing…' : 'Print PO'}
          onEmptyAction={busy ? undefined : handlePrint}
        />
      </section>
      </div>
    </div>
  );
}
