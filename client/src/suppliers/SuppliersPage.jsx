import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { ListPage, EmptyState } from '../components/mes';
import TableColumnPicker from '../components/shared/TableColumnPicker';
import useTableColumns from '../components/shared/useTableColumns';
import { sortBy } from '../utils/listHelpers';

const SUPPLIER_COLUMNS = [
  {
    id: 'name',
    label: 'Supplier',
    section: 'Basic',
    default: true,
    getValue: (row) => row.name || '',
    render: (row) => <strong>{row.name || '—'}</strong>,
  },
  {
    id: 'ledger_name',
    label: 'Ledger name',
    section: 'Basic',
    getValue: (row) => row.ledger_name || '',
  },
  {
    id: 'GSTIN',
    label: 'GSTIN',
    section: 'Basic',
    default: true,
    getValue: (row) => row.GSTIN || '',
  },
  {
    id: 'PAN_no',
    label: 'PAN',
    section: 'Basic',
    getValue: (row) => row.PAN_no || '',
  },
  {
    id: 'tally_expense_ledger_type',
    label: 'Product / service type',
    section: 'Basic',
    getValue: (row) => row.tally_expense_ledger_type || '',
    render: (row) => {
      const map = {
        labour: 'Labour',
        labour_service: 'Labour Service',
        consumable: 'Consumable',
        raw_material: 'Raw Material',
        spares_and_tools: 'Spares and Tools',
      };
      return map[row.tally_expense_ledger_type] || row.tally_expense_ledger_type || '—';
    },
  },
  {
    id: 'customer_recommended',
    label: 'Supplier type',
    section: 'Basic',
    getValue: (row) => (row.customer_recommended ? 'Customer recommended' : 'Standard'),
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
        <div className="table-subtext">{row.contact_number || '—'}</div>
      </>
    ),
  },
  {
    id: 'contact_number',
    label: 'Phone',
    section: 'Contact',
    getValue: (row) => row.contact_number || '',
  },
  {
    id: 'email',
    label: 'Email',
    section: 'Contact',
    default: true,
    getValue: (row) => row.email || '',
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
        <div className="table-subtext">{row.IFSC || '—'}</div>
      </>
    ),
  },
  {
    id: 'account_number',
    label: 'Account number',
    section: 'Bank',
    getValue: (row) => row.account_number || '',
  },
  {
    id: 'account_type',
    label: 'Account type',
    section: 'Bank',
    getValue: (row) => row.account_type || '',
  },
  {
    id: 'IFSC',
    label: 'IFSC',
    section: 'Bank',
    getValue: (row) => row.IFSC || '',
  },
  {
    id: 'payment_details',
    label: 'Payment details',
    section: 'Bank',
    getValue: (row) => row.payment_details || '',
  },
  {
    id: 'credit_period_days',
    label: 'Due date credit days',
    section: 'Terms',
    getValue: (row) =>
      row.credit_period_days == null || row.credit_period_days === ''
        ? ''
        : String(row.credit_period_days),
    render: (row) =>
      row.credit_period_days == null || row.credit_period_days === ''
        ? '—'
        : `${row.credit_period_days} days`,
  },
  {
    id: 'lead_time_days',
    label: 'Lead time days',
    section: 'Terms',
    getValue: (row) =>
      row.lead_time_days == null || row.lead_time_days === '' ? '' : String(row.lead_time_days),
    render: (row) =>
      row.lead_time_days == null || row.lead_time_days === ''
        ? '—'
        : `${row.lead_time_days} days`,
  },
];

export default function SuppliersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { visibleColumns, columnGroups, toggleColumn, resetColumns } = useTableColumns(
    'das-cnc-supplier-columns',
    SUPPLIER_COLUMNS
  );

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
      return SUPPLIER_COLUMNS.map((column) => column.getValue(supplier))
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    const sortColumn = SUPPLIER_COLUMNS.find((column) => column.id === sortKey);
    return sortBy(matches, sortKey, sortAsc, (row) =>
      sortColumn ? sortColumn.getValue(row) : row[sortKey]
    );
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
    <ListPage
      eyebrow="Vendor management"
      title="Suppliers"
      subtitle="Search, sort, and browse supplier records from one place."
      error={error}
      filters={
        <div className="employees-actions">
          <input
            type="search"
            placeholder="Search suppliers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="search-input"
            aria-label="Search suppliers"
          />
          <TableColumnPicker
            columnGroups={columnGroups}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
          <button type="button" className="primary-button" onClick={() => navigate('/suppliers/add')}>
            Add Supplier
          </button>
        </div>
      }
    >
      {loading ? <p className="muted">Loading suppliers...</p> : null}
      {!loading && filteredSuppliers.length === 0 ? (
        <EmptyState title="No suppliers found" description="Try adjusting your search." />
      ) : (
        <div className="employees-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th className="col-sno">#</th>
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
              {filteredSuppliers.map((supplier, index) => (
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
                  <td className="col-sno">{index + 1}</td>
                  {visibleColumns.map((column) => (
                    <td key={column.id}>
                      {column.render
                        ? column.render(supplier)
                        : column.getValue(supplier) || '—'}
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
