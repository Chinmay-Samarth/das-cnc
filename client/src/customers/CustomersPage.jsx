import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { ListPage, EmptyState } from '../components/mes';
import TableColumnPicker from '../components/shared/TableColumnPicker';
import useTableColumns from '../components/shared/useTableColumns';
import { sortBy } from '../utils/listHelpers';

const CUSTOMER_COLUMNS = [
  {
    id: 'name',
    label: 'Customer',
    section: 'Basic',
    default: true,
    getValue: (row) => row.name || '',
    render: (row) => (
      <>
        <strong>{row.name || '—'}</strong>
        <div className="table-subtext">
          {row.billing_address || row.official_address || 'No address saved'}
        </div>
      </>
    ),
  },
  {
    id: 'ledger_name',
    label: 'Ledger name',
    section: 'Basic',
    getValue: (row) => row.ledger_name || '',
  },
  {
    id: 'gstin',
    label: 'GSTIN',
    section: 'Basic',
    default: true,
    getValue: (row) => row.gstin || '',
  },
  {
    id: 'pan_no',
    label: 'PAN',
    section: 'Basic',
    default: true,
    getValue: (row) => row.pan_no || '',
  },
  {
    id: 'official_address',
    label: 'Official address',
    section: 'Address',
    getValue: (row) => row.official_address || '',
  },
  {
    id: 'billing_address',
    label: 'Billing address',
    section: 'Address',
    getValue: (row) => row.billing_address || '',
  },
  {
    id: 'contact_person',
    label: 'Contact',
    section: 'Contact',
    default: true,
    getValue: (row) => row.contact_person || '',
    render: (row) => (
      <>
        {row.contact_person || '—'}
        <div className="table-subtext">{row.contact_phone || '—'}</div>
      </>
    ),
  },
  {
    id: 'contact_phone',
    label: 'Phone',
    section: 'Contact',
    getValue: (row) => row.contact_phone || '',
  },
  {
    id: 'bank_name',
    label: 'Bank',
    section: 'Bank',
    default: true,
    getValue: (row) => row.bank_name || '',
    render: (row) => (
      <>
        {row.bank_name || '—'}
        <div className="table-subtext">{row.ifsc || '—'}</div>
      </>
    ),
  },
  {
    id: 'account_no',
    label: 'Account number',
    section: 'Bank',
    getValue: (row) => row.account_no || '',
  },
  {
    id: 'account_type',
    label: 'Account type',
    section: 'Bank',
    getValue: (row) => row.account_type || '',
  },
  {
    id: 'ifsc',
    label: 'IFSC',
    section: 'Bank',
    getValue: (row) => row.ifsc || '',
  },
  {
    id: 'payment_terms',
    label: 'Payment terms',
    section: 'Terms',
    getValue: (row) => row.payment_terms || '',
  },
  {
    id: 'components_per_packet',
    label: 'Components / packet',
    section: 'Terms',
    getValue: (row) =>
      row.components_per_packet == null || row.components_per_packet === ''
        ? ''
        : String(row.components_per_packet),
  },
];

export default function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { visibleColumns, columnGroups, toggleColumn, resetColumns } = useTableColumns(
    'das-cnc-customer-columns',
    CUSTOMER_COLUMNS
  );

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
      return CUSTOMER_COLUMNS.map((column) => column.getValue(customer))
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    const sortColumn = CUSTOMER_COLUMNS.find((column) => column.id === sortKey);
    return sortBy(matches, sortKey, sortAsc, (row) =>
      sortColumn ? sortColumn.getValue(row) : row[sortKey]
    );
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
          <TableColumnPicker
            columnGroups={columnGroups}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
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
                {visibleColumns.map((column) => (
                  <th key={column.id} onClick={() => handleSort(column.id)}>
                    {column.label}
                    <span className="sort-indicator">
                      {sortKey === column.id ? (sortAsc ? ' ▲' : ' ▼') : ''}
                    </span>
                  </th>
                ))}
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
                  {visibleColumns.map((column) => (
                    <td key={column.id}>
                      {column.render
                        ? column.render(customer)
                        : column.getValue(customer) || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  );
}
