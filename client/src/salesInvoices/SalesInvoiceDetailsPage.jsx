import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Printer,
  RefreshCw,
  Banknote,
  Ban,
  Truck,
  Package,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import api from '../api/client';
import { PageHeader, StatusBadge } from '../components/mes';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';
import InvoicePdfViewer from '../components/Invoices/InvoicePdfViewer';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import { printSalesInvoicePdf, regenerateSalesInvoicePdf, formatInr } from './downloadSalesInvoicePdf';
import {
  printPackingSlipPdf,
  downloadPackingSlipPdf,
} from './downloadPackingSlipPdf';
import { openSalesPaymentDialog } from './salesPaymentDialog';
import SalesInvoicePdfDocument from './SalesInvoicePdfDocument';

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
  const [packingDownloaded, setPackingDownloaded] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/sales-invoices/${id}`);
      setInvoice(data.sales_invoice);
      setTallyEnabled(Boolean(data.tally_enabled));
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

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!invoice) {
      setPdfFile(null);
      setPdfLoading(false);
      return undefined;
    }

    let cancelled = false;
    let blobUrl = null;
    setPdfLoading(true);

    async function resolvePdf() {
      try {
        if (invoice.file_url) {
          if (!cancelled) {
            setPdfFile(invoice.file_url);
            setDownloaded(true);
          }
          return;
        }
        const blob = await pdf(<SalesInvoicePdfDocument invoice={invoice} />).toBlob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setPdfFile(blobUrl);
      } catch (err) {
        console.error('Failed to preview sales invoice PDF', err);
        if (!cancelled) setPdfFile(null);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    }

    resolvePdf();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [invoice?.id, invoice?.file_url, invoice?.status, invoice?.invoice_number, invoice?.updated_at]);

  async function handlePrint() {
    if (!invoice) return;
    setBusy(true);
    try {
      const stored = await printSalesInvoicePdf(invoice);
      if (stored?.id) setInvoice(stored);
      setDownloaded(true);
    } catch (err) {
      await appAlert(err.message || 'Print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!invoice) return;
    setBusy(true);
    try {
      const stored = await regenerateSalesInvoicePdf(invoice);
      if (stored?.id) setInvoice(stored);
      setDownloaded(true);
      await appAlert('Invoice PDF regenerated.');
    } catch (err) {
      await appAlert(err.message || 'Could not regenerate invoice');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPrinted() {
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/confirm-printed`);
      setInvoice(data.sales_invoice);
      await appAlert('Invoice print confirmed. Print and confirm the packing slip next.');
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Could not confirm print');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrintPackingSlip() {
    if (!invoice) return;
    setBusy(true);
    try {
      await printPackingSlipPdf(invoice);
      setPackingDownloaded(true);
    } catch (err) {
      await appAlert(err.message || 'Packing slip print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadPackingSlip() {
    if (!invoice) return;
    setBusy(true);
    try {
      await downloadPackingSlipPdf(invoice);
      setPackingDownloaded(true);
    } catch (err) {
      await appAlert(err.message || 'Packing slip download failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPackingSlip() {
    setBusy(true);
    try {
      const { data } = await api.post(
        `/sales-invoices/${id}/confirm-packing-slip-printed`
      );
      setInvoice(data.sales_invoice);
      await appAlert('Packing slip confirmed. Lot can now be dispatched.');
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Could not confirm packing slip');
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordPayment() {
    setBusy(true);
    try {
      const data = await openSalesPaymentDialog({
        customerId: invoice.customer_id,
        customerName: invoice.customer_name || invoice.customer_snapshot?.name,
        ledgerName: invoice.customer?.ledger_name || invoice.customer_snapshot?.ledger_name,
        invoices: [invoice],
        tallyEnabled,
        mode: 'single',
      });
      if (!data) return;
      if (data.sales_invoice) setInvoice(data.sales_invoice);
      setTallyEnabled(Boolean(data.tally_enabled));
      const syncStatus = data.sales_invoice?.tally_receipt_sync_status;
      if (syncStatus === 'synced') {
        setActionMessage('Payment recorded · Receipt synced to Tally');
      } else if (syncStatus === 'failed') {
        setActionMessage(
          `Payment recorded · Receipt sync failed: ${
            data.sales_invoice?.tally_receipt_sync_error || 'unknown error'
          }`
        );
      } else {
        setActionMessage('Payment recorded');
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryTallySync() {
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/tally/sync`);
      setInvoice(data.sales_invoice);
      setTallyEnabled(Boolean(data.tally_enabled));
      const syncStatus = data.sales_invoice?.tally_sync_status;
      if (syncStatus === 'synced') {
        setActionMessage('Sales voucher synced to Tally');
      } else if (syncStatus === 'skipped') {
        await appAlert(
          data.sales_invoice?.tally_sync_error || 'Tally sync skipped'
        );
      } else {
        await appAlert(data.sales_invoice?.tally_sync_error || 'Tally sync failed');
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Unable to sync to Tally');
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryReceiptSync() {
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-invoices/${id}/tally/receipt-sync`);
      setInvoice(data.sales_invoice);
      setTallyEnabled(Boolean(data.tally_enabled));
      const syncStatus = data.sales_invoice?.tally_receipt_sync_status;
      if (syncStatus === 'synced') {
        setActionMessage('Receipt voucher synced to Tally');
      } else if (syncStatus === 'skipped') {
        await appAlert(
          data.sales_invoice?.tally_receipt_sync_error || 'Receipt sync skipped'
        );
      } else {
        await appAlert(
          data.sales_invoice?.tally_receipt_sync_error || 'Receipt sync failed'
        );
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Unable to sync Receipt to Tally');
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
  const canConfirmPacking =
    ['due', 'paid'].includes(invoice.status) &&
    !!invoice.printed_at &&
    !invoice.packing_slip_printed_at &&
    packingDownloaded;
  const canRetrySalesTally =
    tallyEnabled &&
    ['due', 'paid'].includes(invoice.status) &&
    invoice.tally_sync_status !== 'synced';
  const canRetryReceiptTally =
    tallyEnabled &&
    invoice.status === 'paid' &&
    invoice.tally_receipt_sync_status !== 'synced';

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Sales invoice"
        title={invoice.invoice_number || 'Draft invoice'}
        subtitle={invoice.customer_name || customer.name || ''}
        actions={
          <StatusBadge status={tone(invoice.status)}>
            {String(invoice.status).toUpperCase()}
          </StatusBadge>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}
      {actionMessage ? (
        <p className="muted" style={{ marginBottom: 12 }}>
          {actionMessage}
        </p>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className="mes-btn mes-btn-secondary"
          disabled={busy}
          onClick={handlePrint}
        >
          <Printer size={15} />
          Print invoice
        </button>
        <button
          type="button"
          className="mes-btn mes-btn-secondary"
          disabled={busy}
          onClick={handleRegenerate}
        >
          <RefreshCw size={15} />
          Regenerate invoice
        </button>
        {canConfirmPrint ? (
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            disabled={busy || !downloaded}
            onClick={handleConfirmPrinted}
            title={!downloaded ? 'Print the invoice first' : undefined}
          >
            <Printer size={15} />
            Confirm invoice printed
          </button>
        ) : null}
        {['due', 'paid'].includes(invoice.status) && invoice.printed_at ? (
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              disabled={busy}
              onClick={
                invoice.packing_slip_printed_at
                  ? handleDownloadPackingSlip
                  : handlePrintPackingSlip
              }
            >
              <Package size={15} />
              {invoice.packing_slip_printed_at
                ? 'Download packing slip'
                : 'Print packing slip'}
            </button>
            {canConfirmPacking ? (
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                disabled={busy}
                onClick={handleConfirmPackingSlip}
              >
                <Package size={15} />
                Confirm packing slip
              </button>
            ) : null}
          </>
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
        {canRetrySalesTally ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            disabled={busy}
            onClick={handleRetryTallySync}
          >
            <RefreshCw size={15} />
            Retry Sales Tally
          </button>
        ) : null}
        {canRetryReceiptTally ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            disabled={busy}
            onClick={handleRetryReceiptSync}
          >
            <RefreshCw size={15} />
            Retry Receipt Tally
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
        {invoice.printed_at &&
        invoice.packing_slip_printed_at &&
        invoice.lot_id &&
        !invoice.dispatched_at ? (
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

      <div className="sales-invoice-detail-layout">
      <div>
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
                  <td>
                    <div>{line.description}</div>
                    {line.drawing_number ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {line.drawing_number}
                      </div>
                    ) : null}
                    {line.package ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Package: {line.package}
                      </div>
                    ) : null}
                  </td>
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
            <p className="mes-eyebrow">Packing slip</p>
            <p style={{ margin: 0 }}>
              {invoice.packing_slip_printed_at
                ? formatDisplayDateTime(invoice.packing_slip_printed_at)
                : 'Not yet'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              by{' '}
              {invoice.packing_slip_printed_by_employee?.full_name ||
                invoice.packing_slip_printed_by_employee?.employee_code ||
                '—'}
            </p>
          </div>
          <div>
            <p className="mes-eyebrow">Transaction ID</p>
            <p style={{ margin: 0 }}>{invoice.payment_transaction_id || '—'}</p>
            <p className="muted" style={{ margin: 0 }}>
              Bank: {invoice.payment_bank_ledger || '—'}
            </p>
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
          <div>
            <p className="mes-eyebrow">Sales Tally</p>
            <p style={{ margin: 0 }}>
              {invoice.tally_sync_status
                ? String(invoice.tally_sync_status).toUpperCase()
                : tallyEnabled
                  ? 'Not synced yet'
                  : 'Disabled'}
              {invoice.tally_voucher_number
                ? ` · ${invoice.tally_voucher_number}`
                : ''}
            </p>
            {!tallyEnabled ? (
              <p className="muted" style={{ margin: 0, color: '#b45309' }}>
                Set TALLY_ENABLED=true to sync
              </p>
            ) : null}
            {invoice.tally_sync_error ? (
              <p className="muted" style={{ margin: 0, color: '#b91c1c' }}>
                {invoice.tally_sync_error}
              </p>
            ) : null}
          </div>
          <div>
            <p className="mes-eyebrow">Receipt Tally</p>
            <p style={{ margin: 0 }}>
              {invoice.tally_receipt_sync_status
                ? String(invoice.tally_receipt_sync_status).toUpperCase()
                : invoice.status === 'paid'
                  ? 'Not synced yet'
                  : '—'}
              {invoice.tally_receipt_voucher_number
                ? ` · ${invoice.tally_receipt_voucher_number}`
                : ''}
            </p>
            {invoice.tally_receipt_sync_error ? (
              <p className="muted" style={{ margin: 0, color: '#b91c1c' }}>
                {invoice.tally_receipt_sync_error}
              </p>
            ) : null}
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
      </div>

      <section className="mes-card sales-invoice-pdf-card">
        {/* <h2 className="sales-invoice-pdf-card-title">Invoice PDF</h2> */}
        <InvoicePdfViewer
          file={pdfFile}
          title={`Invoice ${invoice.invoice_number || 'draft'}`}
          loading={pdfLoading}
          emptyTitle="PDF not ready"
          emptyDescription="Generate the tax invoice to preview it here."
          emptyActionLabel={busy ? 'Printing…' : 'Print invoice'}
          onEmptyAction={busy ? undefined : handlePrint}
        />
      </section>
      </div>
    </main>
  );
}
