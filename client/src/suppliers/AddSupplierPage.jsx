import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { FilePicker, FormActions, FormPage } from '../components/mes';

const initialFormData = {
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

export default function AddSupplierPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormData);
  const [certificate, setCertificate] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
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
      if (certificate) payload.append('photo', certificate);
      await api.post('/suppliers', payload);
      navigate('/suppliers');
    } catch (err) {
      console.error('Failed to create supplier:', err);
      setError(err.response?.data?.error || 'Unable to create supplier. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormPage
      eyebrow="Vendors"
      title="Add supplier"
      subtitle="Create a new supplier record."
      onBack={() => navigate('/suppliers')}
      backLabel="All suppliers"
      error={error}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-page-grid">
          <label htmlFor="name">
            Supplier name <span className="required-mark">*</span>
            <input id="name" type="text" name="name" value={formData.name} onChange={handleChange} placeholder="e.g., ABC Engineering" required disabled={submitting} />
          </label>
          <label htmlFor="GSTIN">
            GSTIN <span className="required-mark">*</span>
            <input id="GSTIN" type="text" name="GSTIN" value={formData.GSTIN} onChange={handleChange} placeholder="e.g., 29ABCDE1234F1Z5" required disabled={submitting} />
          </label>
          <label htmlFor="PAN_no">
            PAN
            <input id="PAN_no" type="text" name="PAN_no" value={formData.PAN_no} onChange={handleChange} placeholder="e.g., ABCDE1234F" disabled={submitting} />
          </label>
          <label htmlFor="customer_recommended">
            Supplier type
            <select id="customer_recommended" name="customer_recommended" value={formData.customer_recommended} onChange={handleChange} disabled={submitting}>
              <option value="false">Standard</option>
              <option value="true">Customer recommended</option>
            </select>
          </label>
          <label htmlFor="official_address" className="form-span-2">
            Official address
            <input id="official_address" type="text" name="official_address" value={formData.official_address} onChange={handleChange} placeholder="Registered office address" disabled={submitting} />
          </label>
          <label htmlFor="billing_address" className="form-span-2">
            Billing address
            <input id="billing_address" type="text" name="billing_address" value={formData.billing_address} onChange={handleChange} placeholder="Billing address" disabled={submitting} />
          </label>
          <label htmlFor="contact_person">
            Contact person
            <input id="contact_person" type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} placeholder="Primary contact" disabled={submitting} />
          </label>
          <label htmlFor="contact_number">
            Contact number
            <input id="contact_number" type="tel" name="contact_number" value={formData.contact_number} onChange={handleChange} placeholder="Phone number" disabled={submitting} />
          </label>
          <label htmlFor="email" className="form-span-2">
            Email
            <input id="email" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="supplier@example.com" disabled={submitting} />
          </label>
          <p className="form-page-section-title form-span-2">Bank details</p>
          <label htmlFor="bank_name">
            Bank name
            <input id="bank_name" type="text" name="bank_name" value={formData.bank_name} onChange={handleChange} placeholder="Bank name" disabled={submitting} />
          </label>
          <label htmlFor="account_number">
            Account number <span className="required-mark">*</span>
            <input id="account_number" type="text" name="account_number" value={formData.account_number} onChange={handleChange} placeholder="Supplier account number" required disabled={submitting} />
          </label>
          <label htmlFor="account_type">
            Account type
            <input id="account_type" type="text" name="account_type" value={formData.account_type} onChange={handleChange} placeholder="e.g., Current" disabled={submitting} />
          </label>
          <label htmlFor="IFSC">
            IFSC
            <input id="IFSC" type="text" name="IFSC" value={formData.IFSC} onChange={handleChange} placeholder="Bank IFSC" disabled={submitting} />
          </label>
          <label htmlFor="payment_details" className="form-span-2">
            Payment details
            <input id="payment_details" type="text" name="payment_details" value={formData.payment_details} onChange={handleChange} placeholder="Terms or payment notes" disabled={submitting} />
          </label>
          <label htmlFor="certificate" className="form-span-2">
            ISO certificate
            <FilePicker
              id="certificate"
              accept="image/*,application/pdf"
              disabled={submitting}
              fileName={certificate?.name}
              label={certificate ? 'Replace file' : 'Choose file'}
              onChange={setCertificate}
            />
          </label>
        </div>
        <FormActions
          saving={submitting}
          onCancel={() => navigate('/suppliers')}
          saveLabel={submitting ? 'Creating…' : 'Create supplier'}
        />
      </form>
    </FormPage>
  );
}
