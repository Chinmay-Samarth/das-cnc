import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const initialFormData = {
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

export default function AddCustomerPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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

      await api.post('/customers', payload);
      navigate('/customers');
    } catch (err) {
      console.error('Failed to create customer:', err);
      setError(err.response?.data?.error || 'Unable to create customer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell add-employee-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Customer management</p>
          <h1>Add New Customer</h1>
          <p className="muted">Create a new customer record in the system.</p>
        </div>
      </header>

      <section className="card form-card">
        {error ? <p className="error-message">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="name">
            Customer Name <span style={{ color: '#b91c1c' }}>*</span>
            <input
              id="name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., ABC Industries"
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
              placeholder="e.g., 29ABCDE1234F1Z5"
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
              placeholder="e.g., ABCDE1234F"
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
              placeholder="Registered office address"
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
              placeholder="Billing address"
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
              placeholder="Primary contact"
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
              placeholder="Phone number"
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
              placeholder="Bank name"
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
              placeholder="Customer account number"
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
              placeholder="e.g., Current"
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
              placeholder="Bank IFSC"
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
              placeholder="Terms or payment notes"
              disabled={submitting}
            />
          </label>

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Customer'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/customers')}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
