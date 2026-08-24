import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import api from '../api/client';
import InvoicePdfViewer from '../components/Invoices/InvoicePdfViewer';
import { AlertBanner, PageHeader, StatusBadge } from '../components/mes';
import { appAlert } from '../components/dialog';
import { getCategoryConfig } from '../girn/girnCategoryConfig';
import InvoiceRecheckLineTable from './InvoiceRecheckLineTable';
import SupplierSelect from './SupplierSelect';
import { InvoiceUploadInlineStatus } from './InvoiceUploadQueueStatus';
import {
  isInvoiceUploadBusy,
  useInvoiceUploadQueue,
} from './InvoiceUploadQueueContext';

function recalcLine(line) {
  const qty = Number(line.quantity);
  const rate = Number(line.unit_price);
  const total = Number.isFinite(qty) && Number.isFinite(rate) ? qty * rate : Number(line.total) || 0;
  return { ...line, total };
}

function isProcessingStatus(status) {
  return status === 'extracting' || status === 'saving' || status === 'queued' || status === 'uploading';
}

export default function InvoiceOcrReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const context = searchParams.get('context') || '';
  const returnTo = searchParams.get('return') || '';
  const { getJobByInvoiceId, dismissJob } = useInvoiceUploadQueue();
  const queueJob = getJobByInvoiceId(id);
  const handledCompleteRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [review, setReview] = useState(null);
  const [lines, setLines] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [header, setHeader] = useState({
    invoice_number: '',
    invoice_date: '',
    due_date: '',
    total_amount: '',
  });

  const processing = Boolean(
    (queueJob && isInvoiceUploadBusy(queueJob.status)) ||
      isProcessingStatus(invoice?.status)
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const detail = await api.get(`/invoices/${id}`);
      const invStatus = detail.data?.invoice?.status;
      if (isProcessingStatus(invStatus)) {
        setInvoice(detail.data.invoice);
        setReview(null);
        setLines([]);
        return;
      }

      if (invStatus === 'error') {
        setInvoice(detail.data.invoice);
        setError('OCR processing failed for this invoice.');
        return;
      }

      const { data } = await api.get(`/invoices/${id}/review`);
      const inv = data.invoice;
      setInvoice(inv);
      setReview(data.review);
      setLines((data.lines || inv.line_items || []).map(recalcLine));
      setSupplierId(inv.supplier_id || '');
      setSupplierLabel(inv.suppliers?.name || '');
      setHeader({
        invoice_number: inv.invoice_number || '',
        invoice_date: inv.invoice_date || '',
        due_date: inv.due_date || '',
        total_amount: inv.total_amount ?? '',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load invoice review.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    handledCompleteRef.current = false;
    load();
  }, [load]);

  // Poll while OCR is still running (covers refresh / deep-link without queue job)
  useEffect(() => {
    if (!processing) return undefined;
    const timer = setInterval(() => {
      load();
    }, 2500);
    return () => clearInterval(timer);
  }, [processing, load]);

  // When queue job finishes while user is on this page
  useEffect(() => {
    if (!queueJob || handledCompleteRef.current) return;
    if (isInvoiceUploadBusy(queueJob.status)) return;

    handledCompleteRef.current = true;

    if (queueJob.status === 'error') {
      setError(queueJob.error || 'OCR processing failed.');
      setLoading(false);
      return;
    }

    if (queueJob.status === 'done') {
      const inv = queueJob.result?.invoice;
      dismissJob(queueJob.id);
      if (context === 'girn') {
        const params = new URLSearchParams(returnTo ? returnTo.split('?')[1] || '' : '');
        params.set('invoice_id', id);
        params.set('reviewed', '1');
        navigate(`/girn/create?${params.toString()}`, {
          state: { invoice: inv, draft_girn: null },
        });
        return;
      }
      navigate('/invoices');
      return;
    }

    if (queueJob.status === 'needs_review') {
      load();
    }
  }, [queueJob, context, returnTo, id, navigate, dismissJob, load]);

  // Auto-accepted invoice opened on review URL (no active queue job)
  useEffect(() => {
    if (processing || loading || !invoice) return;
    if (queueJob && isInvoiceUploadBusy(queueJob.status)) return;
    if (invoice.review_status === 'auto_accepted' && invoice.status === 'pending' && context === 'girn') {
      const params = new URLSearchParams(returnTo ? returnTo.split('?')[1] || '' : '');
      params.set('invoice_id', id);
      params.set('reviewed', '1');
      navigate(`/girn/create?${params.toString()}`, {
        state: { invoice, draft_girn: null },
      });
    }
  }, [invoice, processing, loading, context, returnTo, id, navigate, queueJob]);

  const warnings = useMemo(
    () => (Array.isArray(review?.ocr_warnings) ? review.ocr_warnings : []),
    [review]
  );

  function handleLineChange(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = recalcLine({ ...next[idx], [field]: value });
      return next;
    });
  }

  function handleCategoryChange(idx, category) {
    const cfg = getCategoryConfig(category);
    setLines((prev) => {
      const next = [...prev];
      next[idx] = recalcLine({
        ...next[idx],
        item_category: category,
        master_record_id: null,
        master_record_label: '',
        master_slug: cfg.masterSlug,
      });
      return next;
    });
  }

  function handleMasterSelect(idx, mapped) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = recalcLine({
        ...next[idx],
        master_record_id: mapped.master_record_id,
        master_record_label: mapped.master_record_label,
        master_slug: mapped.master_slug || next[idx].master_slug,
        item_code: mapped.item_code || next[idx].item_code,
      });
      return next;
    });
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        supplier_id: supplierId,
        invoice_number: header.invoice_number,
        invoice_date: header.invoice_date,
        due_date: header.due_date,
        total_amount: header.total_amount,
        lines: lines.map((line) => ({
          ...line,
          scanned_description: line.scanned_description || line.description || '',
        })),
        include_girn_draft: context === 'girn',
      };

      const { data } = await api.post(`/invoices/${id}/confirm-review`, payload);
      if (queueJob) dismissJob(queueJob.id);

      if (context === 'girn') {
        const params = new URLSearchParams(returnTo ? returnTo.split('?')[1] || '' : searchParams.toString());
        params.set('invoice_id', id);
        params.set('reviewed', '1');
        navigate(`/girn/create?${params.toString()}`, {
          state: { invoice: data.invoice, draft_girn: data.draft_girn },
        });
        return;
      }

      await appAlert({
        title: 'Invoice confirmed',
        message: 'OCR review saved. Invoice is ready for payment tracking.',
        tone: 'success',
      });
      navigate('/invoices');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to confirm review.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    if (context === 'girn') {
      navigate(returnTo || '/girn/create');
      return;
    }
    navigate('/invoices');
  }

  if (loading && !invoice && !processing) {
    return <p className="muted mes-shell">Loading review…</p>;
  }

  if (processing) {
    return (
      <main className="mes-shell invoice-recheck-page">
        <PageHeader
          eyebrow="Accounts payable"
          title="Processing scanned invoice"
          subtitle="OCR is running in the background. You can leave this page and come back from the status bar."
          actions={
            <button type="button" className="mes-btn mes-btn-secondary" onClick={handleCancel}>
              <ArrowLeft size={16} />
              Back
            </button>
          }
        />

        <InvoiceUploadInlineStatus invoiceId={id} />

        <div className="invoice-recheck-layout">
          <section className="mes-card invoice-recheck-pdf">
            <h2 className="invoice-recheck-section-title">Invoice PDF</h2>
            <InvoicePdfViewer
              file={invoice?.file_url || queueJob?.previewUrl}
              title={invoice?.invoice_number || queueJob?.fileName || 'Scanned invoice'}
              loading={!invoice?.file_url && !queueJob?.previewUrl}
              emptyTitle="Uploading PDF…"
              emptyDescription="The file will appear here once upload finishes."
            />
          </section>

          <section className="mes-card invoice-recheck-form">
            <h2 className="invoice-recheck-section-title">Extraction in progress</h2>
            <p className="muted">
              Supplier, totals, and line items will appear here when OCR finishes. If review is required,
              you can correct them on this same screen.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="mes-shell invoice-recheck-page">
      <PageHeader
        eyebrow="Accounts payable"
        title="Recheck scanned invoice"
        subtitle="Verify OCR against the PDF, link supplier and master records, then confirm."
        actions={
          <button type="button" className="mes-btn mes-btn-secondary" onClick={handleCancel}>
            <ArrowLeft size={16} />
            Back
          </button>
        }
      />

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      <div className="invoice-recheck-meta">
        <StatusBadge status="pending">
          OCR {Math.round((review?.ocr_confidence_level || 0) * 100)}%
        </StatusBadge>
        {warnings.length ? (
          <span className="muted">{warnings.length} warning{warnings.length === 1 ? '' : 's'} require review</span>
        ) : (
          <span className="muted">Manual recheck required before posting</span>
        )}
      </div>

      {warnings.length ? (
        <AlertBanner tone="danger">
          <ul className="invoice-recheck-warnings">
            {warnings.map((w, idx) => (
              <li key={`${w.code}-${idx}`}>{w.message}</li>
            ))}
          </ul>
        </AlertBanner>
      ) : null}

      <div className="invoice-recheck-layout">
        <section className="mes-card invoice-recheck-pdf">
          <h2 className="invoice-recheck-section-title">Invoice PDF</h2>
          <InvoicePdfViewer
            file={invoice?.file_url}
            title={invoice?.invoice_number || 'Scanned invoice'}
            loading={false}
            emptyTitle="PDF unavailable"
            emptyDescription="The uploaded file could not be previewed."
          />
        </section>

        <section className="mes-card invoice-recheck-form">
          <h2 className="invoice-recheck-section-title">Extracted details</h2>

          <div className="invoice-recheck-grid">
            <label>
              Supplier <span className="req">*</span>
              <SupplierSelect
                value={supplierId}
                label={supplierLabel}
                onChange={({ id: sid, label }) => {
                  setSupplierId(sid);
                  setSupplierLabel(label);
                }}
              />
            </label>

            <label>
              Invoice number
              <input
                value={header.invoice_number}
                onChange={(e) => setHeader((h) => ({ ...h, invoice_number: e.target.value }))}
              />
            </label>

            <label>
              Invoice date
              <input
                type="date"
                className="date-bar"
                value={header.invoice_date || ''}
                onChange={(e) => setHeader((h) => ({ ...h, invoice_date: e.target.value }))}
              />
            </label>

            <label>
              Due date
              <input
                type="date"
                className="date-bar"
                value={header.due_date || ''}
                onChange={(e) => setHeader((h) => ({ ...h, due_date: e.target.value }))}
              />
            </label>

            <label>
              Total amount
              <input
                type="number"
                min="0"
                step="any"
                value={header.total_amount}
                onChange={(e) => setHeader((h) => ({ ...h, total_amount: e.target.value }))}
              />
            </label>
          </div>

          <h3 className="invoice-recheck-subtitle">Line items</h3>
          <InvoiceRecheckLineTable
            lines={lines}
            onChange={handleLineChange}
            onMasterSelect={handleMasterSelect}
            onCategoryChange={handleCategoryChange}
          />

          <div className="invoice-recheck-actions">
            <button type="button" className="cancel-button" disabled={submitting} onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" className="primary-button" disabled={submitting || !supplierId} onClick={handleConfirm}>
              <Check size={16} />
              {submitting ? 'Confirming…' : context === 'girn' ? 'Confirm & continue GIRN' : 'Confirm invoice'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
