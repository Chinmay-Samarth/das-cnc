import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Receipt, X } from 'lucide-react';
import AddInvoiceButton from '../components/Invoices/AddInvoiceButton';
import api from '../api/client';
import { formatDisplayDate, toISODateString } from '../utils/dateFormat';
import { PageHeader, EmptyState, StatusBadge, AlertBanner } from '../components/mes';
import { appAlert } from '../components/dialog';

const STATUS_OPTIONS = [
  { id: 'all', label: 'All statuses' },
  { id: 'due', label: 'Due' },
  { id: 'paid', label: 'Paid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'extracting', label: 'Extracting' },
  { id: 'saving', label: 'Saving' },
  { id: 'error', label: 'Error' },
];

function todayYmdIst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function invoiceDisplayStatus(invoice) {
  const raw = invoice?.status || 'pending';
  if (raw === 'paid') return 'paid';
  if (raw === 'extracting' || raw === 'saving' || raw === 'error') return raw;
  const due = invoice?.due_date ? String(invoice.due_date).slice(0, 10) : '';
  if (due && due < todayYmdIst()) return 'overdue';
  return 'due';
}

function statusLabel(status) {
  if (status === 'due') return 'DUE';
  if (status === 'paid') return 'PAID';
  if (status === 'overdue') return 'OVERDUE';
  return String(status || 'DUE').replace(/_/g, ' ').toUpperCase();
}

const fmt = (val) =>
  isNaN(Number(val)) || val == null
    ? '—'
    : Number(val).toLocaleString('en-IN');

function currentMonthRange() {
  const now = new Date();
  return {
    from: toISODateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODateString(now),
  };
}

function statusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'overdue' || status === 'error') return 'overdue';
  if (status === 'extracting' || status === 'saving') return 'running';
  if (status === 'due' || status === 'pending') return 'pending';
  return status || 'pending';
}

