import { useEffect, useState,useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import api from "../../api/client"
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const STATUS_STYLES = {
  paid:    { bg: '#f0fdf4', color: '#16a34a', label: 'Paid' },
  pending: { bg: '#fffbeb', color: '#d97706', label: 'Pending' },
  overdue: { bg: '#fef2f2', color: '#dc2626', label: 'Overdue' },
};

const fmt = (val) => isNaN(Number(val)) || val == null
? '—'
: Number(val).toLocaleString('en-IN');


export default function InvoiceDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const {id} = useParams();
  const [fields, setFields] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale]         = useState(1.0);
  const [pdfWidth, setPdfWidth]   = useState(null);
  const [numPages, setNumPages]   = useState(null);
  const [invoice, setInvoice] = useState(null);

  const onDocLoad = useCallback(({ numPages }) => setNumPages(numPages), []);

  const pdfContainerRef = useCallback((node) => {
    if (node) setPdfWidth(node.getBoundingClientRect().width - 40);
  }, []);



  // const status = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.pending;

  useEffect(()=>{
    let mounted = true
    
    async function loadInvoice(){
      try{
        setLoading(true);
        setError(null);

        const invoiceRes = await api.get(`/invoices/${id}`)

        if (!mounted) return;


        const loadInvoice = await invoiceRes.data.invoice
        setInvoice(loadInvoice)

        console.log(loadInvoice)

        setFields([
          {label: 'Vendor Name', value: loadInvoice.supplier_name},
          {label: 'Invoice Number', value: loadInvoice.invoice_number},
          {label: 'Invoice Date', value: loadInvoice.invoice_date},
          {label: 'Due Date', value: loadInvoice.due_date},
          {label: 'Vendor GSTIN', value: loadInvoice.supplier_GSTIN},
          {label: 'Supplier Address', value: loadInvoice.supplier_address},
          {label: 'IRN', value: loadInvoice.IRN},
        ])

          
      }
      catch(err){
        console.error("Failed to load invoice details", err)
        if (!mounted) return;
        setError(err.response?.data?.error || "Unable to load invoice details")
      }
      finally{
        if (!mounted)return;
        setLoading(false)
      }
    }

    loadInvoice();
    return ()=>{
      mounted = false
    };
  },[id])

  if (loading) return <div style={styles.stateScreen}>Loading invoice…</div>;
  if (error)   return <div style={styles.stateScreen}>Error: {error}</div>;
  if (!invoice) return <div style={styles.stateScreen}>Invoice not found.</div>;

  return (
    <div className="" style={styles.pageWrapper}>
      {/* Back button */}
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={() => navigate('/invoices')}>
          ← Back to invoices
        </button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          {invoice.invoice_number} · {invoice.supplier_name}
        </span>
      </div>

      <div style={styles.root}>

        {/* ── Left sidebar ── */}
        <aside style={styles.sidebar}>

          {/* Header */}
          <div style={styles.sidebarHeader}>
            <div style={styles.sidebarHeaderTop}>
              <span style={styles.invoiceNo}>{invoice.invoice_number}</span>
              <span style={{ ...styles.badge, background: status.bg, color: status.color }}>
                {status.label}
              </span>
            </div>
            <p style={styles.sidebarSub}>
              {invoice.supplier_name} · {invoice.invoice_date}
            </p>
          </div>

          {/* Fields */}
          <div style={styles.fields}>
            {fields.map((f, i) =>
              f === null ? (
                <div key={i} style={styles.divider} />
              ) : (
                <div key={f.label} style={styles.field}>
                  <div style={styles.fieldLabel}>{f.label}</div>
                  <div style={{ ...styles.fieldValue, ...(f.mono ? styles.mono : {}) }}>
                    {f.value || '—'}
                  </div>
                </div>
              )
            )}
          </div>

          {/* Totals */}
          <div style={styles.totalsBlock}>
            {[
              ['Subtotal', invoice.base_amount],
              [`GST ${invoice.gst_rate ?? 18}%`, invoice.tax_amount],
            ].map(([label, val]) => (
              <div key={label} style={styles.totalRow}>
                <span>{label}</span>
                <span>₹{fmt(val)}</span>
              </div>
            ))}
            <div style={styles.totalMain}>
              <span>Total</span>
              <span>₹{fmt(invoice.total_amount)}</span>
            </div>
          </div>

          {/* Actions */}
          <div style={styles.sidebarFooter}>
            <a href={invoice.file_url} download style={styles.btn}>
              ↓ Download
            </a>
            <button style={{ ...styles.btn, ...styles.btnPrimary }}>
              ✓ Approve
            </button>
          </div>
        </aside>

        {/* ── Right: PDF ── */}
        <div style={styles.pdfPanel}>

          {/* Toolbar */}
          <div style={styles.toolbar}>
            <div style={styles.pageControls}>
              <button
                style={styles.iconBtn}
                onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                disabled={pageNumber <= 1}
                aria-label="Previous page"
              >‹</button>
              <span style={styles.pageLabel}>
                Page {pageNumber} of {numPages ?? '…'}
              </span>
              <button
                style={styles.iconBtn}
                onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
                disabled={pageNumber >= numPages}
                aria-label="Next page"
              >›</button>
            </div>

            <div style={styles.zoomControls}>
              <button style={styles.iconBtn} onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))}>−</button>
              <span style={styles.pageLabel}>{Math.round(scale * 100)}%</span>
              <button style={styles.iconBtn} onClick={() => setScale(s => Math.min(2.5, +(s + 0.25).toFixed(2)))}>+</button>
              <a href={invoice.file_url} target="_blank" rel="noreferrer" style={{ ...styles.iconBtn, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↗</a>
            </div>
          </div>

          {/* PDF render area */}
          <div ref={pdfContainerRef} style={styles.pdfArea}>
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
        </div>
      </div>
  </div>
  );
}

