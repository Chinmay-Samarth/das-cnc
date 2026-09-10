import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Calendar,
  MapPin,
  Download,
  BadgeCheck,
  Banknote,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Printer,
  Share2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import api from "../../api/client";
import { appAlert, appPrompt, appForm } from "../../components/dialog";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { formatDisplayDate, toISODateString } from '../../utils/dateFormat';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const STATUS_STYLES = {
  paid:       { bg: '#f0fdf4', color: '#16a34a', label: 'PAID' },
  due:        { bg: '#fff7ed', color: '#ea580c', label: 'DUE' },
  pending:    { bg: '#fff7ed', color: '#ea580c', label: 'DUE' },
  overdue:    { bg: '#fef2f2', color: '#dc2626', label: 'OVERDUE' },
  extracting: { bg: '#eff6ff', color: '#2563eb', label: 'EXTRACTING' },
  saving:     { bg: '#eff6ff', color: '#2563eb', label: 'PROCESSING' },
  error:      { bg: '#fef2f2', color: '#dc2626', label: 'ERROR' },
};

function todayYmdIst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function invoiceDisplayStatus(invoice) {
  const raw = invoice?.status || 'pending';
  if (raw === 'paid') return 'paid';
  if (raw === 'extracting' || raw === 'saving' || raw === 'error') return raw;
  const due = invoice?.due_date ? String(invoice.due_date).slice(0, 10) : '';
  if (due && due < todayYmdIst()) return 'overdue';
  return 'due';
}

const fmt = (val) => isNaN(Number(val)) || val == null
  ? '—'
  : Number(val).toLocaleString('en-IN');

const fmtMoney = (val) => isNaN(Number(val)) || val == null
  ? '—'
  : Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** InvoiceOCR uses percent (9/18); Mindee used fractions (0.09/0.18). */
function taxRatePercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function taxRateFraction(rate) {
  const pct = taxRatePercent(rate);
  return pct == null ? null : pct / 100;
}

function taxLineAmount(tax, baseAmount) {
  const amount = Number(tax?.amount);
  if (Number.isFinite(amount) && amount !== 0) return amount;
  const base = Number(tax?.base ?? baseAmount ?? 0);
  const fraction = taxRateFraction(tax?.rate);
  if (Number.isFinite(base) && fraction != null) return base * fraction;
  return 0;
}

/** Prefer base + tax + round_off when stored total is out of sync (OCR ₹1 gaps). */
function reconcileGrandTotal(invoice, taxFallback = 0) {
  const base = Number(invoice?.base_amount);
  const taxRaw = invoice?.tax_amount != null ? Number(invoice.tax_amount) : Number(taxFallback);
  const roundOff = Number(invoice?.round_off) || 0;
  const stored = Number(invoice?.total_amount);
  if (!Number.isFinite(base) || !Number.isFinite(taxRaw)) {
    return Number.isFinite(stored) ? stored : 0;
  }
  const computed = Math.round((base + taxRaw + roundOff) * 100) / 100;
  if (!Number.isFinite(stored) || Math.abs(stored - computed) >= 0.005) return computed;
  return stored;
}

function taxKindFromRate(rate) {
  const pct = taxRatePercent(rate);
  if (pct == null) return 'GST';
  if (Math.abs(pct - 9) < 0.6) return 'CGST/SGST';
  if (Math.abs(pct - 18) < 0.6) return 'IGST';
  return 'GST';
}

function taxKindBadge(kind) {
  const k = String(kind || '').toUpperCase();
  if (k === 'CGST') return { label: 'CGST', bg: '#e0f2fe', color: '#0369a1' };
  if (k === 'SGST' || k === 'UTGST') return { label: k, bg: '#fef3c7', color: '#b45309' };
  if (k === 'IGST') return { label: 'IGST', bg: '#ede9fe', color: '#6d28d9' };
  return { label: k || 'GST', bg: '#f3f4f6', color: '#4b5563' };
}

function resolveTaxKind(tax, index, siblingCount) {
  const kind = String(tax?.kind || '').toUpperCase();
  if (kind === 'CGST' || kind === 'SGST' || kind === 'IGST' || kind === 'UTGST') return kind;

  const inferred = taxKindFromRate(tax?.rate);
  if (inferred === 'CGST/SGST') {
    return siblingCount >= 2 ? (index === 0 ? 'CGST' : 'SGST') : 'CGST/SGST';
  }
  if (inferred === 'IGST') return 'IGST';
  return 'GST';
}

