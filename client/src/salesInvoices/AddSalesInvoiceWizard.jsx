import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Printer, Truck } from 'lucide-react';
import api from '../api/client';
import { PageHeader, AlertBanner } from '../components/mes';
import { printSalesInvoicePdf, formatInr } from './downloadSalesInvoicePdf';
import { printPackingSlipPdf } from './downloadPackingSlipPdf';

const STEPS = [
  { id: 1, title: 'Lot & schedule', hint: 'Confirm what you are billing' },
  { id: 2, title: 'Customer & tax', hint: 'Place of supply and GST split' },
  { id: 3, title: 'Company', hint: 'Seller details on this invoice' },
  { id: 4, title: 'Issue', hint: 'Allocate invoice number' },
  { id: 5, title: 'Print invoice', hint: 'Print and confirm the invoice' },
  { id: 6, title: 'Packing slip', hint: 'Print and confirm the slip' },
  { id: 7, title: 'Dispatch', hint: 'Ship the lot' },
];

const STATE_HINTS = [
  { code: '29', name: 'Karnataka' },
  { code: '27', name: 'Maharashtra' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '07', name: 'Delhi' },
];

function sameState(a, b) {
  return String(a || '').padStart(2, '0').slice(0, 2) === String(b || '').padStart(2, '0').slice(0, 2);
}

function resumeStepForInvoice(inv) {
  if (!inv) return 1;
  if (inv.status === 'draft') return 4;
  if (!inv.printed_at) return 5;
  if (!inv.packing_slip_printed_at) return 6;
  if (!inv.dispatched_at) return 7;
  return 7;
}

