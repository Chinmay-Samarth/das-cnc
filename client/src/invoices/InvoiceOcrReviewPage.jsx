import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, IndianRupee, Percent, Receipt } from 'lucide-react';
import api from '../api/client';
import InvoicePdfViewer from '../components/Invoices/InvoicePdfViewer';
import {
  AlertBanner,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '../components/mes';
import { appAlert } from '../components/dialog';
import { getCategoryConfig } from '../girn/girnCategoryConfig';
import InvoiceRecheckLineTable from './InvoiceRecheckLineTable';
import InvoiceRecheckTaxTable, { normalizeTaxRows, recalcTax } from './InvoiceRecheckTaxTable';
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

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function sumTaxAmount(taxRows) {
  return round2(taxRows.reduce((sum, t) => sum + (Number(t.amount) || 0), 0));
}

/** Grand total always follows base + tax + round_off. */
function computeHeaderTotal(baseAmount, taxAmount, roundOff) {
  const base = Number(baseAmount);
  const tax = Number(taxAmount);
  const round = Number(roundOff);
  if (!Number.isFinite(base) || !Number.isFinite(tax)) return '';
  return round2(base + tax + (Number.isFinite(round) ? round : 0));
}

function isProcessingStatus(status) {
  return status === 'extracting' || status === 'saving' || status === 'queued' || status === 'uploading';
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [taxes, setTaxes] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [header, setHeader] = useState({
    invoice_number: '',
    invoice_date: '',
    due_date: '',
    total_amount: '',
    base_amount: '',
    round_off: '',
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
        setTaxes([]);
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
      const nextTaxes = normalizeTaxRows(inv.tax_items, inv.base_amount);
      setTaxes(nextTaxes);
      setSupplierId(inv.supplier_id || '');
      setSupplierLabel(inv.suppliers?.name || '');
      const baseAmount = inv.base_amount ?? '';
      const roundOff = inv.round_off ?? '';
      const taxAmount = sumTaxAmount(nextTaxes);
      // After tax recalc, derive grand total from parts so OCR ₹1 misreads don't stick.
      const derivedTotal = computeHeaderTotal(baseAmount, taxAmount, roundOff);
      setHeader({
        invoice_number: inv.invoice_number || '',
        invoice_date: inv.invoice_date || '',
        due_date: inv.due_date || '',
        total_amount: derivedTotal !== '' ? derivedTotal : inv.total_amount ?? '',
        base_amount: baseAmount,
        round_off: roundOff,
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

  const taxTotal = useMemo(() => sumTaxAmount(taxes), [taxes]);
  const lineCount = lines.length;
  const ocrPct = Math.round((review?.ocr_confidence_level || 0) * 100);

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

  function handleRemoveLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function syncHeaderTotal(nextHeader, nextTaxes = taxes) {
    const taxAmount = sumTaxAmount(nextTaxes);
    const total = computeHeaderTotal(nextHeader.base_amount, taxAmount, nextHeader.round_off);
    if (total === '') return nextHeader;
    return { ...nextHeader, total_amount: total };
  }

  function handleHeaderField(field, value) {
    setHeader((h) => {
      const next = { ...h, [field]: value };
      if (field === 'base_amount' || field === 'round_off') {
        return syncHeaderTotal(next);
      }
      return next;
    });
  }

  function handleTaxChange(idx, field, value) {
    setTaxes((prev) => {
      const next = [...prev];
      const updated = { ...next[idx], [field]: value };
      // Recalc amount from base × rate when base/rate change; keep manual amount edits
      if (field === 'base' || field === 'rate') {
        next[idx] = recalcTax(updated);
      } else if (field === 'kind') {
        next[idx] = { ...updated, kind: String(value || 'CGST').toUpperCase() };
      } else {
        next[idx] = updated;
      }
      setHeader((h) => syncHeaderTotal(h, next));
      return next;
    });
  }

  function handleRemoveTax(idx) {
    setTaxes((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setHeader((h) => syncHeaderTotal(h, next));
      return next;
    });
  }

  function handleAddTax() {
    const base = Number(header.base_amount);
    setTaxes((prev) => {
      const next = [
        ...prev,
        recalcTax({
          kind: prev.some((t) => t.kind === 'CGST') ? 'SGST' : 'CGST',
          rate: 9,
          base: Number.isFinite(base) ? base : '',
          amount: '',
        }),
      ];
      setHeader((h) => syncHeaderTotal(h, next));
      return next;
    });
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError('');
    try {
      const normalizedTaxes = taxes
        .map((t) => ({
          kind: String(t.kind || '').toUpperCase(),
          rate: Number(t.rate),
          base: t.base === '' || t.base == null ? null : Number(t.base),
          amount: t.amount === '' || t.amount == null ? null : Number(t.amount),
        }))
        .filter((t) => t.kind && (Number.isFinite(t.amount) || Number.isFinite(t.rate)));

      const taxAmount = normalizedTaxes.reduce(
        (sum, t) => sum + (Number.isFinite(t.amount) ? t.amount : 0),
        0
      );
      const roundOff = header.round_off === '' || header.round_off == null ? 0 : Number(header.round_off);
      const baseAmount = header.base_amount === '' || header.base_amount == null ? null : Number(header.base_amount);
      const reconciledTotal =
        baseAmount != null && Number.isFinite(baseAmount)
          ? computeHeaderTotal(baseAmount, taxAmount, roundOff)
          : header.total_amount;

      const payload = {
        supplier_id: supplierId,
        invoice_number: header.invoice_number,
        invoice_date: header.invoice_date,
        due_date: header.due_date,
        total_amount: reconciledTotal,
        base_amount: header.base_amount,
        round_off: roundOff,
        tax_amount: taxAmount,
        tax_items: normalizedTaxes,
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
        />

        <InvoiceUploadInlineStatus invoiceId={id} />

        <div className="invoice-recheck-layout">
          <section className="mes-card invoice-recheck-pdf">
            <header className="invoice-recheck-panel-head">
              <h2 className="invoice-recheck-panel-title">Source PDF</h2>
            </header>
            <InvoicePdfViewer
              file={invoice?.file_url || queueJob?.previewUrl}
              title={invoice?.invoice_number || queueJob?.fileName || 'Scanned invoice'}
              loading={!invoice?.file_url && !queueJob?.previewUrl}
              emptyTitle="Uploading PDF…"
              emptyDescription="The file will appear here once upload finishes."
            />
          </section>

          <section className="mes-card invoice-recheck-form">
            <header className="invoice-recheck-panel-head">
              <h2 className="invoice-recheck-panel-title">Extraction in progress</h2>
              <p className="invoice-recheck-panel-hint">
                Supplier, totals, and line items will appear here when OCR finishes.
              </p>
            </header>
          </section>
        </div>
      </main>
    );
  }

  const confirmLabel = submitting
    ? 'Confirming…'
    : context === 'girn'
      ? 'Confirm & continue GIRN'
      : 'Confirm invoice';

  return (
    <main className="mes-shell invoice-recheck-page">
      <PageHeader
        eyebrow="Accounts payable"
        title="Recheck scanned invoice"
        subtitle="Match the PDF, fix supplier and lines, then confirm."
        actions={
          <StatusBadge status="pending">OCR {ocrPct}%</StatusBadge>
        }
      />

      {error ? <AlertBanner tone="danger" title="Could not save">{error}</AlertBanner> : null}

      {warnings.length ? (
        <AlertBanner
          tone="amber"
          title={`${warnings.length} OCR warning${warnings.length === 1 ? '' : 's'}`}
        >
          <ul className="invoice-recheck-warnings">
            {warnings.map((w, idx) => (
              <li key={`${w.code}-${idx}`}>{w.message}</li>
            ))}
          </ul>
        </AlertBanner>
      ) : null}

      <div className="invoice-recheck-layout">
        <section className="mes-card invoice-recheck-pdf">
          <header className="invoice-recheck-panel-head">
            <h2 className="invoice-recheck-panel-title">Source PDF</h2>
            <p className="invoice-recheck-panel-hint">Use this as the source of truth while reviewing.</p>
          </header>
          <InvoicePdfViewer
            file={invoice?.file_url}
            title={invoice?.invoice_number || 'Scanned invoice'}
            loading={false}
            emptyTitle="PDF unavailable"
            emptyDescription="The uploaded file could not be previewed."
          />
        </section>

        <section className="mes-card invoice-recheck-form">
          <div className="mes-metric-grid invoice-recheck-totals">
            <MetricCard
              label="Taxable"
              value={`₹${formatMoney(header.base_amount)}`}
              icon={IndianRupee}
              tone="neutral"
            />
            <MetricCard
              label="Tax"
              value={`₹${formatMoney(taxTotal)}`}
              hint={taxes.length ? `${taxes.length} line${taxes.length === 1 ? '' : 's'}` : 'No tax lines'}
              icon={Percent}
              tone="info"
            />
            <MetricCard
              label="Round off"
              value={`₹${formatMoney(header.round_off)}`}
              tone="amber"
            />
            <MetricCard
              label="Grand total"
              value={`₹${formatMoney(header.total_amount)}`}
              hint={`${lineCount} line item${lineCount === 1 ? '' : 's'}`}
              icon={Receipt}
              tone="success"
            />
          </div>

          <div className="invoice-recheck-section">
            <h3 className="form-page-section-title">Invoice</h3>
            <div className="form-page-grid invoice-recheck-fields">
              <label className="form-span-2">
                Supplier <span className="required-mark">*</span>
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
                  onChange={(e) => handleHeaderField('invoice_number', e.target.value)}
                  placeholder="As printed on the invoice"
                />
              </label>

              <label>
                Invoice date
                <input
                  type="date"
                  className="date-bar"
                  value={header.invoice_date || ''}
                  onChange={(e) => handleHeaderField('invoice_date', e.target.value)}
                />
              </label>

              <label>
                Due date
                <input
                  type="date"
                  className="date-bar"
                  value={header.due_date || ''}
                  onChange={(e) => handleHeaderField('due_date', e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="invoice-recheck-section">
            <h3 className="form-page-section-title">Amounts</h3>
            <p className="invoice-recheck-section-lead muted">
              Grand total is taxable + tax + round off. Adjust taxable or round off if the PDF differs.
            </p>
            <div className="form-page-grid invoice-recheck-fields">
              <label>
                Taxable / base amount
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={header.base_amount}
                  onChange={(e) => handleHeaderField('base_amount', e.target.value)}
                />
              </label>

              <label>
                Round off
                <input
                  type="number"
                  step="any"
                  value={header.round_off}
                  onChange={(e) => handleHeaderField('round_off', e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="invoice-recheck-section">
            <div className="invoice-recheck-section-head">
              <h3 className="form-page-section-title">Line items</h3>
              <span className="muted invoice-recheck-count">{lineCount}</span>
            </div>
            <InvoiceRecheckLineTable
              lines={lines}
              onChange={handleLineChange}
              onMasterSelect={handleMasterSelect}
              onCategoryChange={handleCategoryChange}
              onRemove={handleRemoveLine}
            />
          </div>

          <div className="invoice-recheck-section">
            <div className="invoice-recheck-section-head">
              <h3 className="form-page-section-title">Tax</h3>
              <span className="muted invoice-recheck-count">{taxes.length}</span>
            </div>
            <InvoiceRecheckTaxTable
              taxes={taxes}
              onChange={handleTaxChange}
              onRemove={handleRemoveTax}
              onAdd={handleAddTax}
            />
          </div>

          <div className="form-page-actions invoice-recheck-actions">
            <button type="button" className="cancel-button" disabled={submitting} onClick={handleCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={submitting || !supplierId}
              onClick={handleConfirm}
            >
              <Check size={16} />
              {confirmLabel}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
