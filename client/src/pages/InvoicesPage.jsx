import { useEffect, useState } from 'react';
import AddInvoiceButton from '../components/Invoices/AddInvoiceButton';
import InvoiceDetails from '../components/Invoices/InvoiceDetails';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const fmt = (val) => isNaN(Number(val)) || val == null
? '—'
: Number(val).toLocaleString('en-IN')


export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("")
  const navigate = useNavigate()

  async function loadInvoices() {
    let mounted = true
    try {
      setLoading(true);
      const { data } = await api.get('/invoices/list');
      setInvoices(data);
    } catch (err) {
      console.error('Failed to load invoices', err);
      setError(err.response?.data?.error || err.message || 'Unable to load invoices');
    } finally {
      setLoading(false);
    }

    return ()=>{
      mounted = false
    }
  }

  useEffect(() => {
    loadInvoices();
    console.log(invoices)
  }, []);

  return (
    <main className="app-shell ">
      <header className="app-header">
        <div className="header-title-block">
          <h1>Invoices</h1>
        </div>
      </header>

      <section className='card'>
        <div className="section-header employees-header">
          <div>
            <h2>Invoice list</h2>
            <p className="muted">Use the search field to filter.</p>
          </div>


          <div className="employees-actions">
            {/*//! Add filering function */}
            {/* <input
              type="search"
              placeholder="Search invoices..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search invoices"
            /> */}
            <div>
              <AddInvoiceButton onUploaded={() => loadInvoices()} />
            </div>
          </div>
        </div>

        {error ? <p className="error-message">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading invoices…</p>
        ) : (
          <div className="employees-table-wrap">
            <table className="employees-table">
              <thead>
                <tr>
                  <th onClick={()=> null}>Vendor <span className="sort-indicator"></span></th>
                  <th onClick={()=> null}>Invoice # <span className="sort-indicator"></span></th>
                  <th onClick={()=> null}>Date <span className="sort-indicator"></span></th>
                  <th onClick={()=> null}>Total <span className="sort-indicator"></span></th>
                  <th onClick={()=> null}>Due Date <span className="sort-indicator"></span></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((item) => (
                  <tr 
                  key={item.id} 
                  role='button'
                  tabIndex={0}
                  onClick={()=> navigate(`/invoices/${item.id}`)}
                  onKeyDown={(event)=>{
                    if(event.key === "Enter" || event.key === " "){
                      navigate(`/invoices/${item.id}`)
                    }
                  }}
                  style={{ cursor: 'pointer' }}>
                    <td>{item.supplier_name || '—'}</td>
                    <td>{item.invoice_number || '—'}</td>
                    <td>{item.invoice_date || item.created_at || '—'}</td>
                    <td>₹{fmt(item.total_amount) || '—'}</td>
                    <td>{item.due_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </section>
    </main>
  );
}
