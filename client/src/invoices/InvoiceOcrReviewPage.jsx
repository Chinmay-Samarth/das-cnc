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

function addDaysYmd(isoDate, days) {
  const raw = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseCreditDays(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function dueDateFromCredit(invoiceDate, creditDays) {
  const days = parseCreditDays(creditDays);
  if (days == null) return null;
  return addDaysYmd(invoiceDate, days);
}

export default function InvoiceOcrReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const context = searchParams.get('context') || '';
  const returnTo = searchParams.get('return') || '';
  const editMode = searchParams.get('mode') === 'edit';
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
  const [supplierCreditDays, setSupplierCreditDays] = useState(null);
  const [suggestedSupplier, setSuggestedSupplier] = useState(null);
  const [supplierLedger, setSupplierLedger] = useState(null);
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
      const suggested = data.suggested_supplier || null;
      setSuggestedSupplier(suggested);
      setSupplierLedger(data.supplier_ledger || null);
      setSupplierId(inv.supplier_id || '');
      setSupplierLabel(
        inv.suppliers?.name ||
          suggested?.name ||
          ''
      );
      const creditDays = parseCreditDays(inv.suppliers?.credit_period_days);
      setSupplierCreditDays(creditDays);
      const invoiceDate = inv.invoice_date || '';
      const autoDue = dueDateFromCredit(invoiceDate, creditDays);
      const baseAmount = inv.base_amount ?? '';
      const roundOff = inv.round_off ?? '';
      const taxAmount = sumTaxAmount(nextTaxes);
      // After tax recalc, derive grand total from parts so OCR ₹1 misreads don't stick.
      const derivedTotal = computeHeaderTotal(baseAmount, taxAmount, roundOff);
      setHeader({
        invoice_number: inv.invoice_number || '',
        invoice_date: invoiceDate,
        due_date: autoDue || inv.due_date || '',
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

  const lineItemsTotal = useMemo(() => {
    return round2(
      lines.reduce((sum, line) => {
        const text = String(
          line.scanned_description || line.description || line.item_description || ''
        ).trim();
        const qty = line.quantity === '' || line.quantity == null ? null : Number(line.quantity);
        const rate = line.unit_price === '' || line.unit_price == null ? null : Number(line.unit_price);
        if (!(text || line.master_record_id || qty != null || rate != null)) return sum;
        const total = Number(line.total);
        return sum + (Number.isFinite(total) ? total : 0);
      }, 0)
    );
  }, [lines]);

  const expectedGrandTotal = useMemo(() => {
    return computeHeaderTotal(header.base_amount, taxTotal, header.round_off);
  }, [header.base_amount, header.round_off, taxTotal]);

  const linesMatchSubtotal = useMemo(() => {
    const subtotal = Number(header.base_amount);
    if (!Number.isFinite(subtotal)) return false;
    return Math.abs(lineItemsTotal - round2(subtotal)) < 0.005;
  }, [header.base_amount, lineItemsTotal]);

  const totalsBalanced = useMemo(() => {
    if (expectedGrandTotal === '') return false;
    const grand = Number(header.total_amount);
    if (!Number.isFinite(grand)) return false;
    return Math.abs(grand - Number(expectedGrandTotal)) < 0.005;
  }, [expectedGrandTotal, header.total_amount]);

  function getSaveBlockers() {
    const blockers = [];
    if (!String(header.invoice_number || '').trim()) {
      blockers.push('Invoice number is required.');
    }
    if (!String(header.due_date || '').trim()) {
      blockers.push('Due date not given.');
    }
    if (!supplierId) {
      blockers.push('Supplier is required.');
    }
    if (!linesMatchSubtotal) {
      blockers.push(
        `Line items total (₹${formatMoney(lineItemsTotal)}) must equal taxable / subtotal (₹${formatMoney(
          header.base_amount
        )}).`
      );
    }
    if (!totalsBalanced) {
      blockers.push(
        `Taxable + tax + round off (₹${formatMoney(expectedGrandTotal)}) must equal grand total (₹${formatMoney(
          header.total_amount
        )}).`
      );
    }
    return blockers;
  }

  function handleLineChange(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      const patch = { [field]: value };
      if (field === 'scanned_description') patch.description = value;
      if (field === 'item_description' && !String(next[idx].scanned_description || '').trim()) {
        patch.description = value;
        patch.scanned_description = value;
      }
      next[idx] = recalcLine({ ...next[idx], ...patch });
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

  function handleAddLine() {
    setLines((prev) => [
      ...prev,
      recalcLine({
        manual: true,
        scanned_description: '',
        item_description: '',
        item_category: 'raw_material',
        master_record_id: null,
        master_record_label: '',
        quantity: '',
        unit_price: '',
        total: 0,
      }),
    ]);
  }

  function syncHeaderTotal(nextHeader, nextTaxes = taxes) {
    const taxAmount = sumTaxAmount(nextTaxes);
    const total = computeHeaderTotal(nextHeader.base_amount, taxAmount, nextHeader.round_off);
    if (total === '') return nextHeader;
    return { ...nextHeader, total_amount: total };
  }

  function handleHeaderField(field, value) {
    // Changing taxable base should update every tax line base + amount (rate × base).
    if (field === 'base_amount') {
      setTaxes((prev) => {
        const nextTaxes = prev.map((t) => recalcTax({ ...t, base: value }));
        setHeader((h) => syncHeaderTotal({ ...h, base_amount: value }, nextTaxes));
        return nextTaxes;
      });
      return;
    }

    setHeader((h) => {
      const next = { ...h, [field]: value };
      // Supplier credit period drives due date from invoice date.
      if (field === 'invoice_date' && supplierCreditDays != null) {
        const autoDue = dueDateFromCredit(value, supplierCreditDays);
        if (autoDue) next.due_date = autoDue;
      }
      // Keep grand total in sync when parts change; allow manual grand total edits.
      if (field === 'round_off') {
        return syncHeaderTotal(next);
      }
      return next;
    });
  }

  function handleSupplierChange({ id: sid, label, credit_period_days }) {
    setSupplierId(sid);
    setSupplierLabel(label);
    const days = parseCreditDays(credit_period_days);
    setSupplierCreditDays(days);
    if (days == null) return;
    setHeader((h) => {
      const autoDue = dueDateFromCredit(h.invoice_date, days);
      if (!autoDue) return h;
      return { ...h, due_date: autoDue };
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
    const blockers = getSaveBlockers();
    const invoiceNumber = String(header.invoice_number || '').trim();

    if (supplierId && invoiceNumber) {
      try {
        const { data } = await api.get('/invoices/check-duplicate', {
          params: {
            supplier_id: supplierId,
            invoice_number: invoiceNumber,
            exclude_id: id,
          },
        });
        if (data?.duplicate) {
          blockers.push(
            data.error ||
              `Invoice number "${invoiceNumber}" already exists for this supplier.`
          );
        }
      } catch (err) {
        blockers.push(
          err.response?.data?.error || 'Unable to verify invoice number uniqueness.'
        );
      }
    }

    if (blockers.length) {
      await appAlert({
        title: 'Cannot save invoice',
        message: blockers.map((reason, index) => `${index + 1}. ${reason}`).join('\n'),
        tone: 'danger',
        confirmLabel: 'OK',
      });
      return;
    }

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
        invoice_number: String(header.invoice_number).trim(),
        invoice_date: header.invoice_date || null,
        due_date: header.due_date || null,
        total_amount: reconciledTotal,
        base_amount: header.base_amount,
        round_off: roundOff,
        tax_amount: taxAmount,
        tax_items: normalizedTaxes,
        lines: lines
          .filter((line) => {
            const text = String(line.scanned_description || line.description || line.item_description || '').trim();
            const qty = line.quantity === '' || line.quantity == null ? null : Number(line.quantity);
            const rate = line.unit_price === '' || line.unit_price == null ? null : Number(line.unit_price);
            return Boolean(text || line.master_record_id || qty != null || rate != null);
          })
          .map((line) => ({
            ...line,
            scanned_description: line.scanned_description || line.description || line.item_description || '',
          })),
      };

      const { data } = await api.post(`/invoices/${id}/confirm-review`, payload);
      if (queueJob) dismissJob(queueJob.id);

      // Admin re-edit of an already saved invoice → back to details.
      const alreadySaved =
        editMode ||
        (invoice?.review_status === 'confirmed' || invoice?.review_status === 'auto_accepted');
      if (alreadySaved) {
        navigate(`/invoices/${id}`, { replace: true });
        return;
      }

      // First confirm: AP invoices are due for GIRN Register & review next.
      const params = new URLSearchParams(
        returnTo ? returnTo.split('?')[1] || '' : searchParams.toString()
      );
      params.set('invoice_id', id);
      params.set('reviewed', '1');
      navigate(`/girn/create?${params.toString()}`, {
        state: { invoice: data.invoice, draft_girn: data.draft_girn },
      });
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.error || 'Unable to confirm review.';
      await appAlert({
        title: status === 409 ? 'Cannot save invoice' : 'Could not save',
        message,
        tone: 'danger',
        confirmLabel: 'OK',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    const editingSaved =
      editMode ||
      invoice?.review_status === 'confirmed' ||
      invoice?.review_status === 'auto_accepted';

    // Don't discard a saved invoice when cancelling an admin edit.
    if (editingSaved) {
      navigate(`/invoices/${id}`);
      return;
    }

    try {
      await api.post(`/invoices/${id}/abandon-review`);
      if (queueJob) dismissJob(queueJob.id);
    } catch (err) {
      // Still leave the page; draft may already be gone or not abandonable
      console.warn('Abandon OCR draft failed:', err.response?.data?.error || err.message);
    }
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
              <h2 className="invoice-recheck-panel-title">Source file</h2>
            </header>
            <InvoicePdfViewer
              file={invoice?.file_url || queueJob?.previewUrl}
              fileName={queueJob?.fileName || ''}
              title={invoice?.invoice_number || queueJob?.fileName || 'Scanned invoice'}
              loading={!invoice?.file_url && !queueJob?.previewUrl}
              emptyTitle="Uploading…"
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

  const isSavedEdit =
    editMode ||
    invoice?.review_status === 'confirmed' ||
    invoice?.review_status === 'auto_accepted';

  const confirmLabel = submitting
    ? isSavedEdit
      ? 'Saving…'
      : 'Confirming…'
    : isSavedEdit
      ? 'Save changes'
      : context === 'girn'
        ? 'Confirm & continue GIRN'
        : 'Confirm invoice';

  return (
    <main className="mes-shell invoice-recheck-page">
      <PageHeader
        eyebrow="Accounts payable"
        title={isSavedEdit ? 'Edit invoice' : 'Recheck scanned invoice'}
        subtitle={
          isSavedEdit
            ? 'Update supplier, amounts, and lines, then save.'
            : 'Match the source file, fix supplier and lines, then confirm.'
        }
        actions={
          isSavedEdit ? null : <StatusBadge status="pending">OCR {ocrPct}%</StatusBadge>
        }
      />

      {error ? <AlertBanner tone="danger" title="Could not load">{error}</AlertBanner> : null}

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
            <h2 className="invoice-recheck-panel-title">Source file</h2>
            <p className="invoice-recheck-panel-hint">Use this as the source of truth while reviewing.</p>
          </header>
          <InvoicePdfViewer
            file={invoice?.file_url}
            fileName={invoice?.file_url || ''}
            title={invoice?.invoice_number || 'Scanned invoice'}
            loading={false}
            emptyTitle="File unavailable"
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
                  onChange={handleSupplierChange}
                />
                {supplierLedger?.status === 'created' ? (
                  <p className="muted" style={{ margin: '8px 0 0' }}>
                    This supplier was not in the ledger. It was created automatically from the
                    scan
                    {supplierLabel ? (
                      <>
                        {' '}
                        (<strong>{supplierLabel}</strong>)
                      </>
                    ) : null}
                    .
                  </p>
                ) : null}
                {!supplierId && suggestedSupplier?.name ? (
                  <p className="muted" style={{ margin: '8px 0 0' }}>
                    Scanned supplier <strong>{suggestedSupplier.name}</strong>
                    {suggestedSupplier.GSTIN ? ` · GSTIN ${suggestedSupplier.GSTIN}` : ''} is
                    not in the ledger and could not be created automatically. Pick or fix the
                    supplier before confirming.
                  </p>
                ) : null}
                {!supplierId && !suggestedSupplier?.name ? (
                  <p className="muted" style={{ margin: '8px 0 0' }}>
                    No supplier was found on the scan. Search the ledger and select one before
                    confirming.
                  </p>
                ) : null}
              </label>

              <label>
                Invoice number <span className="required-mark">*</span>
                <input
                  value={header.invoice_number}
                  onChange={(e) => handleHeaderField('invoice_number', e.target.value)}
                  placeholder="As printed on the invoice"
                  required
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
                {supplierCreditDays != null ? (
                  <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: '0.75rem' }}>
                    Auto from supplier credit period · {supplierCreditDays} day
                    {supplierCreditDays === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: '0.75rem' }}>
                    No supplier credit period yet — set due date; days will be saved for this supplier
                  </span>
                )}
              </label>
            </div>
          </div>

          <div className="invoice-recheck-section">
            <h3 className="form-page-section-title">Amounts</h3>
            <p className="invoice-recheck-section-lead muted">
              Confirm requires line items = taxable, and taxable + tax + round off = grand total.
            </p>
            {!linesMatchSubtotal ? (
              <AlertBanner tone="danger" title="Line items do not match subtotal">
                Line items total ₹{formatMoney(lineItemsTotal)}, but taxable / subtotal is ₹
                {formatMoney(header.base_amount)}. Fix the lines or subtotal before confirming.
              </AlertBanner>
            ) : null}
            {!totalsBalanced ? (
              <AlertBanner tone="danger" title="Totals do not match">
                Expected ₹{formatMoney(expectedGrandTotal)} (taxable + tax + round off), but grand total is ₹
                {formatMoney(header.total_amount)}. Fix the amounts before confirming.
              </AlertBanner>
            ) : null}
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

              <label>
                Grand total
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={header.total_amount}
                  onChange={(e) => handleHeaderField('total_amount', e.target.value)}
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
              onAdd={handleAddLine}
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
              disabled={submitting}
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
