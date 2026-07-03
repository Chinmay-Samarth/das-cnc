import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Download,
  BadgeCheck,
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
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const STATUS_STYLES = {
  paid:       { bg: '#f0fdf4', color: '#16a34a', label: 'PAID' },
  pending:    { bg: '#fff7ed', color: '#ea580c', label: 'PENDING APPROVAL' },
  overdue:    { bg: '#fef2f2', color: '#dc2626', label: 'OVERDUE' },
  extracting: { bg: '#eff6ff', color: '#2563eb', label: 'EXTRACTING' },
  saving:     { bg: '#eff6ff', color: '#2563eb', label: 'PROCESSING' },
  error:      { bg: '#fef2f2', color: '#dc2626', label: 'ERROR' },
};

const fmt = (val) => isNaN(Number(val)) || val == null
  ? '—'
  : Number(val).toLocaleString('en-IN');

const fmtMoney = (val) => isNaN(Number(val)) || val == null
  ? '—'
  : Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function taxAmount(tax, baseAmount) {
  if (tax.amount != null) return Number(tax.amount);
  const base = tax.base ?? baseAmount ?? 0;
  return Number(tax.rate) * Number(base);
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
        setLineItems(data.line_items ?? []);

        const supplierState = data.suppliers?.state ?? 'Karnataka';
        const isIntraState =
          supplierState === 'Karnataka'
          || supplierState.toLowerCase().includes('bangalore')
          || supplierState.toLowerCase().includes('bengaluru');

        setTaxLines(
          (data.tax_items ?? []).filter((t) =>
            isIntraState ? t.rate === 0.09 : t.rate === 0.18
          )
        );
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

  const status = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.pending;
  const supplier = invoice.suppliers ?? {};
  const totalGst = taxLines.reduce((sum, tax) => sum + taxAmount(tax, invoice.base_amount), 0);
  const gstRate = taxLines.length
    ? Math.round(taxLines.reduce((sum, t) => sum + t.rate, 0) * 100)
    : (invoice.gst_rate ?? 18);

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
      window.prompt('Copy this invoice link:', invoice.file_url);
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
      <button type="button" style={styles.backBtn} onClick={() => navigate('/invoices')}>
        <ArrowLeft size={14} />
        Back to invoices
      </button>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerTitleRow}>
            <h1 style={styles.invoiceTitle}>{invoice.invoice_number}</h1>
            {/* <span style={{ ...styles.statusBadge, background: status.bg, color: status.color }}>
              {status.label}
            </span> */}
          </div>
          <p style={styles.issueDate}>
            <Calendar size={14} />
            Issue Date: {invoice.invoice_date ?? '—'}
          </p>
        </div>

        <div style={styles.headerActions}>
          <a href={invoice.file_url} download style={styles.downloadBtn}>
            <Download size={15} />
            Download PDF
          </a>
          {/* <button type="button" style={styles.approveBtn}>
            <BadgeCheck size={15} />
            Approve Invoice
          </button> */}
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
            {/* {supplier.billing_address && (
              <p style={styles.vendorAddress}>
                <MapPin size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                {supplier.billing_address}
              </p>
            )} */}
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
                <div style={styles.taxRows}>
                  {taxLines.map((tax, i) => (
                    <div key={i} style={styles.summaryLine}>
                      <span style={styles.summaryLabel}>
                        {tax.rate === 0.09 ? (i === 0 ? 'CGST' : 'SGST') : 'IGST'} ({(tax.rate * 100).toFixed(0)}%)
                      </span>
                      <span style={styles.summaryValue}>₹{fmtMoney(taxAmount(tax, invoice.base_amount))}</span>
                    </div>
                  ))}
                </div>
                <div style={styles.dottedDivider} />
                <div style={styles.summaryLine}>
                  <span style={styles.totalGstLabel}>Total GST ({gstRate}%)</span>
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
                <span style={styles.summaryValue}>₹{fmtMoney(invoice.tax_amount ?? totalGst)}</span>
              </div>
              <div style={styles.solidDivider} />
              <span style={styles.grandTotalEyebrow}>Grand Total</span>
              <p style={styles.grandTotalAmount}>₹{fmtMoney(invoice.total_amount)}</p>
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
