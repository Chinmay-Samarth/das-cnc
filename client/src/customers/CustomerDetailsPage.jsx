import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import api from '../api/client';

const emptyFormData = {
  name: '',
  official_address: '',
  billing_address: '',
  gstin: '',
  pan_no: '',
  contact_person: '',
  contact_phone: '',
  bank_name: '',
  account_no: '',
  account_type: '',
  ifsc: '',
  payment_terms: '',
};

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="employee-detail-label ">{label}</p>
      <p className="employee-detail-value">{value || '--'}</p>
    </div>
  );
}

export default function CustomerDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [tab, setTab] = useState('details');
  const [formData, setFormData] = useState(emptyFormData);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else {
      setTab('details');
    }
  }, [location.pathname]);

  useEffect(() => {
    let mounted = true;

    async function loadCustomer() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get(`/customers/${id}`);
        if (!mounted) return;
        const loadedCustomer = data.customer || null;
        setCustomer(loadedCustomer);
        if (loadedCustomer) {
          setFormData({
            name: loadedCustomer.name || '',
            official_address: loadedCustomer.official_address || '',
            billing_address: loadedCustomer.billing_address || '',
            gstin: loadedCustomer.gstin || '',
            pan_no: loadedCustomer.pan_no || '',
            contact_person: loadedCustomer.contact_person || '',
            contact_phone: loadedCustomer.contact_phone || '',
            bank_name: loadedCustomer.bank_name || '',
            account_no: loadedCustomer.account_no || '',
            account_type: loadedCustomer.account_type || '',
            ifsc: loadedCustomer.ifsc || '',
            payment_terms: loadedCustomer.payment_terms || '',
          });
        }
      } catch (err) {
        console.error('Failed to load customer details:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load customer details.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadCustomer();
    return () => {
      mounted = false;
    };
  }, [id]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {};
      Object.entries(formData).forEach(([key, value]) => {
        payload[key] = typeof value === 'string' ? value.trim() : value;
      });

      await api.put(`/customers/${id}`, payload);
      const { data } = await api.get(`/customers/${id}`);
      setCustomer(data.customer || null);
      navigate(`/customers/${id}`);
    } catch (err) {
      console.error('Failed to update customer:', err);
      setError(err.response?.data?.error || 'Unable to update customer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <p onClick={()=> navigate('/customers')} style={{cursor: 'pointer'}}><ArrowLeft size={16} style={{marginRight: 4, display: 'inline'}}/>Back to customers</p>
        <div className="employee-title-block">
          <div className="">
            <h1>{customer?.name}</h1>
            <p className="muted">{customer?.gstin}</p>
          </div>
          <div className="employee-top-bar">
            <button
            type="button"
            className={'neutral-button'}
            onClick={() => setTab('edit')}
          >
            < Pencil size={16} style={{marginRight: 4, display: "inline"}}/>Edit
          </button>
          </div>
        </div>

        <div className="pill-tabs">
          <button
            type="button"
            className={`pill-tab ${tab === 'details' ? 'pill-tab-active' : ''}`}
            onClick={() => {setTab('details')}}
            aria-selected = {tab === 'details'}
            role = 'tab'
          >
            Details
          </button>
        </div>
      </header>

      
      <section className="card employee-main">
        {loading ? (
          <p className="muted">Loading customer details...</p>
        ) : error ? (
          <p className="error-message">{error}</p>
        ) : !customer ? (
          <p className="muted">Customer not found.</p>
        ) : tab === 'details' ? (
          <>
            <div className="detail-content-grid">
              <div className="detail-main-column">
                <div className="employee-details-grid">
                  <div className=" employee-detail-grid">
                    <DetailItem label="Customer Name" value={customer.name} />
                    <DetailItem label="GSTIN" value={customer.gstin} />
                    <DetailItem label="PAN" value={customer.pan_no} />
                    <DetailItem label="Contact Person" value={customer.contact_person} />
                    <DetailItem label="Contact Phone" value={customer.contact_phone} />
                    <DetailItem label="Bank Name" value={customer.bank_name} />
                    <DetailItem label="Account Number" value={customer.account_no} />
                    <DetailItem label="Account Type" value={customer.account_type} />
                    <DetailItem label="IFSC" value={customer.ifsc} />
                    <DetailItem label="Payment Terms" value={customer.payment_terms} />
                    {customer.created_at ? (
                      <DetailItem label="Created At" value={new Date(customer.created_at).toLocaleString()} />
                    ) : null}
                    {customer.updated_at ? (
                      <DetailItem label="Updated At" value={new Date(customer.updated_at).toLocaleString()} />
                    ) : null}
                  </div>
                </div>
              </div>
              <aside className="detail-side-column">
                <section className="card employee-details-attendance">
                  <div
                    className="section-header"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}
                    >
                    <div>
                      <h2>ADDRESS INFORMATION</h2>
                    </div>
                  </div>
                  
                  <div className="address-card">
                    <DetailItem label="Official Address" value={customer.official_address} />
                    <DetailItem label="Billing Address" value={customer.billing_address} />
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error ? <p className="error-message">{error}</p> : null}

            <label htmlFor="name">
              Customer Name <span style={{ color: '#b91c1c' }}>*</span>
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

            <label htmlFor="gstin">
              GSTIN
              <input
                id="gstin"
                type="text"
                name="gstin"
                value={formData.gstin}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="pan_no">
              PAN
              <input
                id="pan_no"
                type="text"
                name="pan_no"
                value={formData.pan_no}
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

            <label htmlFor="contact_phone">
              Contact Phone
              <input
                id="contact_phone"
                type="tel"
                name="contact_phone"
                value={formData.contact_phone}
                onChange={handleChange}
                disabled={submitting}
              />
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

            <label htmlFor="account_no">
              Account Number
              <input
                id="account_no"
                type="text"
                name="account_no"
                value={formData.account_no}
                onChange={handleChange}
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

            <label htmlFor="ifsc">
              IFSC
              <input
                id="ifsc"
                type="text"
                name="ifsc"
                value={formData.ifsc}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <label htmlFor="payment_terms">
              Payment Terms
              <input
                id="payment_terms"
                type="text"
                name="payment_terms"
                value={formData.payment_terms}
                onChange={handleChange}
                disabled={submitting}
              />
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                className="cancel-button"
                onClick={() => navigate(`/customers/${id}`)}
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