function taxRateDisplay(tax) {
  const pct = taxRatePercent(tax?.rate);
  if (pct == null) return '—';
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function taxLabel(tax, index, siblingCount) {
  const kind = resolveTaxKind(tax, index, siblingCount);
  const pctLabel = taxRateDisplay(tax);
  if (pctLabel === '—') return kind;
  return `${kind} (${pctLabel})`;
}

function synthesizeTaxItems(invoice) {
  const taxAmountValue = Number(invoice?.tax_amount);
  const base = Number(invoice?.base_amount);
  if (!Number.isFinite(taxAmountValue) || taxAmountValue <= 0) return [];

  const supplierState = String(invoice?.suppliers?.state || '').toLowerCase();
  const isIntraState =
    supplierState.includes('karnataka') ||
    supplierState.includes('bangalore') ||
    supplierState.includes('bengaluru') ||
    !supplierState;

  if (isIntraState) {
    const half = Math.round((taxAmountValue / 2) * 100) / 100;
    return [
      { kind: 'CGST', rate: 9, base, amount: half },
      { kind: 'SGST', rate: 9, base, amount: Math.round((taxAmountValue - half) * 100) / 100 },
    ];
  }

  return [{ kind: 'IGST', rate: 18, base, amount: taxAmountValue }];
}

export default function InvoiceDetails() {
  const navigate = useNavigate();
  const { id } = useParams();
  const pdfPanelRef = useRef(null);
  const pdfScrollRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfWidth, setPdfWidth] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [taxLines, setTaxLines] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [paying, setPaying] = useState(false);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [syncingTally, setSyncingTally] = useState(false);

  const onDocLoad = useCallback(({ numPages }) => setNumPages(numPages), []);

  const pdfContainerRef = useCallback((node) => {
    pdfScrollRef.current = node;
    if (node) setPdfWidth(node.getBoundingClientRect().width - 48);
  }, []);

  const startDrag = useCallback((clientX, clientY) => {
    dragRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    setIsDragging(true);
  }, []);

  const moveDrag = useCallback((clientX, clientY) => {
    if (!dragRef.current.active) return;
    setPan({
      x: dragRef.current.panX + (clientX - dragRef.current.startX),
      y: dragRef.current.panY + (clientY - dragRef.current.startY),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [scale, pageNumber]);

  useEffect(() => {
    let mounted = true;

    async function loadInvoice() {
      try {
        setLoading(true);
        setError(null);

        const invoiceRes = await api.get(`/invoices/${id}`);
        if (!mounted) return;

        const data = invoiceRes.data.invoice;
        setInvoice(data);
        setTallyEnabled(Boolean(invoiceRes.data.tally_enabled));
        setLineItems(data.line_items ?? []);

        const storedTaxes = Array.isArray(data.tax_items) ? data.tax_items : [];
        const usableTaxes = storedTaxes.filter((t) => {
          const amount = taxLineAmount(t, data.base_amount);
          const pct = taxRatePercent(t?.rate);
          return amount > 0 || (pct != null && pct > 0);
        });
        setTaxLines(usableTaxes.length ? usableTaxes : synthesizeTaxItems(data));
      } catch (err) {
        console.error("Failed to load invoice details", err);
        if (!mounted) return;
        setError(err.response?.data?.error || "Unable to load invoice details");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadInvoice();
    return () => { mounted = false; };
  }, [id]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === pdfPanelRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!isDragging) return undefined;

    const onMouseMove = (e) => moveDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, moveDrag, endDrag]);

  if (loading) return <div style={styles.stateScreen}>Loading invoice…</div>;
  if (error) return <div style={styles.stateScreen}>Error: {error}</div>;
  if (!invoice) return <div style={styles.stateScreen}>Invoice not found.</div>;

  const statusKey = invoiceDisplayStatus(invoice);
  const status = STATUS_STYLES[statusKey] ?? STATUS_STYLES.due;
  const supplier = invoice.suppliers ?? {};
  const canPay = statusKey === 'due' || statusKey === 'overdue';
  const totalGst = taxLines.reduce((sum, tax) => sum + taxLineAmount(tax, invoice.base_amount), 0);
  const taxAmountDisplay = Number(invoice.tax_amount ?? totalGst) || 0;
  const roundOffDisplay = Number(invoice.round_off) || 0;
  const grandTotal = reconcileGrandTotal(invoice, totalGst);
  const combinedGstRate = (() => {
    const percents = taxLines.map((t) => taxRatePercent(t.rate)).filter((n) => n != null);
    if (!percents.length) return invoice.gst_rate ?? 18;
    const looksSplit = percents.length >= 2 && percents.every((p) => Math.abs(p - 9) < 0.6);
    return looksSplit ? Math.round(percents.reduce((a, b) => a + b, 0)) : Math.round(percents[0]);
  })();

  const printPdf = (url) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
    iframe.src = url;
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) document.body.removeChild(iframe);
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(invoice.file_url, '_blank');
          setActionMessage('Opened PDF in a new tab — use Ctrl+P to print');
        }
        setTimeout(cleanup, 1000);
      }, 300);
    };

    iframe.onerror = () => {
      cleanup();
      window.open(invoice.file_url, '_blank');
      setActionMessage('Opened PDF in a new tab — use Ctrl+P to print');
    };
  };

  const handleRetryTallySync = async (kind = 'payment') => {
    setSyncingTally(true);
    try {
      const { data } = await api.post(`/invoices/${id}/tally/sync`, { kind });
      setInvoice(data.invoice);
      setTallyEnabled(Boolean(data.tally_enabled));
      const statusKey =
        kind === 'purchase'
          ? data.invoice?.tally_sync_status
          : data.invoice?.tally_payment_sync_status;
      const errKey =
        kind === 'purchase'
          ? data.invoice?.tally_sync_error
          : data.invoice?.tally_payment_sync_error;
      if (statusKey === 'synced') {
        setActionMessage(
          kind === 'purchase' ? 'Purchase voucher synced to Tally' : 'Payment voucher synced to Tally'
        );
      } else if (statusKey === 'skipped') {
        await appAlert(errKey || 'Tally sync skipped');
      } else {
        await appAlert(errKey || 'Tally sync failed');
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Unable to sync to Tally');
    } finally {
      setSyncingTally(false);
    }
  };

  const handleRecordPayment = async () => {
    const currentSupplier = invoice?.suppliers ?? {};
    if (tallyEnabled) {
      const ledgerName = String(currentSupplier.ledger_name || '').trim();
      if (!ledgerName) {
        await appAlert(
          'Set ledger name on the supplier before recording payment (Tally sync is enabled).'
        );
        return;
      }
    }

    const advance = Number(invoice?.po_advance_amount) || 0;
    const total = reconcileGrandTotal(invoice);
    const remaining = Math.max(Math.round((total - advance) * 100) / 100, 0);

    let bankOptions = [];
    if (tallyEnabled) {
      try {
        const { data } = await api.get('/invoices/tally/bank-ledgers');
        bankOptions = data.bank_ledgers || [];
        if (!bankOptions.length) {
          await appAlert(
            data.error ||
              'No bank ledgers found in Tally. Ensure Bank Accounts exist and Tally is running.'
          );
          return;
        }
      } catch (err) {
        await appAlert(err.response?.data?.error || 'Unable to load bank ledgers from Tally');
        return;
      }
    }

    const fields = [
      {
        name: 'paid_at',
        label: 'Payment date',
        type: 'date',
        required: true,
        defaultValue: toISODateString(new Date()),
      },
      {
        name: 'reference',
        label: 'Reference (UTR / cheque)',
        type: 'text',
        required: true,
        placeholder: 'Transaction reference',
      },
    ];
    if (tallyEnabled) {
      fields.push({
        name: 'bank_ledger',
        label: 'Bank ledger',
        type: 'select',
        required: true,
        options: bankOptions,
        placeholder: 'Select bank…',
      });
    }

    const values = await appForm({
      title: 'Record payment',
      message: `Amount due after advance: ₹${remaining.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
      })}${advance > 0 ? ` (advance ₹${advance.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` : ''}`,
      confirmLabel: 'Record payment',
      fields,
    });
    if (values == null) return;

    setPaying(true);
    try {
      const { data } = await api.post(`/invoices/${id}/payments`, {
        paid_at: String(values.paid_at).trim(),
        transaction_id: String(values.reference).trim(),
        bank_ledger: values.bank_ledger ? String(values.bank_ledger).trim() : undefined,
      });
      setInvoice(data.invoice);
      setLineItems(data.invoice?.line_items ?? []);
      setTallyEnabled(Boolean(data.tally_enabled));
      const syncStatus = data.invoice?.tally_payment_sync_status;
      if (syncStatus === 'synced') {
        setActionMessage('Payment recorded · Payment voucher synced to Tally');
      } else if (syncStatus === 'failed') {
        setActionMessage(
          `Payment recorded · Tally payment sync failed: ${data.invoice?.tally_payment_sync_error || 'unknown error'}`
        );
      } else if (syncStatus === 'skipped' && remaining <= 0) {
        setActionMessage('Payment recorded · fully covered by advance');
      } else {
        setActionMessage('Payment recorded');
      }
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Unable to record payment');
    } finally {
      setPaying(false);
    }
  };

  const handlePrint = async () => {
    try {
      const response = await fetch(invoice.file_url);
      console.log(response)
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      printPdf(URL.createObjectURL(blob));
    } catch {
      printPdf(invoice.file_url);
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: `Invoice ${invoice.invoice_number}`,
      text: `Invoice ${invoice.invoice_number}`,
      url: invoice.file_url,
    };

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard.writeText(invoice.file_url);
      setActionMessage('Link copied to clipboard');
    } catch {
      await appPrompt({
        title: 'Copy invoice link',
        message: 'Select and copy the link below.',
        defaultValue: invoice.file_url,
        readOnly: true,
        confirmLabel: 'Close',
      });
    }
  };

  const handleFullscreen = async () => {
    const panel = pdfPanelRef.current;
    if (!panel) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen failed', err);
      setActionMessage('Fullscreen is not supported in this browser');
    }
  };

  return (
    <div style={styles.pageWrapper}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerTitleRow}>
            <h1 style={styles.invoiceTitle}>{invoice.invoice_number}</h1>
            <span style={{ ...styles.statusBadge, background: status.bg, color: status.color }}>
              {status.label}
            </span>
          </div>
          <p style={styles.issueDate}>
            <Calendar size={14} />
            Issue Date: {formatDisplayDate(invoice.invoice_date)}
          </p>
        </div>

        <div style={styles.headerActions}>
          {canPay ? (
            <button
              type="button"
              style={styles.approveBtn}
              disabled={paying}
              onClick={handleRecordPayment}
            >
              <Banknote size={15} />
              {paying ? 'Recording…' : 'Record payment'}
            </button>
          ) : null}
          {invoice.status === 'paid' &&
          tallyEnabled &&
          invoice.tally_payment_sync_status !== 'synced' ? (
            <button
              type="button"
              style={styles.downloadBtn}
              disabled={syncingTally}
              onClick={() => handleRetryTallySync('payment')}
            >
              {syncingTally ? 'Syncing…' : 'Retry Payment sync'}
            </button>
          ) : null}
          {tallyEnabled && invoice.tally_sync_status !== 'synced' ? (
            <button
              type="button"
              style={styles.downloadBtn}
              disabled={syncingTally}
              onClick={() => handleRetryTallySync('purchase')}
            >
              {syncingTally ? 'Syncing…' : 'Retry Purchase sync'}
            </button>
          ) : null}
          <a href={invoice.file_url} download style={styles.downloadBtn}>
            <Download size={15} />
            Download PDF
          </a>
        </div>
      </header>

      {/* Main content */}
      <div style={styles.content}>
        {/* Left column */}
        <div style={styles.leftColumn}>
          {/* Vendor card */}
          <section style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <span style={styles.cardEyebrow}>Vendor Details</span>
              <div style={styles.gstinRow}>
                <span style={styles.gstinLabel}>GSTIN</span>
                <span style={styles.gstinValue}>{supplier.GSTIN || '—'}</span>
              </div>
            </div>
            <h2 style={styles.vendorName}>{supplier.name || invoice.supplier_name || '—'}</h2>
            {supplier.id && (
              <button
                type="button"
                style={styles.viewDetailsLink}
                onClick={() => navigate(`/suppliers/${supplier.id}`)}
              >
                View Details &gt;
              </button>
            )}
          </section>

          <section style={styles.card}>
            <span style={styles.sectionTitle}>Payment</span>
            <div style={styles.taxRows}>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Supplier type</span>
                <span style={styles.summaryValue}>
                  {supplier.tally_expense_ledger_type === 'labour'
                    ? 'Labour'
                    : supplier.tally_expense_ledger_type === 'labour_service'
                      ? 'Labour Service'
                      : supplier.tally_expense_ledger_type === 'consumable'
                        ? 'Consumable'
                        : supplier.tally_expense_ledger_type === 'raw_material'
                          ? 'Raw Material'
                          : supplier.tally_expense_ledger_type === 'spares_and_tools'
                            ? 'Spares and Tools'
                            : supplier.tally_expense_ledger_type || '—'}
                </span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Due date</span>
                <span style={styles.summaryValue}>{formatDisplayDate(invoice.due_date)}</span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Credit period</span>
                <span style={styles.summaryValue}>
                  {invoice.credit_period_days != null ? `${invoice.credit_period_days} days` : '—'}
                </span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Pay date</span>
                <span style={styles.summaryValue}>{formatDisplayDate(invoice.paid_at)}</span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>REF</span>
                <span style={styles.summaryValue}>{invoice.payment_reference || '—'}</span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>PO advance</span>
                <span style={styles.summaryValue}>
                  {Number(invoice.po_advance_amount) > 0
                    ? `₹${fmtMoney(invoice.po_advance_amount)}`
                    : '—'}
                </span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Amount due</span>
                <span style={styles.summaryValue}>
                  ₹
                  {fmtMoney(
                    invoice.amount_due_after_advance != null
                      ? invoice.amount_due_after_advance
                      : Math.max(
                          grandTotal - (Number(invoice.po_advance_amount) || 0),
                          0
                        )
                  )}
                </span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Bank ledger</span>
                <span style={styles.summaryValue}>{invoice.payment_bank_ledger || '—'}</span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Purchase Tally</span>
                <span style={styles.summaryValue}>
                  {invoice.tally_sync_status
                    ? String(invoice.tally_sync_status).toUpperCase()
                    : tallyEnabled
                      ? 'Not synced'
                      : 'Disabled'}
                  {invoice.tally_voucher_number ? ` · ${invoice.tally_voucher_number}` : ''}
                </span>
              </div>
              {invoice.tally_sync_error ? (
                <div style={styles.summaryLine}>
                  <span style={styles.summaryLabel}>Purchase error</span>
                  <span style={{ ...styles.summaryValue, color: '#b91c1c' }}>
                    {invoice.tally_sync_error}
                  </span>
                </div>
              ) : null}
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Payment Tally</span>
                <span style={styles.summaryValue}>
                  {invoice.tally_payment_sync_status
                    ? String(invoice.tally_payment_sync_status).toUpperCase()
                    : invoice.status === 'paid'
                      ? tallyEnabled
                        ? 'Not synced'
                        : 'Disabled'
                      : '—'}
                  {invoice.tally_payment_voucher_number
                    ? ` · ${invoice.tally_payment_voucher_number}`
                    : ''}
                </span>
              </div>
              {invoice.tally_payment_sync_error ? (
                <div style={styles.summaryLine}>
                  <span style={styles.summaryLabel}>Payment error</span>
                  <span style={{ ...styles.summaryValue, color: '#b91c1c' }}>
                    {invoice.tally_payment_sync_error}
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          {/* Line items card */}
          {lineItems.length > 0 && (
            <section style={styles.card}>
              <span style={styles.sectionTitle}>Line Items</span>
              <table style={styles.table}>
                <thead style={styles.thead}>
                  <tr>
                    {['Description', 'Qty', 'Rate (₹)', 'Total (₹)'].map((h) => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{item.description ?? '—'}</td>
                      <td style={{ ...styles.td, ...styles.tdNum }}>{fmt(item.quantity)}</td>
                      <td style={{ ...styles.td, ...styles.tdNum }}>{fmtMoney(item.unit_price)}</td>
                      <td style={{ ...styles.td, ...styles.tdNum, fontWeight: 600 }}>
                        {fmtMoney(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Tax + Grand total */}
          <div style={styles.summaryRow}>
            {taxLines.length > 0 && (
              <section style={styles.card}>
                <span style={styles.sectionTitle}>Tax Breakdown</span>
                <table style={styles.table}>
                  <thead style={styles.thead}>
                    <tr>
                      {['Kind', 'Rate', 'Amount (₹)'].map((h) => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {taxLines.map((tax, i) => {
                      const kind = resolveTaxKind(tax, i, taxLines.length);
                      const badge = taxKindBadge(kind);
                      return (
                        <tr key={i}>
                          <td style={styles.td}>
                            <span
                              style={{
                                ...styles.taxKindBadge,
                                background: badge.bg,
                                color: badge.color,
                              }}
                              title={taxLabel(tax, i, taxLines.length)}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td style={{ ...styles.td, ...styles.tdNum }}>{taxRateDisplay(tax)}</td>
                          <td style={{ ...styles.td, ...styles.tdNum, fontWeight: 600 }}>
                            {fmtMoney(taxLineAmount(tax, invoice.base_amount))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={styles.dottedDivider} />
                <div style={styles.summaryLine}>
                  <span style={styles.totalGstLabel}>Total GST ({combinedGstRate}%)</span>
                  <span style={styles.totalGstValue}>₹{fmtMoney(totalGst || invoice.tax_amount)}</span>
                </div>
              </section>
            )}

            <section style={styles.grandTotalCard}>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Subtotal</span>
                <span style={styles.summaryValue}>₹{fmtMoney(invoice.base_amount)}</span>
              </div>
              <div style={styles.summaryLine}>
                <span style={styles.summaryLabel}>Total Taxes</span>
                <span style={styles.summaryValue}>₹{fmtMoney(taxAmountDisplay)}</span>
              </div>
              {roundOffDisplay !== 0 && (
                <div style={styles.summaryLine}>
                  <span style={styles.summaryLabel}>Round Off</span>
                  <span style={styles.summaryValue}>
                    {roundOffDisplay > 0 ? '+' : ''}
                    ₹{fmtMoney(roundOffDisplay)}
                  </span>
                </div>
              )}
              <div style={styles.solidDivider} />
              <span style={styles.grandTotalEyebrow}>Grand Total</span>
              <p style={styles.grandTotalAmount}>₹{fmtMoney(grandTotal)}</p>
            </section>
          </div>
        </div>

        {/* Right column — PDF viewer */}
        <div ref={pdfPanelRef} style={styles.pdfPanel}>
          <div style={styles.toolbar}>
            <div style={styles.zoomControls}>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}
                aria-label="Zoom out"
              >
                <ZoomOut size={15} />
              </button>
              <span style={styles.zoomLabel}>{Math.round(scale * 100)}%</span>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => setScale((s) => Math.min(2.5, +(s + 0.25).toFixed(2)))}
                aria-label="Zoom in"
              >
                <ZoomIn size={15} />
              </button>
            </div>

            <div style={styles.pageControls}>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                disabled={pageNumber <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <span style={styles.pageLabel}>
                Page {pageNumber} of {numPages ?? '…'}
              </span>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                disabled={pageNumber >= numPages}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div
            ref={pdfContainerRef}
            style={{
              ...styles.pdfArea,
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (e.target.closest('button')) return;
              e.preventDefault();
              startDrag(e.clientX, e.clientY);
            }}
            onTouchStart={(e) => {
              if (e.target.closest('button')) return;
              const touch = e.touches[0];
              if (!touch) return;
              startDrag(touch.clientX, touch.clientY);
            }}
            onTouchMove={(e) => {
              const touch = e.touches[0];
              if (!touch) return;
              e.preventDefault();
              moveDrag(touch.clientX, touch.clientY);
            }}
            onTouchEnd={endDrag}
            onTouchCancel={endDrag}
          >
            <div
              style={{
                ...styles.pdfCanvas,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            >
              <Document
                file={invoice.file_url}
                onLoadSuccess={onDocLoad}
                loading={<div style={styles.pdfPlaceholder}>Loading…</div>}
                error={<div style={styles.pdfPlaceholder}>Failed to load PDF.</div>}
              >
                {pdfWidth && (
                  <Page
                    pageNumber={pageNumber}
                    width={pdfWidth * scale}
                    renderTextLayer
                    renderAnnotationLayer
                  />
                )}
              </Document>
            </div>

            {actionMessage && (
              <div style={styles.actionToast} role="status">{actionMessage}</div>
            )}

            <div style={styles.floatingToolbar}>
              <button type="button" style={styles.floatingBtn} onClick={handlePrint} aria-label="Print">
                <Printer size={16} />
              </button>
              <button type="button" style={styles.floatingBtn} onClick={handleShare} aria-label="Share">
                <Share2 size={16} />
              </button>
              <button
                type="button"
                style={styles.floatingBtn}
                onClick={handleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  pageWrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 49px)',
    overflow: 'hidden',
    background: '#f3f4f6',
    padding: '16px 24px',
    gap: 16,
  },

  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
    fontSize: 13,
    color: '#6b7280',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: 'fit-content',
  },

  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    flexShrink: 0,
    flexWrap: 'wrap',
  },

  headerLeft: {
    display: 'grid',
    gap: 6,
  },

  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },

  invoiceTitle: {
    margin: 0,
    fontSize: 26,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },

  statusBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 6,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  issueDate: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: 0,
    fontSize: 13,
    color: '#6b7280',
  },

  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },

  downloadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    cursor: 'pointer',
    textDecoration: 'none',
  },

  approveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: '#1d4ed8',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },

  content: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
    gap: 20,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    overflowY: 'auto',
    minHeight: 0,
    paddingRight: 4,
  },

  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'grid',
    gap: 10,
  },

  cardHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },

  cardEyebrow: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  gstinRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  gstinLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },

  gstinValue: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1d4ed8',
    fontFamily: 'monospace',
  },

  vendorName: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: '#0f172a',
  },

  viewDetailsLink: {
    padding: 0,
    fontSize: 13,
    fontWeight: 600,
    color: '#1d4ed8',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    width: 'fit-content',
  },

  vendorAddress: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 1.5,
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: 4,
  },

  thead: {
    background: '#eef2f7',
  },

  th: {
    padding: '10px 8px',
    textAlign: 'left',
    color: '#374151',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid #d1d5db',
  },

  td: {
    padding: '10px 0',
    color: '#374151',
    fontSize: 13,
    borderBottom: '1px solid #f9fafb',
    verticalAlign: 'top',
  },

  tdNum: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },

  taxKindBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },

  summaryRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },

  taxRows: {
    display: 'grid',
    gap: 8,
  },

  summaryLine: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    fontSize: 13,
  },

  summaryLabel: {
    color: '#6b7280',
  },

  summaryValue: {
    color: '#111827',
    fontVariantNumeric: 'tabular-nums',
  },

  expenseSelect: {
    minWidth: 160,
    maxWidth: '60%',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 13,
    color: '#111827',
    background: '#fff',
  },

  dottedDivider: {
    borderTop: '1px dashed #e5e7eb',
    margin: '4px 0',
  },

  solidDivider: {
    borderTop: '1px solid #bfdbfe',
    margin: '8px 0',
  },

  totalGstLabel: {
    fontWeight: 600,
    color: '#111827',
    fontSize: 13,
  },

  totalGstValue: {
    fontWeight: 700,
    color: '#1d4ed8',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },

  grandTotalCard: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'grid',
    gap: 8,
    alignContent: 'start',
  },

  grandTotalEyebrow: {
    fontSize: 11,
    fontWeight: 700,
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },

  grandTotalAmount: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
    color: '#1d4ed8',
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },

  pdfPanel: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#e8edf5',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    minHeight: 0,
  },

  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    flexShrink: 0,
    borderRadius: '10px 10px 0 0',
  },

  zoomControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  pageControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  zoomLabel: {
    fontSize: 12,
    color: '#6b7280',
    minWidth: 44,
    textAlign: 'center',
    fontWeight: 500,
  },

  pageLabel: {
    fontSize: 12,
    color: '#6b7280',
    minWidth: 90,
    textAlign: 'center',
  },

  iconBtn: {
    width: 30,
    height: 30,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },

  pdfArea: {
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
    position: 'relative',
    userSelect: 'none',
  },

  pdfCanvas: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
    padding: 24,
    boxSizing: 'border-box',
    willChange: 'transform',
  },

  pdfPlaceholder: {
    padding: 40,
    color: '#6b7280',
    fontSize: 14,
  },

  floatingToolbar: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 8px',
    background: '#374151',
    borderRadius: 999,
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  },

  floatingBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 999,
    color: '#fff',
    cursor: 'pointer',
    padding: 0,
  },

  actionToast: {
    position: 'absolute',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 14px',
    background: '#1f2937',
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    whiteSpace: 'nowrap',
    zIndex: 2,
  },

  stateScreen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '80vh',
    fontSize: 14,
    color: '#6b7280',
  },
};
