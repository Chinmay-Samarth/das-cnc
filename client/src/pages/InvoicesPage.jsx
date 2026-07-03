import { useEffect, useMemo, useState } from 'react';
import AddInvoiceButton from '../components/Invoices/AddInvoiceButton';
import InvoiceDetails from '../components/Invoices/InvoiceDetails';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const fmt = (val) => isNaN(Number(val)) || val == null
? '—'
: Number(val).toLocaleString('en-IN')

const sortBy = (rows, key, asc) => {
  return [...rows].sort((a, b) => {
    const getValue = (row) => key === 'supplier_name'
      ? row.suppliers?.name ?? row.supplier_name ?? ''
      : row[key] ?? '';
    const left = String(getValue(a)).toLowerCase();
    const right = String(getValue(b)).toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState("invoice_date")
  const [sortAsc, setSortAsc] = useState(false)
  const navigate = useNavigate()

  async function loadInvoices() {
    let mounted = true
    try {
      setLoading(true);
      const { data } = await api.get('/invoices/list');
      console.dir(data[0], {depth: null})
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

  const filteredInvoices = useMemo(()=>{
    const query = search.trim().toLowerCase();
    const matches = invoices.filter((invoice)=>{
      if(!query) return true;
      return[
        invoice.suppliers?.name,
        invoice.invoice_number,
        invoice.invoice_date,
        invoice.total_amount,
        invoice.due_date
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })

    return sortBy(matches, sortKey, sortAsc)
  },[invoices, search, sortKey, sortAsc])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

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
            <input
              type="search"
              placeholder="Search invoices..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search invoices"
            />
            <div>
              <AddInvoiceButton onUploaded={async() => await loadInvoices()} />
            </div>
          </div>
        </div>

        
        {loading ? (<p className="muted">Loading invoices…</p>
        ) : (
          <div className="employees-table-wrap">
            <table className="app-table">
              {error ? <p className="error-message">{error}</p> : null}
              <thead>
                <tr>
                  <th onClick={()=> handleSort('supplier_name')}>
                    Vendor </th>
                  <th onClick={()=> handleSort('invoice_number')}>
                    Invoice # <span className="sort-indicator">{sortKey === 'invoice_number' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span></th>
                  <th onClick={()=> handleSort('invoice_date')}>
                    Date <span className="sort-indicator">{sortKey ==='invoice_date' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span></th>
                  <th onClick={()=> handleSort('total_amount')}>
                    Total <span className="sort-indicator">{sortKey === 'total_amount' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span></th>
                  <th onClick={()=> handleSort('due_date')}>
                    Due Date <span className="sort-indicator">{sortKey === 'due_date' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((item) => (
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
                    <td>{item.suppliers?.name || '—'}</td>
                    <td>{item.invoice_number || '—'}</td>
                    <td>{item.invoice_date || item.created_at || '—'}</td>
                    <td >₹{fmt(item.total_amount) || '—'}</td>
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
