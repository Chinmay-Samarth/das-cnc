import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import ImageLightbox from '../components/shared/ImageLightBox';

const emptyFormData = {
  name: '',
  official_address: '',
  billing_address: '',
  GSTIN: '',
  PAN_no: '',
  contact_person: '',
  contact_number: '',
  email: '',
  customer_recommended: 'false',
  bank_name: '',
  account_number: '',
  account_type: '',
  IFSC: '',
  payment_details: '',
};

const fmt = (value) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString('en-IN');
};

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="component-detail-label ">{label}</p>
      <p className="component-detail-value">{value || '--'}</p>
    </div>
  );
}

export default function SupplierDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [supplier, setSupplier] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('details');
  const [formData, setFormData] = useState(emptyFormData);
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [invoicesError, setInvoicesError] = useState(null);
  const [lightBox, setLightBox] = useState('')
  const [isPdf, setIsPdf] = useState(false)
  const [formUpdate, setFormUpdate] = useState(false)

  useEffect(() => {
    if (location.pathname.endsWith('/invoices')) {
      setTab('invoices');
    } else if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else {
      setTab('details');
    }
  }, [location.pathname]);

  useEffect(() => {
    let mounted = true;

    async function loadSupplier() {
      try {
        setLoading(true);
        setError(null);
        setFormUpdate(false)
        const { data } = await api.get('/suppliers');
        if (!mounted) return;
        const match = (data.suppliers || []).find((item) => String(item.id) === String(id));
        setSupplier(match || null);
        if (match) {
          setFormData({
            name: match.name || '',
            official_address: match.official_address || '',
            billing_address: match.billing_address || '',
            GSTIN: match.GSTIN || '',
            PAN_no: match.PAN_no || '',
            contact_person: match.contact_person || '',
            contact_number: match.contact_number || '',
            email: match.email || '',
            customer_recommended: match.customer_recommended ? 'true' : 'false',
            bank_name: match.bank_name || '',
            account_number: match.account_number || '',
            account_type: match.account_type || '',
            IFSC: match.IFSC || '',
            payment_details: match.payment_details || '',
          });

          setIsPdf(match.iso_certificate_url.toLowerCase().includes('.pdf'))
        }
      } catch (err) {
        console.error('Failed to load supplier details:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load supplier details.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadSupplier();
    return () => {
      mounted = false;
    };
  }, [id, formUpdate]);

  useEffect(() => {
    let mounted = true;

    async function loadInvoices() {
      try {
        setInvoicesLoading(true);
        setInvoicesError(null);
        const { data } = await api.get('/invoices/list');
        if (!mounted) return;
        setInvoices((data || []).filter((invoice) => String(invoice.supplier_id) === String(id)));
      } catch (err) {
        console.error('Failed to load supplier invoices:', err);
        if (!mounted) return;
        setInvoicesError(err.response?.data?.error || 'Unable to load supplier invoices.');
      } finally {
        if (!mounted) return;
        setInvoicesLoading(false);
      }
    }

    if (id) {
      loadInvoices();
    }

    return () => {
      mounted = false;
    };
  }, [id]);

  const invoiceTotal = useMemo(
    () => invoices.reduce((sum, invoice) => sum + (Number(invoice.total_amount) || 0), 0),
    [invoices]
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleFileChange = (event) => {
    setCertificate(event.target.files?.[0] || null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = new FormData();
      Object.entries(formData).forEach(([key, value]) => {
        payload.append(key, typeof value === 'string' ? value.trim() : value);
      });
      if (certificate) {
        payload.append('photo', certificate);
      }

      await api.put(`/suppliers/${id}`, payload);
      const { data } = await api.get('/suppliers');
      const updated = (data.suppliers || []).find((item) => String(item.id) === String(id));
      setSupplier(updated || null);
      setCertificate(null);
      navigate(`/suppliers/${id}`);
    } catch (err) {
      console.error('Failed to update supplier:', err);
      setError(err.response?.data?.error || 'Unable to update supplier. Please try again.');
    } finally {
      setSubmitting(false);
      setFormUpdate(true)
    }
  };

  return (
    <main className="app-shell employee-details-page masters-page component-details-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Vendor management</p>
          <h1>Supplier details</h1>
        </div>
      </header>

      <section className="card form-card">
        <div className="tab-row" style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={tab === 'details' ? 'primary-button' : 'secondary-button'}
            onClick={() => navigate(`/suppliers/${id}`)}
          >
            Details
          </button>
          <button
            type="button"
            className={tab === 'invoices' ? 'primary-button' : 'secondary-button'}
            onClick={() => navigate(`/suppliers/${id}/invoices`)}
          >
            Invoices
          </button>
          <button
            type="button"
            className={tab === 'edit' ? 'primary-button' : 'secondary-button'}
            onClick={() => navigate(`/suppliers/${id}/edit`)}
          >
            Edit
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/suppliers')}>
            Back to suppliers
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading supplier details...</p>
        ) : error ? (
          <p className="error-message">{error}</p>
        ) : !supplier ? (
          <p className="muted">Supplier not found.</p>
        ) : tab === 'details' ? (
          <>
            <div className="employee-details-grid">
              <div className=" employee-detail-grid">
                <DetailItem label="Supplier Name" value={supplier.name} />
                <DetailItem label="GSTIN" value={supplier.GSTIN} />
                <DetailItem label="PAN" value={supplier.PAN_no} />
                <DetailItem
                  label="Supplier Type"
                  value={supplier.customer_recommended ? 'Customer recommended' : 'Standard'}
                />
                <DetailItem label="Contact Person" value={supplier.contact_person} />
                <DetailItem label="Contact Number" value={supplier.contact_number} />
                <DetailItem label="Email" value={supplier.email} />
                <DetailItem label="Bank Name" value={supplier.bank_name} />
                <DetailItem label="Account Number" value={supplier.account_number} />
                <DetailItem label="Account Type" value={supplier.account_type} />
                <DetailItem label="IFSC" value={supplier.IFSC} />
                <DetailItem label="Payment Details" value={supplier.payment_details} />
              </div>
            </div>

            <section className="card employee-details-attendance">
              <div
                className="section-header"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}
              >
                <div>
                  <h2>Address &amp; documents</h2>
                  <p className="muted">Official, billing, and certificate information for this supplier.</p>
                </div>
              </div>

              <div className="address-card">
                <DetailItem label="Official Address" value={supplier.official_address} />
                <DetailItem label="Billing Address" value={supplier.billing_address} />
                <div>
                  <p className="text-xl font-medium ">ISO Certificate</p>
                  {supplier.iso_certificate_url ? (
                    <div style={{ gridColumn: 'span 2' }}>
                    {isPdf ? (
                      <div className="">
                        <a
                        href={supplier.iso_certificate_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          <div style={{
                            width: '160px', height: '160px', borderRadius: '12px',
                            border: '1px solid #d1d5db', backgroundColor: '#f3f4f6',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            gap: '8px', cursor: 'pointer',
                          }}>
                            {/* PDF icon */}
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                              stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14,2 14,8 20,8"/>
                              <text x="6" y="18" fontSize="5" fill="#ef4444" stroke="none"
                                fontWeight="bold" fontFamily="sans-serif">PDF</text>
                            </svg>
                            <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '0 8px' }}>
                              ISO Certificate<br/>Click to open
                            </span>
                          </div>
                        </a>
                      </div>
                    ) : (
                      <>
                      <img
                      src={supplier.iso_certificate_url || ''}
                      alt={supplier.iso_certificate_url ? `${supplier.name} iso certificate` : 'No photo available'}
                      style={{ width: '160px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb',cursor: "pointer" }}
                      onClick={()=>{setLightBox({ src: supplier.iso_certificate_url, alt: supplier.name })}}
                      />
                      
                      {lightBox && (
                        <ImageLightbox
                        src={lightBox.src}
                        alt={lightBox.alt}
                        onClose={() => setLightBox(null)}
                        />
                      )}
                      </>
                  )}
                  </div>
                ) : (
                    <p className="font-bold ">--</p>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : tab === 'invoices' ? (
          <section className="card employee-details-attendance">
            <div
              className="section-header"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}
            >
              <div>
                <h2>Invoices</h2>
                <p className="muted">Invoices linked to {supplier.name}.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span className="count-chip">{invoices.length}</span>
                <span className="count-chip">Rs {fmt(invoiceTotal)}</span>
              </div>
            </div>

            {invoicesLoading ? (
              <p className="muted">Loading invoices...</p>
            ) : invoicesError ? (
              <p className="error-message">{invoicesError}</p>
            ) : invoices.length === 0 ? (
              <p className="muted">No invoices found for this supplier.</p>
            ) : (
              <div className="attendance-table-wrap">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr
                        key={invoice.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/invoices/${invoice.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            navigate(`/invoices/${invoice.id}`);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{invoice.invoice_number || '--'}</td>
                        <td>{invoice.invoice_date || invoice.created_at || '--'}</td>
                        <td>{invoice.due_date || '--'}</td>
                        <td>
                          <span className="status-chip">{invoice.status || '--'}</span>
                        </td>
                        <td>Rs {fmt(invoice.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <form onSubmit={handleSubmit}>
            {error ? <p className="error-message">{error}</p> : null}

            <label htmlFor="name">
              Supplier Name <span style={{ color: '#b91c1c' }}>*</span>
              <input
                id="name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="GSTIN">
              GSTIN <span style={{ color: '#b91c1c' }}>*</span>
              <input
                id="GSTIN"
                type="text"
                name="GSTIN"
                value={formData.GSTIN}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="PAN_no">
              PAN
              <input
                id="PAN_no"
                type="text"
                name="PAN_no"
                value={formData.PAN_no}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="official_address">
              Official Address
              <input
                id="official_address"
                type="text"
                name="official_address"
                value={formData.official_address}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="billing_address">
              Billing Address
              <input
                id="billing_address"
                type="text"
                name="billing_address"
                value={formData.billing_address}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="contact_person">
              Contact Person
              <input
                id="contact_person"
                type="text"
                name="contact_person"
                value={formData.contact_person}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="contact_number">
              Contact Number
              <input
                id="contact_number"
                type="tel"
                name="contact_number"
                value={formData.contact_number}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="email">
              Email
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="customer_recommended">
              Supplier Type
              <select
                id="customer_recommended"
                name="customer_recommended"
                value={formData.customer_recommended}
                onChange={handleChange}
                disabled={submitting}
              >
                <option value="false">Standard</option>
                <option value="true">Customer recommended</option>
              </select>
            </label>

            <label htmlFor="bank_name">
              Bank Name
              <input
                id="bank_name"
                type="text"
                name="bank_name"
                value={formData.bank_name}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="account_number">
              Account Number <span style={{ color: '#b91c1c' }}>*</span>
              <input
                id="account_number"
                type="text"
                name="account_number"
                value={formData.account_number}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="account_type">
              Account Type
              <input
                id="account_type"
                type="text"
                name="account_type"
                value={formData.account_type}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="IFSC">
              IFSC
              <input
                id="IFSC"
                type="text"
                name="IFSC"
                value={formData.IFSC}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="payment_details">
              Payment Details
              <input
                id="payment_details"
                type="text"
                name="payment_details"
                value={formData.payment_details}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            {supplier.iso_certificate_url ? (
              <div style={{ marginBottom: '16px' }}>
                <p className="text-xl font-medium mb-3">Current ISO Certificate</p>
                <a href={supplier.iso_certificate_url} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                  Open certificate
                </a>
              </div>
            ) : null}

            <label htmlFor="certificate">
              ISO Certificate
              <input
                id="certificate"
                type="file"
                accept="image/*,application/pdf"
                name="certificate"
                onChange={handleFileChange}
                disabled={submitting}
              />
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/suppliers/${id}`)}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
