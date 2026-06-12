import { useEffect, useState } from 'react';
import api from '../api/client';
import AddInvoiceButton from '../components/Invoices/AddInvoiceButton';
import InvoiceDetails from '../components/Invoices/InvoiceDetails';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const { data } = await api.get('/invoices');
      setInvoices(data || []);
    } catch (err) {
      console.error('Failed to load invoices', err);
      setError(err.response?.data?.error || err.message || 'Unable to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="page-shell ">
      <header className="page-header">
        <h1>Invoices</h1>
        <div>
          <AddInvoiceButton onUploaded={() => load()} />
        </div>
      </header>

      {error ? <p className="error-message">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading invoices…</p>
      ) : (
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Total</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id || inv.invoice_number} onClick={() => setSelected(inv)} style={{ cursor: 'pointer' }}>
                  <td>{inv.vendor_name || '—'}</td>
                  <td>{inv.invoice_number || '—'}</td>
                  <td>{inv.invoice_date || inv.created_at || '—'}</td>
                  <td>{inv.total_amount || '—'}</td>
                  <td>
                    {inv.file_url ? (
                      <img src={inv.file_url} alt="invoice" style={{ height: 40, objectFit: 'cover' }} />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <InvoiceDetails invoice={selected} onClose={() => setSelected(null)} />
      ) : null}
    </main>
  );
}