const styles = {
  // ── page wrapper ──
  pageWrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#f3f4f6',
  },

  // ── top bar (back button lives here) ──
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    flexShrink: 0,
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    fontSize: 13,
    color: '#374151',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: 'transparent',
    cursor: 'pointer',
  },

  // ── split layout ──
  root: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    flex: 1,             // fills remaining height after topBar
    overflow: 'hidden',  // clips children, no page scroll
  },

  // ── sidebar ──
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #e5e7eb',
    overflow: 'hidden',
    background: '#fff',
  },
  sidebarHeader: {
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
    flexShrink: 0,
  },
  sidebarHeaderTop: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  invoiceNo: { fontSize: 13, fontWeight: 600, color: '#111827' },
  badge: { fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99 },
  sidebarSub: { margin: 0, fontSize: 12, color: '#6b7280' },

  fields: {
    flex: 1,
    overflowY: 'auto',   // only this scrolls
    padding: '8px 0',
    minHeight: 0,        // ← key: allows flex child to shrink below content height
  },
  field: { padding: '7px 16px' },
  fieldLabel: {
    fontSize: 11, color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2,
  },
  fieldValue: { fontSize: 13, color: '#111827', fontWeight: 500 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  divider: { height: 1, background: '#f3f4f6', margin: '6px 16px' },

  // totals — flexShrink: 0 so they never get pushed off screen
  totalsBlock: {
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    background: '#f9fafb',
    flexShrink: 0,
  },
  totalRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 12, color: '#6b7280', marginBottom: 3,
  },
  totalMain: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 14, fontWeight: 600, color: '#111827',
    marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb',
  },

  sidebarFooter: {
    padding: '10px 16px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex', gap: 8,
    flexShrink: 0,
  },
  btn: {
    flex: 1, padding: '7px 0', fontSize: 12,
    borderRadius: 6, border: '1px solid #d1d5db',
    background: 'transparent', color: '#374151',
    cursor: 'pointer', textAlign: 'center', textDecoration: 'none',
  },
  btnPrimary: { background: '#1d4ed8', borderColor: 'transparent', color: '#fff' },

  // ── PDF panel ──
  pdfPanel: {
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden', background: '#f3f4f6',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px', borderBottom: '1px solid #e5e7eb',
    background: '#fff', flexShrink: 0,
  },
  pageControls: { display: 'flex', alignItems: 'center', gap: 8 },
  zoomControls:  { display: 'flex', alignItems: 'center', gap: 6 },
  pageLabel: { fontSize: 12, color: '#6b7280', minWidth: 80, textAlign: 'center' },
  iconBtn: {
    width: 28, height: 28,
    border: '1px solid #e5e7eb', borderRadius: 5,
    background: '#fff', cursor: 'pointer',
    fontSize: 14, color: '#374151',
    display: 'flex', alignItems: 'center', justifyContent: 'center', // ← fix alignment
    padding: 0,
  },
  pdfArea: {
    flex: 1, overflowY: 'auto',
    display: 'flex', justifyContent: 'center',
    padding: 20, minHeight: 0,  // ← allows shrink
  },
  stateScreen: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '80vh', fontSize: 14, color: '#6b7280',
  },
};
