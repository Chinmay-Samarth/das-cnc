import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Printer,
  Banknote,
  Ban,
  Truck,
} from 'lucide-react';
import api from '../api/client';
import { PageHeader, StatusBadge } from '../components/mes';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import { downloadSalesInvoicePdf, formatInr } from './downloadSalesInvoicePdf';

function tone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'ready';
  return 'pending';
}

export default function SalesInvoiceDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/sales-invoices/${id}`);
      setInvoice(data.sales_invoice);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load invoice');
      setInvoice(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDownload() {
    if (!invoice) return;
    setBusy(true);
    try {
      await downloadSalesInvoicePdf(invoice);
      setDownloaded(true);
    } catch (err) {
      await appAlert(err.message || 'PDF download failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPrinted() {
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/confirm-printed`);
      setInvoice(data.sales_invoice);
      await appAlert('Print confirmed. Lot can now be dispatched.');
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Could not confirm print');
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordPayment() {
    const txn = await appPrompt('Transaction / UTR / cheque reference', '');
    if (txn == null) return;
    if (!String(txn).trim()) {
      await appAlert('Transaction ID is required');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/payments`, {
        transaction_id: String(txn).trim(),
        amount: invoice.total_amount,
      });
      setInvoice(data.sales_invoice);
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    const ok = await appConfirm(
      'Cancel this invoice? The invoice number (if issued) is kept for GST compliance.'
    );
    if (!ok) return;
    const reason = await appPrompt('Cancel reason (optional)', '');
    if (reason === null) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/cancel`, {
        reason: reason || undefined,
      });
      setInvoice(data.sales_invoice);
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mes-shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="mes-shell">
        <p className="error-message">{error || 'Invoice not found'}</p>
        <button type="button" className="mes-btn mes-btn-secondary" onClick={() => navigate(-1)}>
          Back
        </button>
      </main>
    );
  }

  const company = invoice.company_snapshot || {};
  const customer = invoice.customer_snapshot || {};
  const lines = invoice.line_items || [];
  const canPay = invoice.status === 'due';
  const canCancel = invoice.status === 'due' || invoice.status === 'draft';
  const canConfirmPrint =
    ['due', 'paid'].includes(invoice.status) && !invoice.printed_at && downloaded;

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Sales invoice"
        title={invoice.invoice_number || 'Draft invoice'}
        subtitle={invoice.customer_name || customer.name || ''}
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/sales-invoices')}
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <StatusBadge status={tone(invoice.status)}>
              {String(invoice.status).toUpperCase()}
            </StatusBadge>
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className="mes-btn mes-btn-secondary"
          disabled={busy}
          onClick={handleDownload}
        >
          <Download size={15} />
          Download PDF
        </button>
        {['due', 'paid'].includes(invoice.status) && !invoice.printed_at ? (
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            disabled={busy || !downloaded}
            onClick={handleConfirmPrinted}
            title={!downloaded ? 'Download the PDF first' : undefined}
          >
            <Printer size={15} />
            Confirm printed
          </button>
        ) : null}
        {canPay ? (
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            disabled={busy}
            onClick={handleRecordPayment}
          >
            <Banknote size={15} />
            Record payment
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            disabled={busy}
            onClick={handleCancel}
          >
            <Ban size={15} />
            Cancel
          </button>
        ) : null}
        {invoice.printed_at && invoice.lot_id && !invoice.dispatched_at ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => navigate('/production/dispatch')}
          >
            <Truck size={15} />
            Go to dispatch
          </button>
        ) : null}
      </div>

      <section className="mes-card" style={{ padding: 20, marginBottom: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          <div>
            <p className="mes-eyebrow">Seller</p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {company.trade_name || company.legal_name}
            </p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              GSTIN {company.gstin || '—'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              State {company.state_code || '—'}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Bill to</p>
            <p style={{ margin: 0, fontWeight: 600 }}>{customer.name || '—'}</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              GSTIN {customer.gstin || '—'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              POS {invoice.place_of_supply_state_code || '—'}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Amounts</p>
            <p style={{ margin: 0 }}>Taxable ₹{formatInr(invoice.taxable_amount)}</p>
            {invoice.tax_type === 'IGST' ? (
              <p className="muted" style={{ margin: 0 }}>
                IGST ₹{formatInr(invoice.igst_amount)}
              </p>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  CGST ₹{formatInr(invoice.cgst_amount)}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  SGST ₹{formatInr(invoice.sgst_amount)}
                </p>
              </>
            )}
            <p style={{ margin: '6px 0 0', fontWeight: 700, fontSize: '1.1rem' }}>
              Total ₹{formatInr(invoice.total_amount)}
            </p>
          </div>
        </div>
      </section>

      <section className="mes-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Line items</h2>
        <div className="attendance-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td>{line.description}</td>
                  <td>
                    {line.quantity}
                    {line.uom ? ` ${line.uom}` : ''}
                  </td>
                  <td>₹{formatInr(line.unit_price)}</td>
                  <td>₹{formatInr(line.taxable_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mes-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Audit & payment</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <div>
            <p className="mes-eyebrow">Issued</p>
            <p style={{ margin: 0 }}>
              {invoice.issued_at ? formatDisplayDateTime(invoice.issued_at) : '—'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              by{' '}
              {invoice.issued_by_employee?.full_name ||
                invoice.issued_by_employee?.employee_code ||
                '—'}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Printed</p>
            <p style={{ margin: 0 }}>
              {invoice.printed_at ? formatDisplayDateTime(invoice.printed_at) : 'Not yet'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              by{' '}
              {invoice.printed_by_employee?.full_name ||
                invoice.printed_by_employee?.employee_code ||
                '—'}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Transaction ID</p>
            <p style={{ margin: 0 }}>{invoice.payment_transaction_id || '—'}</p>
          </div>
          <div>
            <p className="mes-eyebrow">Payment recorded by</p>
            <p style={{ margin: 0 }}>
              {invoice.payment_recorded_by_employee?.full_name ||
                invoice.payment_recorded_by_employee?.employee_code ||
                '—'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              {invoice.paid_at ? formatDisplayDateTime(invoice.paid_at) : ''}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Due date</p>
            <p style={{ margin: 0 }}>
              {invoice.due_date ? formatDisplayDate(invoice.due_date) : '—'}
            </p>
          </div>
          {invoice.cancel_reason ? (
            <div>
              <p className="mes-eyebrow">Cancel reason</p>
              <p style={{ margin: 0 }}>{invoice.cancel_reason}</p>
            </div>
          ) : null}
        </div>

        {invoice.payments?.length ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: '0.95rem' }}>Payment history</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {invoice.payments.map((p) => (
                <li key={p.id}>
                  ₹{formatInr(p.amount)} · {p.transaction_id} ·{' '}
                  {p.recorded_by_employee?.full_name || '—'} ·{' '}
                  {formatDisplayDateTime(p.paid_at)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
