import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Printer, Truck } from 'lucide-react';
import api from '../api/client';
import { PageHeader } from '../components/mes';
import { appAlert } from '../components/dialog';
import { printSalesInvoicePdf, formatInr } from './downloadSalesInvoicePdf';

const STEPS = [
  { id: 1, title: 'Lot & schedule', hint: 'Confirm what you are billing' },
  { id: 2, title: 'Customer & tax', hint: 'Place of supply and GST split' },
  { id: 3, title: 'Company', hint: 'Seller details on this invoice' },
  { id: 4, title: 'Issue & print', hint: 'Number, print, confirm' },
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

export default function AddSalesInvoiceWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lotId = searchParams.get('lotId');
  const quantityParam = searchParams.get('quantity');

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [downloaded, setDownloaded] = useState(false);

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
      const [byLot, prev] = await Promise.all([
        api.get(`/sales-invoices/by-lot/${lotId}`),
        api.get(`/sales-invoices/preview-lot/${lotId}`),
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
        if (existing.status !== 'draft') setStep(4);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load lot billing context');
    } finally {
      setLoading(false);
    }
  }, [lotId, quantityParam]);

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
      setStep((s) => Math.min(4, s + 1));
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
      await appAlert(`Issued ${inv.invoice_number}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Issue failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (!invoice) return;
    setBusy(true);
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
    try {
      const { data } = await api.post(`/sales-invoices/${invoice.id}/confirm-printed`);
      setInvoice(data.sales_invoice);
      await appAlert('Print confirmed. You can dispatch the lot.');
    } catch (err) {
      setError(err.response?.data?.error || 'Confirm print failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDispatch() {
    if (!lotId) return;
    setBusy(true);
    try {
      await api.post(`/production/lots/${lotId}/dispatch`);
      await appAlert('Lot dispatched');
      navigate('/production/dispatch');
    } catch (err) {
      setError(err.response?.data?.error || 'Dispatch failed');
    } finally {
      setBusy(false);
    }
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
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => navigate('/production/dispatch')}
          >
            <ArrowLeft size={15} />
            Dispatch queue
          </button>
        }
      />

      <nav className="bpo-steps" aria-label="Invoice steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step || (invoice && s.id === 4)) setStep(s.id);
            }}
          >
            <span className="bpo-step-num">{step > s.id ? <Check size={14} /> : s.id}</span>
            <span>
              <strong>{s.title}</strong>
              <em>{s.hint}</em>
            </span>
          </button>
        ))}
      </nav>

      {error ? <p className="error-message">{error}</p> : null}

      {step === 1 && preview ? (
        <section className="bpo-panel mes-card">
          <h2>Lot & contract line</h2>
          <p className="muted">
            Component: <strong>{preview.component_label || '—'}</strong>
          </p>
          <p className="muted">
            Schedule: <strong>{preview.schedule?.schedule_number}</strong> · Due{' '}
            {preview.schedule?.due_date}
          </p>
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
        </section>
      ) : null}

      {step === 2 && preview ? (
        <section className="bpo-panel mes-card">
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
                className="mes-btn mes-btn-secondary"
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
        </section>
      ) : null}

      {step === 3 ? (
        <section className="bpo-panel mes-card">
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
        </section>
      ) : null}

      {step === 4 ? (
        <section className="bpo-panel mes-card">
          <h2>Issue & print</h2>
          {invoice ? (
            <>
              <p>
                Status: <strong>{invoice.status}</strong>
                {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ''}
              </p>
              <p className="muted">
                Total ₹{formatInr(invoice.total_amount)} ·{' '}
                {invoice.tax_type === 'IGST' ? 'IGST' : 'CGST+SGST'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {invoice.status === 'draft' ? (
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary"
                    disabled={busy}
                    onClick={handleIssue}
                  >
                    Issue invoice (allocate number)
                  </button>
                ) : null}
                {['due', 'paid'].includes(invoice.status) ? (
                  <>
                    <button
                      type="button"
                      className="mes-btn mes-btn-secondary"
                      disabled={busy}
                      onClick={handlePrint}
                    >
                      <Printer size={15} />
                      Print invoice
                    </button>
                    {!invoice.printed_at ? (
                      <button
                        type="button"
                        className="mes-btn mes-btn-primary"
                        disabled={busy || !downloaded}
                        title={!downloaded ? 'Print the invoice first' : undefined}
                        onClick={handleConfirmPrinted}
                      >
                        <Printer size={15} />
                        Confirm printed
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="mes-btn mes-btn-primary"
                        disabled={busy}
                        onClick={handleDispatch}
                      >
                        <Truck size={15} />
                        Dispatch lot
                      </button>
                    )}
                  </>
                ) : null}
                <button
                  type="button"
                  className="mes-btn mes-btn-secondary"
                  onClick={() => invoice?.id && navigate(`/sales-invoices/${invoice.id}`)}
                >
                  Open invoice detail
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Complete previous steps to create a draft.</p>
          )}
        </section>
      ) : null}

      <footer className="bpo-footer">
        <button
          type="button"
          className="mes-btn mes-btn-secondary"
          disabled={step <= 1 || busy}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
        >
          Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            disabled={!canNext() || busy}
            onClick={goNext}
          >
            Continue
          </button>
        ) : null}
      </footer>
    </main>
  );
}
