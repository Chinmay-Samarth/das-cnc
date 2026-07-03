import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const sortBy = (rows, key, asc) => {
  return [...rows].sort((a, b) => {
    const left = String(a[key] || '').toLowerCase();
    const right = String(b[key] || '').toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
};

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadSuppliers() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get('/suppliers');
        if (!mounted) return;
        setSuppliers(data.suppliers || []);
      } catch (err) {
        console.error('Failed to load suppliers:', err);
        if (!mounted) return;
        setError('Unable to load supplier data.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadSuppliers();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = suppliers.filter((supplier) => {
      if (!query) return true;
      return [
        supplier.name,
        supplier.GSTIN,
        supplier.contact_person,
        supplier.contact_number,
        supplier.email,
        supplier.bank_name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc);
  }, [search, sortKey, sortAsc, suppliers]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Vendor management</p>
          <h1>Suppliers</h1>
          <p className="muted">Search, sort, and browse supplier records from one place.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Supplier list</h2>
            <p className="muted">Use the search field to filter names, GSTIN, contacts, or bank details.</p>
          </div>

          <div className="employees-actions">
            <input
              type="search"
              placeholder="Search suppliers..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search suppliers"
            />
            <button type="button" className="primary-button" onClick={() => navigate('/suppliers/add')}>
              Add Supplier
            </button>
          </div>
        </div>


        <div className="employees-table-wrap">
          <table className="app-table">
            {error ? <p className="error-message">{error}</p> : null}
            {loading ? <p className="muted">Loading suppliers...</p> : null}
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>
                  Supplier<span className="sort-indicator">{sortKey === 'name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('GSTIN')}>
                  GSTIN<span className="sort-indicator">{sortKey === 'GSTIN' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('contact_person')}>
                  Contact<span className="sort-indicator">{sortKey === 'contact_person' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('email')}>
                  Email<span className="sort-indicator">{sortKey === 'email' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('bank_name')}>
                  Bank<span className="sort-indicator">{sortKey === 'bank_name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/suppliers/${supplier.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/suppliers/${supplier.id}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{supplier.name}</strong>
                    {/* <div className="table-subtext">{supplier.billing_address || supplier.official_address || 'No address saved'}</div> */}
                  </td>
                  <td>{supplier.GSTIN || '--'}</td>
                  <td className="hide-mobile">
                    {supplier.contact_person || '--'}
                    <div className="table-subtext">{supplier.contact_number || '--'}</div>
                  </td>
                  <td className="hide-mobile">{supplier.email || '--'}</td>
                  <td>
                    {supplier.bank_name || '--'}
                    <div className="table-subtext">{supplier.IFSC || '--'}</div>
                  </td>
                </tr>
              ))}
              {!loading && filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="muted">
                    No matching suppliers found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
