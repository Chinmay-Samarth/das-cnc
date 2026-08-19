import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { FormActions, FormPage } from '../components/mes';
import { appAlert } from '../components/dialog';

const FIELDS = [
  ['legal_name', 'Legal name', true],
  ['trade_name', 'Trade name', false],
  ['gstin', 'GSTIN', true],
  ['state_code', 'State code', true],
  ['state', 'State', false],
  ['city', 'City', false],
  ['address_line1', 'Address line 1', false],
  ['address_line2', 'Address line 2', false],
  ['pan', 'PAN', false],
  ['phone', 'Phone', false],
  ['email', 'Email', false],
  ['bank_name', 'Bank name', false],
  ['bank_account', 'Bank account', false],
  ['ifsc', 'IFSC', false],
  ['invoice_prefix', 'Invoice prefix', true],
];

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get('/sales-invoices/company-settings');
        if (!mounted) return;
        setForm(data.company_settings || {});
      } catch (err) {
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load company settings');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = Object.fromEntries(FIELDS.map(([k]) => [k, form[k] ?? '']));
      const { data } = await api.patch('/sales-invoices/company-settings', payload);
      setForm(data.company_settings);
      await appAlert('Company settings saved');
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage
      eyebrow="Sales invoices"
      title="Company settings"
      subtitle="Seller details and invoice prefix used for new invoices."
      onBack={() => navigate('/sales-invoices')}
      backLabel="All invoices"
      error={error}
    >
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <form onSubmit={handleSave}>
          <div className="form-page-grid">
            {FIELDS.map(([key, label, required]) => (
              <label key={key} className={key.startsWith('address') ? 'form-span-2' : undefined}>
                {label}
                {required ? <span className="required-mark"> *</span> : null}
                <input
                  value={form[key] ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [key]:
                        key === 'state_code'
                          ? e.target.value.replace(/\D/g, '').slice(0, 2)
                          : e.target.value,
                    }))
                  }
                  required={required}
                  disabled={saving}
                />
              </label>
            ))}
          </div>
          <FormActions
            saving={saving}
            onCancel={() => navigate('/sales-invoices')}
            saveLabel={saving ? 'Saving…' : 'Save settings'}
          />
        </form>
      )}
    </FormPage>
  );
}
