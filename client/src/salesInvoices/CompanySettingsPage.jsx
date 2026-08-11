import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import api from '../api/client';
import { PageHeader } from '../components/mes';
import { appAlert } from '../components/dialog';

const FIELDS = [
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
  ['bank_name', 'Bank name'],
  ['bank_account', 'Bank account'],
  ['ifsc', 'IFSC'],
  ['invoice_prefix', 'Invoice prefix'],
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
    <main className="mes-shell">
      <PageHeader
        eyebrow="Sales invoices"
        title="Company settings"
        subtitle="Seller details and invoice prefix used for new invoices"
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => navigate('/sales-invoices')}
          >
            <ArrowLeft size={15} />
            Back
          </button>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <form className="mes-card" style={{ padding: 20 }} onSubmit={handleSave}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
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
                  required={['legal_name', 'gstin', 'state_code', 'invoice_prefix'].includes(key)}
                />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="mes-btn mes-btn-primary" disabled={saving}>
              <Save size={15} />
              Save
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