export default function AddSalesInvoiceWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lotId = searchParams.get('lotId');
  const quantityParam = searchParams.get('quantity');
  const scheduleIdParam = searchParams.get('delivery_schedule_id');

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [packingDownloaded, setPackingDownloaded] = useState(false);

  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [posCode, setPosCode] = useState('');
  const [notes, setNotes] = useState('');
  const [saveCompany, setSaveCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    legal_name: '',
    trade_name: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    state_code: '29',
    gstin: '',
    pan: '',
    phone: '',
    email: '',
    bank_name: '',
    bank_account: '',
    ifsc: '',
    invoice_prefix: 'INV',
  });

  const bootstrap = useCallback(async () => {
    if (!lotId) {
      setError('Missing lotId — open this wizard from Ready for Dispatch');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const previewQs = scheduleIdParam
        ? `?delivery_schedule_id=${encodeURIComponent(scheduleIdParam)}`
        : '';
      const [byLot, prev] = await Promise.all([
        api.get(`/sales-invoices/by-lot/${lotId}`),
        api.get(`/sales-invoices/preview-lot/${lotId}${previewQs}`),
      ]);
      const existing = byLot.data?.sales_invoice;
      setPreview(prev.data);
      const company = prev.data?.company_settings || {};
      setCompanyForm((f) => ({
        ...f,
        ...Object.fromEntries(
          Object.keys(f).map((k) => [k, company[k] != null ? String(company[k]) : f[k]])
        ),
      }));
      const qtyFromQuery = Number(quantityParam);
      const defaultQty =
        Number.isFinite(qtyFromQuery) && qtyFromQuery > 0
          ? qtyFromQuery
          : prev.data?.remaining_qty != null
            ? prev.data.remaining_qty
            : prev.data?.lot?.quantity;
      setQuantity(String(defaultQty ?? ''));
      setUnitPrice(String(prev.data?.line?.unit_price ?? ''));
      const gstin = prev.data?.customer?.gstin || '';
      setPosCode(gstin.length >= 2 ? gstin.slice(0, 2) : company.state_code || '29');

      if (existing) {
        setInvoice(existing);
        setQuantity(String(existing.quantity));
        setUnitPrice(String(existing.unit_price));
        setPosCode(existing.place_of_supply_state_code || posCode);
        setNotes(existing.notes || '');
        setDownloaded(!!existing.printed_at);
        setPackingDownloaded(!!existing.packing_slip_printed_at);
        setStep(resumeStepForInvoice(existing));
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load lot billing context');
    } finally {
      setLoading(false);
    }
  }, [lotId, quantityParam, scheduleIdParam]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const taxPreview = useMemo(() => {
    const qty = Number(quantity);
    const price = Number(unitPrice);
    const taxable = Math.round(qty * price * 100 + Number.EPSILON) / 100;
    const companyState = companyForm.state_code || '29';
    const intra = sameState(companyState, posCode);
    if (!(qty > 0) || !(price >= 0) || !Number.isFinite(taxable)) {
      return { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, tax_type: 'IGST' };
    }
    if (intra) {
      const half = Math.round(taxable * 0.09 * 100 + Number.EPSILON) / 100;
      return {
        taxable,
        cgst: half,
        sgst: half,
        igst: 0,
        total: Math.round((taxable + half + half) * 100) / 100,
        tax_type: 'CGST_SGST',
      };
    }
    const igst = Math.round(taxable * 0.18 * 100 + Number.EPSILON) / 100;
    return {
      taxable,
      cgst: 0,
      sgst: 0,
      igst,
      total: Math.round((taxable + igst) * 100) / 100,
      tax_type: 'IGST',
    };
  }, [quantity, unitPrice, companyForm.state_code, posCode]);

  function canNext() {
    if (step === 1) return Number(quantity) > 0 && Number(unitPrice) >= 0;
    if (step === 2) return /^\d{2}$/.test(String(posCode).padStart(2, '0'));
    if (step === 3) {
      return !!(companyForm.legal_name || companyForm.trade_name) && companyForm.gstin && companyForm.state_code;
    }
    return true;
  }

  async function ensureDraft() {
    const payload = {
      lot_id: lotId,
      quantity: Number(quantity),
      unit_price: Number(unitPrice),
      place_of_supply_state_code: String(posCode).padStart(2, '0'),
      notes: notes || undefined,
      company_override: { ...companyForm },
    };
    if (scheduleIdParam) {
      payload.delivery_schedule_id = scheduleIdParam;
    } else if (preview?.schedule?.id) {
      payload.delivery_schedule_id = preview.schedule.id;
    }

    if (saveCompany) {
      await api.patch('/sales-invoices/company-settings', companyForm);
    }

    if (invoice?.id && invoice.status === 'draft') {
      const { data } = await api.patch(`/sales-invoices/${invoice.id}`, payload);
      setInvoice(data.sales_invoice);
      return data.sales_invoice;
    }
    if (invoice?.id) return invoice;

    const { data } = await api.post('/sales-invoices', payload);
    setInvoice(data.sales_invoice);
    return data.sales_invoice;
  }

  async function goNext() {
    if (!canNext()) return;
    setBusy(true);
    setError(null);
    try {
      if (step === 3) {
        await ensureDraft();
      }
      setStep((s) => Math.min(STEPS.length, s + 1));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unable to continue');
    } finally {
      setBusy(false);
    }
  }

  async function handleIssue() {
    setBusy(true);
    setError(null);
    try {
      let inv = invoice;
      if (!inv || inv.status === 'draft') {
        inv = await ensureDraft();
      }
      if (inv.status === 'draft') {
        const { data } = await api.post(`/sales-invoices/${inv.id}/issue`);
        inv = data.sales_invoice;
        setInvoice(inv);
      }
      setStep(5);
    } catch (err) {
      setError(err.response?.data?.error || 'Issue failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const stored = await printSalesInvoicePdf(invoice);
      if (stored?.id) setInvoice(stored);
      setDownloaded(true);
    } catch (err) {
      setError(err.message || 'Print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPrinted() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/sales-invoices/${invoice.id}/confirm-printed`);
      setInvoice(data.sales_invoice);
      setStep(6);
    } catch (err) {
      setError(err.response?.data?.error || 'Confirm print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrintPackingSlip() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      await printPackingSlipPdf(invoice);
      setPackingDownloaded(true);
    } catch (err) {
      setError(err.message || 'Packing slip print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPackingSlip() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(
        `/sales-invoices/${invoice.id}/confirm-packing-slip-printed`
      );
      setInvoice(data.sales_invoice);
      setStep(7);
    } catch (err) {
      setError(err.response?.data?.error || 'Confirm packing slip failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDispatch() {
    if (!lotId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/production/lots/${lotId}/dispatch`);
      navigate('/production/dispatch');
    } catch (err) {
      setError(err.response?.data?.error || 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  }

  function invoiceSummary() {
    if (!invoice) return null;
    return (
      <div className="bpo-review" style={{ marginBottom: 16 }}>
        <p style={{ margin: 0 }}>
          <strong>{invoice.invoice_number || 'Draft'}</strong>
          {' · '}
          Status <strong>{invoice.status}</strong>
        </p>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Total ₹{formatInr(invoice.total_amount)} ·{' '}
          {invoice.tax_type === 'IGST' ? 'IGST' : 'CGST+SGST'}
          {preview?.component_label ? ` · ${preview.component_label}` : ''}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <main className="mes-shell bpo-setup-page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mes-shell bpo-setup-page">
      <PageHeader
        eyebrow="Sales invoice"
        title="Invoice for dispatch"
        subtitle={preview?.lot?.lot_number ? `Lot ${preview.lot.lot_number}` : ''}
      />

      <nav className="bpo-steps" aria-label="Invoice steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step) setStep(s.id);
            }}
            disabled={s.id > step}
          >
            <span className="bpo-step-num">{step > s.id ? <Check size={14} /> : s.id}</span>
            <span className="bpo-step-text">
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="card bpo-setup-card">
        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

        {step === 1 && preview ? (
          <div className="bpo-panel">
            <h2>Lot & contract line</h2>
            <p className="muted">
              Component: <strong>{preview.component_label || '—'}</strong>
            </p>
            <p className="muted">
              Schedule: <strong>{preview.schedule?.schedule_number}</strong> · Due{' '}
              {preview.schedule?.due_date}
              {preview.remaining_qty != null ? (
                <>
                  {' '}
                  · Remaining <strong>{Number(preview.remaining_qty)}</strong>
                </>
              ) : null}
            </p>
            {preview.schedule_choice_required ? (
              <AlertBanner tone="warning">
                Past-due and upcoming schedules both have remaining qty. The schedule above is what
                this invoice will bill — change it on Ready for Dispatch before creating the draft if
                needed.
              </AlertBanner>
            ) : null}
            <p className="muted">
              Blanket: <strong>{preview.blanket?.blanket_number}</strong>
            </p>
            <label>
              Quantity
              <input
                type="number"
                min="0.001"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              Unit price (INR)
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </label>
            <label>
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
          </div>
        ) : null}

        {step === 2 && preview ? (
          <div className="bpo-panel">
            <h2>Customer & tax</h2>
            <p>
              <strong>{preview.customer?.name}</strong>
            </p>
            <p className="muted">GSTIN {preview.customer?.gstin || '— (enter POS state below)'}</p>
            <label>
              Place of supply (state code)
              <input
                value={posCode}
                maxLength={2}
                onChange={(e) => setPosCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
            </label>
            <p className="muted" style={{ marginTop: 8 }}>
              Common:{' '}
              {STATE_HINTS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="neutral-button"
                  style={{ marginRight: 6, marginBottom: 6, padding: '2px 8px', fontSize: 12 }}
                  onClick={() => setPosCode(s.code)}
                >
                  {s.code} {s.name}
                </button>
              ))}
            </p>
            <div className="mes-card" style={{ padding: 12, marginTop: 12, background: '#f9fafb' }}>
              <p style={{ margin: 0 }}>
                Tax type:{' '}
                <strong>
                  {taxPreview.tax_type === 'IGST' ? 'IGST 18%' : 'CGST 9% + SGST 9%'}
                </strong>
              </p>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Taxable ₹{formatInr(taxPreview.taxable)} · Total ₹{formatInr(taxPreview.total)}
              </p>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="bpo-panel">
            <h2>Company details</h2>
            <p className="muted">Shown on the invoice. Optionally save as default company settings.</p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {[
                ['legal_name', 'Legal name'],
                ['trade_name', 'Trade name'],
                ['gstin', 'GSTIN'],
                ['state_code', 'State code'],
                ['state', 'State'],
                ['city', 'City'],
                ['address_line1', 'Address line 1'],
                ['address_line2', 'Address line 2'],
                ['pan', 'PAN'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['bank_name', 'Bank'],
                ['bank_account', 'Account no'],
                ['ifsc', 'IFSC'],
                ['invoice_prefix', 'Invoice prefix'],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={companyForm[key] || ''}
                    onChange={(e) =>
                      setCompanyForm((f) => ({
                        ...f,
                        [key]:
                          key === 'state_code'
                            ? e.target.value.replace(/\D/g, '').slice(0, 2)
                            : e.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={saveCompany}
                onChange={(e) => setSaveCompany(e.target.checked)}
              />
              Save as default company settings
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="bpo-panel">
            <h2>Issue invoice</h2>
            <p className="muted">
              Allocate a permanent invoice number and post the Sales voucher to Tally (when enabled).
            </p>
            {invoiceSummary()}
            {!invoice ? (
              <p className="muted">Complete previous steps to create a draft first.</p>
            ) : invoice.status !== 'draft' ? (
              <p className="muted">Already issued. Continue to print.</p>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="bpo-panel">
            <h2>Print invoice</h2>
            <p className="muted">
              Print the tax invoice, then confirm once the paper copy is ready.
            </p>
            {invoiceSummary()}
            {invoice?.printed_at ? (
              <p className="muted">Invoice print already confirmed.</p>
            ) : (
              <p className="muted">
                {downloaded
                  ? 'Print dialog opened — confirm when done.'
                  : 'Use Print invoice, then Confirm printed.'}
              </p>
            )}
          </div>
        ) : null}

        {step === 6 ? (
          <div className="bpo-panel">
            <h2>Packing slip</h2>
            <p className="muted">
              Print the packing slip for the shipment, then confirm it was printed.
            </p>
            {invoiceSummary()}
            {invoice?.packing_slip_printed_at ? (
              <p className="muted">Packing slip already confirmed.</p>
            ) : (
              <p className="muted">
                {packingDownloaded
                  ? 'Print dialog opened — confirm when done.'
                  : 'Use Print packing slip, then Confirm printed.'}
              </p>
            )}
          </div>
        ) : null}

        {step === 7 ? (
          <div className="bpo-panel">
            <h2>Dispatch</h2>
            <p className="muted">
              Invoice and packing slip are confirmed. Dispatch the lot to finish shipping.
            </p>
            {invoiceSummary()}
            {invoice?.dispatched_at ? (
              <p className="muted">This lot is already dispatched.</p>
            ) : null}
          </div>
        ) : null}

        <footer className="bpo-footer">
          <button
            type="button"
            className="neutral-button"
            disabled={step <= 1 || busy}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Back
          </button>

          {step < 4 ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canNext() || busy}
              onClick={goNext}
            >
              Continue
            </button>
          ) : null}

          {step === 4 ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !invoice}
              onClick={
                invoice && invoice.status !== 'draft'
                  ? () => setStep(5)
                  : handleIssue
              }
            >
              {busy
                ? 'Working…'
                : invoice && invoice.status !== 'draft'
                  ? 'Continue to print'
                  : 'Issue invoice'}
            </button>
          ) : null}

          {step === 5 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {!invoice?.printed_at ? (
                <>
                  <button
                    type="button"
                    className="neutral-button"
                    disabled={busy || !invoice}
                    onClick={handlePrint}
                  >
                    <Printer size={15} />
                    Print invoice
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !downloaded}
                    title={!downloaded ? 'Print the invoice first' : undefined}
                    onClick={handleConfirmPrinted}
                  >
                    Confirm printed
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => setStep(6)}
                >
                  Continue
                </button>
              )}
            </div>
          ) : null}

          {step === 6 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {!invoice?.packing_slip_printed_at ? (
                <>
                  <button
                    type="button"
                    className="neutral-button"
                    disabled={busy || !invoice}
                    onClick={handlePrintPackingSlip}
                  >
                    <Printer size={15} />
                    Print packing slip
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !packingDownloaded}
                    title={!packingDownloaded ? 'Print the packing slip first' : undefined}
                    onClick={handleConfirmPackingSlip}
                  >
                    Confirm printed
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => setStep(7)}
                >
                  Continue
                </button>
              )}
            </div>
          ) : null}

          {step === 7 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {invoice?.id ? (
                <button
                  type="button"
                  className="neutral-button"
                  disabled={busy}
                  onClick={() => navigate(`/sales-invoices/${invoice.id}`)}
                >
                  Open invoice
                </button>
              ) : null}
              <button
                type="button"
                className="primary-button"
                disabled={busy || !!invoice?.dispatched_at}
                onClick={handleDispatch}
              >
                <Truck size={15} />
                {busy ? 'Dispatching…' : 'Dispatch lot'}
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </main>
  );
}
