import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, RefreshCw, Settings, Banknote } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge, AlertBanner } from '../components/mes';
import { formatDisplayDate } from '../utils/dateFormat';
import { formatInr } from './downloadSalesInvoicePdf';
import { openSalesPaymentDialog } from './salesPaymentDialog';
import { appAlert } from '../components/dialog';
import { sortBy } from '../utils/listHelpers';
import FormSearchSelect from '../components/shared/FormSearchSelect';

const STATUS_OPTIONS = [
  { value: 'due', label: 'Due' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'tally_unsynced', label: 'Not Tally synced' },
];

const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value));

function statusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'ready';
  return 'pending';
}

function statusLabel(status) {
  return String(status || '—').replace(/_/g, ' ').toUpperCase();
}

export default function SalesInvoicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = STATUS_VALUES.has(searchParams.get('tab'))
    ? searchParams.get('tab')
    : '';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [paying, setPaying] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('invoice_date');
  const [sortAsc, setSortAsc] = useState(false);

  function setStatusFilter(value) {
    if (!value) {
      setSearchParams({});
      return;
    }
    setSearchParams({ tab: value });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam =
        !statusFilter || statusFilter === 'tally_unsynced' ? undefined : statusFilter;
      const [invRes, tallyRes] = await Promise.all([
        api.get('/sales-invoices', {
          params: statusParam
            ? { status: statusParam }
            : { status: 'due,paid,cancelled' },
        }),
        api.get('/sales-invoices/tally/status'),
      ]);
      let list = invRes.data.sales_invoices || [];
      if (statusFilter === 'tally_unsynced') {
        list = list.filter(
          (inv) => inv.status !== 'cancelled' && inv.tally_sync_status !== 'synced'
        );
      }
      setRows(list);
      setTallyEnabled(Boolean(tallyRes.data?.tally_enabled));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load sales invoices');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = rows.filter((inv) => {
      if (!query) return true;
      return [
        inv.customer_name,
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date,
        inv.status,
        inv.tally_sync_status,
        inv.total_amount,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc, (row) => {
      if (sortKey === 'customer_name') return row.customer_name || '';
      if (sortKey === 'total_amount') return Number(row.total_amount) || 0;
      return row[sortKey] ?? '';
    });
  }, [rows, search, sortKey, sortAsc]);

  function handleSort(key) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const sortMark = (key) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  async function handleBulkPay() {
    setPaying(true);
    try {
      const due = rows.filter((r) => r.status === 'due');
      if (!due.length) {
        await appAlert('No due invoices to pay');
        return;
      }
      const customerIds = [...new Set(due.map((r) => r.customer_id).filter(Boolean))];
      if (customerIds.length === 1 && (!statusFilter || statusFilter === 'due')) {
        let ledgerName = '';
        let customerName = due[0].customer_name;
        try {
          const { data } = await api.get(`/customers/${customerIds[0]}`);
          ledgerName = data.customer?.ledger_name || '';
          customerName = data.customer?.name || customerName;
        } catch {
          /* ignore */
        }
        const data = await openSalesPaymentDialog({
          customerId: customerIds[0],
          customerName,
          ledgerName,
          invoices: due,
          tallyEnabled,
          mode: due.length > 1 ? 'bulk' : 'single',
        });
        if (!data) return;
        await appAlert({ title: 'Payment recorded', tone: 'success' });
        await load();
        return;
      }
      navigate('/sales-payments');
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  async function handlePayInvoice(inv, event) {
    event.stopPropagation();
    setPaying(true);
    try {
      let ledgerName = '';
      if (inv.customer_id) {
        try {
          const { data } = await api.get(`/customers/${inv.customer_id}`);
          ledgerName = data.customer?.ledger_name || '';
        } catch {
          /* ignore */
        }
      }
      const data = await openSalesPaymentDialog({
        customerId: inv.customer_id,
        customerName: inv.customer_name,
        ledgerName,
        invoices: [inv],
        tallyEnabled,
        mode: 'single',
      });
      if (!data) return;
      await appAlert({ title: 'Payment recorded', tone: 'success' });
      await load();
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  function openInvoice(inv) {
    navigate(`/sales-invoices/${inv.id}`);
  }

  const subtitle = useMemo(() => {
    if (statusFilter === 'due') return 'Issued invoices awaiting payment';
    if (statusFilter === 'paid') return 'Fully paid invoices with payment trail';
    if (statusFilter === 'tally_unsynced') return 'Due and paid invoices not yet synced to Tally';
    if (statusFilter === 'cancelled') {
      return 'Cancelled invoices kept for GST numbering integrity';
    }
    return 'All sales invoices';
  }, [statusFilter]);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Accounts receivable"
        title="Sales Invoices"
        subtitle={`${subtitle} · ${filteredRows.length} invoice${filteredRows.length === 1 ? '' : 's'}`}
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/sales-invoices/settings')}
            >
              <Settings size={15} />
              Company
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={handleBulkPay}
              disabled={paying}
            >
              <Banknote size={15} />
              Bulk pay
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              onClick={() => navigate('/production/dispatch')}
            >
              <Plus size={15} />
              From dispatch
            </button>
          </>
        }
      />

      <div className="mes-filters">
        <label style={{ flex: 1, minWidth: 220 }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, invoice #…"
            aria-label="Search sales invoices"
          />
        </label>
        <label>
          Status
          <FormSearchSelect
            value={statusFilter}
            onChange={(value) => setStatusFilter(value || '')}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            emptyMessage="No statuses"
          />
        </label>
      </div>

      {error ? <AlertBanner title="Unable to load invoices">{error}</AlertBanner> : null}
      {loading ? <p className="muted">Loading invoices…</p> : null}

      {!loading && !filteredRows.length ? (
        <EmptyState
          icon={FileText}
          title={
            search.trim() || statusFilter ? 'No matching invoices' : 'No sales invoices'
          }
          description={
            search.trim() || statusFilter
              ? 'Try a different search or status filter.'
              : 'Create a sales invoice from Ready for Dispatch before shipping a lot.'
          }
          actionLabel={
            search.trim() || statusFilter === 'tally_unsynced'
              ? undefined
              : 'Open dispatch queue'
          }
          onAction={
            search.trim() || statusFilter === 'tally_unsynced'
              ? undefined
              : () => navigate('/production/dispatch')
          }
        />
      ) : null}

      {!loading && filteredRows.length ? (
        <section className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('customer_name')} style={{ cursor: 'pointer' }}>
                    Customer
                    <span className="sort-indicator">{sortMark('customer_name')}</span>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((inv) => (
                  <tr
                    key={inv.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openInvoice(inv)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openInvoice(inv);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{inv.customer_name || '—'}</td>
                    <td>{inv.invoice_number || 'Draft'}</td>
                    <td>{formatDisplayDate(inv.invoice_date || inv.created_at)}</td>
                    <td>₹{formatInr(inv.total_amount)}</td>
                    <td>{formatDisplayDate(inv.due_date)}</td>
                    <td>
                      <div className="invoice-status-stack">
                        <StatusBadge status={statusTone(inv.status)}>
                          {statusLabel(inv.status)}
                        </StatusBadge>
                        {inv.tally_sync_status !== 'synced' && inv.status !== 'cancelled' ? (
                          <StatusBadge status="on_hold">
                            TALLY {String(inv.tally_sync_status || 'pending').toUpperCase()}
                          </StatusBadge>
                        ) : inv.tally_sync_status === 'synced' ? (
                          <StatusBadge status="completed">TALLY SYNCED</StatusBadge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {inv.status === 'due' ? (
                        <button
                          type="button"
                          className="mes-btn mes-btn-primary"
                          disabled={paying}
                          onClick={(e) => handlePayInvoice(inv, e)}
                        >
                          <Banknote size={14} />
                          Pay
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
