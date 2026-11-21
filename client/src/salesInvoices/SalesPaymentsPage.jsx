import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, Eye, RefreshCw, Search } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge, SkeletonList } from '../components/mes';
import { appAlert } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';
import { formatInr } from './downloadSalesInvoicePdf';
import { openSalesPaymentDialog } from './salesPaymentDialog';

export default function SalesPaymentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedCustomerId = searchParams.get('customerId');

  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [outstanding, setOutstanding] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, custRes, tallyRes] = await Promise.all([
        api.get('/sales-invoices', { params: { status: 'due' } }),
        api.get('/customers'),
        api.get('/sales-invoices/tally/status'),
      ]);
      setRows(invRes.data.sales_invoices || []);
      setCustomers(custRes.data.customers || []);
      setTallyEnabled(Boolean(tallyRes.data?.tally_enabled));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load due invoices');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!preselectedCustomerId || !customers.length) return;
    const match = customers.find((c) => c.id === preselectedCustomerId);
    if (match?.name) setSearch(match.name);
  }, [preselectedCustomerId, customers]);

  useEffect(() => {
    setSelected(new Set());
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const customer = String(r.customer_name || '').toLowerCase();
      const ledger = String(r.ledger_name || '').toLowerCase();
      const invoice = String(r.invoice_number || '').toLowerCase();
      return customer.includes(q) || ledger.includes(q) || invoice.includes(q);
    });
  }, [rows, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const inv of filtered) {
      const key = inv.customer_id || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          customer_id: inv.customer_id,
          customer_name: inv.customer_name || 'Customer',
          invoices: [],
        });
      }
      map.get(key).invoices.push(inv);
    }
    return [...map.values()];
  }, [filtered]);

  const activeCustomerId = useMemo(() => {
    if (grouped.length === 1) return grouped[0].customer_id || null;
    return null;
  }, [grouped]);

  useEffect(() => {
    let cancelled = false;
    async function loadOutstanding() {
      if (!tallyEnabled || !activeCustomerId) {
        setOutstanding(null);
        return;
      }
      try {
        const { data } = await api.get(
          `/sales-invoices/tally/customer-outstanding/${activeCustomerId}`
        );
        if (!cancelled) setOutstanding(data);
      } catch (err) {
        if (!cancelled) {
          setOutstanding({
            outstanding: null,
            error: err.response?.data?.error || 'Unable to load Tally outstanding',
          });
        }
      }
    }
    loadOutstanding();
    return () => {
      cancelled = true;
    };
  }, [activeCustomerId, tallyEnabled]);

  const selectedInvoices = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected]
  );

  const selectedTotal = useMemo(
    () => selectedInvoices.reduce((s, inv) => s + Number(inv.total_amount || 0), 0),
    [selectedInvoices]
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(invoices) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = invoices.every((inv) => next.has(inv.id));
      for (const inv of invoices) {
        if (allSelected) next.delete(inv.id);
        else next.add(inv.id);
      }
      return next;
    });
  }

  async function handlePay() {
    if (!selectedInvoices.length) {
      await appAlert('Select one or more due invoices');
      return;
    }
    const customerIds = [...new Set(selectedInvoices.map((i) => i.customer_id))];
    if (customerIds.length !== 1) {
      await appAlert('Select invoices from a single customer for bulk payment');
      return;
    }
    const cust =
      customers.find((c) => c.id === customerIds[0]) ||
      { id: customerIds[0], name: selectedInvoices[0].customer_name };

    setBusy(true);
    try {
      const data = await openSalesPaymentDialog({
        customerId: cust.id,
        customerName: cust.name,
        ledgerName: cust.ledger_name,
        invoices: selectedInvoices,
        tallyEnabled,
        mode: selectedInvoices.length > 1 ? 'bulk' : 'single',
      });
      if (!data) return;
      await appAlert({
        title: 'Payment recorded',
        message:
          data.receipt_sync?.status === 'synced'
            ? 'Receipt voucher synced to Tally'
            : data.receipt_sync?.error ||
              data.sales_invoice?.tally_receipt_sync_error ||
              'Payment saved',
        tone: 'success',
      });
      setSelected(new Set());
      await load();
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mes-shell payments-page">
      <PageHeader
        eyebrow="Accounts receivable"
        title="Sales payments"
        actions={
          <>
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
              disabled={busy || !selectedInvoices.length}
              onClick={handlePay}
            >
              <Banknote size={15} />
              Pay selected ({selectedInvoices.length})
            </button>
          </>
        }
      />

      <div className="payments-toolbar">
        <label className="payments-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers or invoice numbers…"
            aria-label="Search customers or invoices"
          />
        </label>
        {selectedInvoices.length ? (
          <p className="payments-meta">
            Selected · <strong>₹{formatInr(selectedTotal)}</strong>
          </p>
        ) : null}
        {activeCustomerId && outstanding ? (
          <p className="payments-meta">
            Tally owes ·{' '}
            <strong>
              {outstanding.outstanding != null
                ? `₹${formatInr(outstanding.outstanding)}`
                : outstanding.error || '—'}
            </strong>
          </p>
        ) : null}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <SkeletonList embedded showHeader={false} showFilters={false} /> : null}

      {!loading && !filtered.length ? (
        <EmptyState
          icon={Banknote}
          title={search.trim() ? 'No matching invoices' : 'No due invoices'}
          description={
            search.trim()
              ? 'Try a different customer name or invoice number.'
              : 'Issued sales invoices awaiting payment appear here for bulk receipt.'
          }
          actionLabel={search.trim() ? 'Clear search' : 'Sales invoices'}
          onAction={() => (search.trim() ? setSearch('') : navigate('/sales-invoices'))}
        />
      ) : null}

      {!loading &&
        grouped.map((group) => {
          const allSelected = group.invoices.every((inv) => selected.has(inv.id));
          return (
            <section
              key={group.customer_id || group.customer_name}
              className="mes-card payments-group"
            >
              <div className="payments-group-head">
                <div>
                  <h2>{group.customer_name}</h2>
                  <p>
                    {group.invoices.length} due · ₹
                    {formatInr(
                      group.invoices.reduce((s, inv) => s + Number(inv.total_amount || 0), 0)
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="mes-btn mes-btn-secondary"
                  onClick={() => toggleGroup(group.invoices)}
                >
                  {allSelected ? 'Clear' : 'Select all'}
                </button>
              </div>

              <div className="payments-table-wrap">
                <table className="app-table payments-table">
                  <thead>
                    <tr>
                      <th className="col-sno">#</th>
                      <th className="payments-check-col" aria-label="Select" />
                      <th>Invoice</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th className="payments-view-col" aria-label="View" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.invoices.map((inv, index) => {
                      const isSelected = selected.has(inv.id);
                      return (
                        <tr
                          key={inv.id}
                          className={isSelected ? 'is-selected' : undefined}
                          onClick={() => toggle(inv.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggle(inv.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isSelected}
                        >
                          <td className="col-sno">{index + 1}</td>
                          <td className="payments-check-col">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggle(inv.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${inv.invoice_number || 'invoice'}`}
                            />
                          </td>
                          <td>
                            <span className="payments-invoice">
                              <strong>{inv.invoice_number || '—'}</strong>
                              {inv.printed_at ? (
                                <StatusBadge status="completed">Printed</StatusBadge>
                              ) : null}
                            </span>
                          </td>
                          <td>{inv.due_date ? formatDisplayDate(inv.due_date) : '—'}</td>
                          <td>₹{formatInr(inv.total_amount)}</td>
                          <td className="payments-view-col">
                            <button
                              type="button"
                              className="payments-eye"
                              title="View invoice"
                              aria-label={`View invoice ${inv.invoice_number || ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/sales-invoices/${inv.id}`);
                              }}
                            >
                              <Eye size={16} strokeWidth={1.75} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </main>
  );
}