function sortBy(rows, key, asc) {
  return [...rows].sort((a, b) => {
    if (key === 'total_amount') {
      const left = Number(a.total_amount) || 0;
      const right = Number(b.total_amount) || 0;
      return asc ? left - right : right - left;
    }

    const getValue = (row) =>
      key === 'supplier_name'
        ? row.suppliers?.name ?? row.supplier_name ?? ''
        : row[key] ?? '';

    const left = String(getValue(a)).toLowerCase();
    const right = String(getValue(b)).toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
}

async function readExportError(err) {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || 'Unable to export invoices';
    } catch {
      return 'Unable to export invoices';
    }
  }
  return err.response?.data?.error || err.message || 'Unable to export invoices';
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const monthRange = useMemo(() => currentMonthRange(), []);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('invoice_date');
  const [sortAsc, setSortAsc] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState(monthRange.from);
  const [exportTo, setExportTo] = useState(monthRange.to);
  const [exporting, setExporting] = useState(false);

  const exportDateError = useMemo(() => {
    if (!exportOpen) return '';
    if (!exportFrom || !exportTo) return 'Select both a from and to date.';
    if (exportFrom > exportTo) return 'From date must be on or before the to date.';
    return '';
  }, [exportOpen, exportFrom, exportTo]);

  const loadInvoices = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/invoices/list');
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load invoices', err);
      setError(err.response?.data?.error || err.message || 'Unable to load invoices');
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = invoices.filter((invoice) => {
      const displayStatus = invoiceDisplayStatus(invoice);
      if (statusFilter !== 'all' && displayStatus !== statusFilter) return false;
      if (!query) return true;
      return [
        invoice.suppliers?.name,
        invoice.invoice_number,
        invoice.invoice_date,
        invoice.total_amount,
        invoice.due_date,
        invoice.status,
        invoice.customer_GSTIN,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc);
  }, [invoices, search, statusFilter, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortMark = (key) =>
    sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  function toggleExportPanel() {
    if (exportOpen) {
      setExportOpen(false);
      return;
    }
    setExportFrom(monthRange.from);
    setExportTo(monthRange.to);
    setExportOpen(true);
  }

  async function handleExport() {
    if (exportDateError) {
      await appAlert({
        title: 'Choose a date range',
        message: exportDateError,
        tone: 'danger',
      });
      return;
    }

    try {
      setExporting(true);
      const response = await api.get('/invoices/export', {
        params: { from: exportFrom, to: exportTo },
        responseType: 'blob',
      });

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `vendor-invoices-${exportFrom}-to-${exportTo}.xlsx`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Failed to export invoices', err);
      await appAlert({
        title: 'Export failed',
        message: await readExportError(err),
        tone: 'danger',
      });
    } finally {
      setExporting(false);
    }
  }

  const emptyTitle = search.trim() || statusFilter !== 'all'
    ? 'No matching invoices'
    : 'No invoices yet';
  const emptyDescription = search.trim() || statusFilter !== 'all'
    ? 'Try a different search or status filter.'
    : 'Upload a vendor invoice to start the accounts-payable list.';

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Accounts payable"
        title="Invoices"
        subtitle={`${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? '' : 's'}`}
        actions={
          <>
            <button
              type="button"
              className={`mes-btn ${exportOpen ? 'primary-button' : 'mes-btn-secondary'}`}
              onClick={toggleExportPanel}
              aria-expanded={exportOpen}
            >
              <Download size={15} />
              Export to Excel
            </button>
            <AddInvoiceButton onUploaded={loadInvoices} />
          </>
        }
      />

      {exportOpen ? (
        <section className="mes-card mes-export-panel" aria-label="Excel export date range">
          <div className="mes-export-panel-copy">
            <p className="mes-eyebrow">Excel export</p>
            <h2 className="mes-export-panel-title">Invoice date range</h2>
          </div>
          <div className="mes-filters mes-export-panel-fields">
            <label>
              From
              <input
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
              />
            </label>
            <div className="mes-export-panel-actions">
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={() => setExportOpen(false)}
                disabled={exporting}
              >
                <X size={15} />
                Cancel
              </button>
              <button
                type="button"
                className="mes-btn primary-button"
                onClick={handleExport}
                disabled={exporting || Boolean(exportDateError)}
              >
                <Download size={15} />
                {exporting ? 'Exporting…' : 'Download'}
              </button>
            </div>
          </div>
          {exportDateError ? (
            <p className="muted mes-export-panel-hint">{exportDateError}</p>
          ) : (
            <p className="muted mes-export-panel-hint">
              {formatDisplayDate(exportFrom)} – {formatDisplayDate(exportTo)}
            </p>
          )}
        </section>
      ) : null}

      <div className="mes-filters">
        <label style={{ flex: 1, minWidth: 220 }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vendor, invoice #, GSTIN…"
            aria-label="Search invoices"
          />
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      

      {error ? <AlertBanner title="Unable to load invoices">{error}</AlertBanner> : null}
      {loading ? <p className="muted">Loading invoices…</p> : null}

      {!loading && !filteredInvoices.length ? (
        <EmptyState
          icon={Receipt}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : null}

      {!loading && filteredInvoices.length ? (
        <section className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('supplier_name')} style={{ cursor: 'pointer' }}>
                    Vendor
                    <span className="sort-indicator">{sortMark('supplier_name')}</span>
                  </th>
                  <th onClick={() => handleSort('invoice_number')} style={{ cursor: 'pointer' }}>
                    Invoice #
                    <span className="sort-indicator">{sortMark('invoice_number')}</span>
                  </th>
                  <th onClick={() => handleSort('invoice_date')} style={{ cursor: 'pointer' }}>
                    Date
                    <span className="sort-indicator">{sortMark('invoice_date')}</span>
                  </th>
                  <th onClick={() => handleSort('total_amount')} style={{ cursor: 'pointer' }}>
                    Total
                    <span className="sort-indicator">{sortMark('total_amount')}</span>
                  </th>
                  <th onClick={() => handleSort('due_date')} style={{ cursor: 'pointer' }}>
                    Due date
                    <span className="sort-indicator">{sortMark('due_date')}</span>
                  </th>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                    Status
                    <span className="sort-indicator">{sortMark('status')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((item) => (
                  <tr
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/invoices/${item.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/invoices/${item.id}`);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{item.suppliers?.name || '—'}</td>
                    <td>{item.invoice_number || '—'}</td>
                    <td>{formatDisplayDate(item.invoice_date || item.created_at)}</td>
                    <td>₹{fmt(item.total_amount)}</td>
                    <td>{formatDisplayDate(item.due_date)}</td>
                    <td>
                      <StatusBadge status={statusTone(invoiceDisplayStatus(item))}>
                        {statusLabel(invoiceDisplayStatus(item))}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
