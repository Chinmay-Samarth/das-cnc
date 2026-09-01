import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { ListPage, EmptyState } from '../components/mes';
import { sortBy } from '../utils/listHelpers';

export default function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadCustomers() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get('/customers');
        if (!mounted) return;
        setCustomers(data.customers || []);
      } catch (err) {
        console.error('Failed to load customers:', err);
        if (!mounted) return;
        setError('Unable to load customer data.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadCustomers();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = customers.filter((customer) => {
      if (!query) return true;
      return [
        customer.name,
        customer.gstin,
        customer.pan_no,
        customer.contact_person,
        customer.contact_phone,
        customer.bank_name,
        customer.ifsc,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc);
  }, [search, sortKey, sortAsc, customers]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <ListPage
      eyebrow="Customer management"
      title="Customers"
      subtitle="Search, sort, and browse customer records from one place."
      error={error}
      filters={
        <div className="employees-actions">
          <input
            type="search"
            placeholder="Search customers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="search-input"
            aria-label="Search customers"
          />
          <button type="button" className="primary-button" onClick={() => navigate('/customers/add')}>
            Add Customer
          </button>
        </div>
      }
    >
      {loading ? <p className="muted">Loading customers...</p> : null}
      {!loading && filteredCustomers.length === 0 ? (
        <EmptyState title="No customers found" description="Try adjusting your search." />
      ) : (
        <div className="employees-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>
                  Customer<span className="sort-indicator">{sortKey === 'name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('gstin')}>
                  GSTIN<span className="sort-indicator">{sortKey === 'gstin' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('contact_person')}>
                  Contact<span className="sort-indicator">{sortKey === 'contact_person' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('pan_no')}>
                  PAN<span className="sort-indicator">{sortKey === 'pan_no' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('bank_name')}>
                  Bank<span className="sort-indicator">{sortKey === 'bank_name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer) => (
                <tr
                  key={customer.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/customers/${customer.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/customers/${customer.id}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{customer.name}</strong>
                    <div className="table-subtext">{customer.billing_address || customer.official_address || 'No address saved'}</div>
                  </td>
                  <td>{customer.gstin || '--'}</td>
                  <td className="hide-mobile">
                    {customer.contact_person || '--'}
                    <div className="table-subtext">{customer.contact_phone || '--'}</div>
                  </td>
                  <td className="hide-mobile">{customer.pan_no || '--'}</td>
                  <td>
                    {customer.bank_name || '--'}
                    <div className="table-subtext">{customer.ifsc || '--'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  );
}
