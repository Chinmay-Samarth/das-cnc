import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge } from '../components/mes';
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
  const [customerId, setCustomerId] = useState(preselectedCustomerId || '');
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
    if (preselectedCustomerId) setCustomerId(preselectedCustomerId);
  }, [preselectedCustomerId]);

  useEffect(() => {
    setSelected(new Set());
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    async function loadOutstanding() {
      if (!tallyEnabled || !customerId) {
        setOutstanding(null);
        return;
      }
      try {
        const { data } = await api.get(
          `/sales-invoices/tally/customer-outstanding/${customerId}`
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
  }, [customerId, tallyEnabled]);

  const filtered = useMemo(() => {
    if (!customerId) return rows;
    return rows.filter((r) => r.customer_id === customerId);
  }, [rows, customerId]);

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
    <main className="mes-shell">
      <PageHeader
        eyebrow="Accounts receivable"
        title="Sales payments"
        subtitle="Record bulk receipts when customers pay several invoices together"
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

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
          marginBottom: 16,
        }}
      >
        <label style={{ minWidth: 240 }}>
          Customer
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {selectedInvoices.length ? (
          <p className="muted" style={{ margin: 0 }}>
            Selected total: <strong>₹{formatInr(selectedTotal)}</strong>
          </p>
        ) : null}
        {customerId && outstanding ? (
          <p className="muted" style={{ margin: 0 }}>
            Owes (Tally):{' '}
            <strong>
              {outstanding.outstanding != null
                ? `₹${formatInr(outstanding.outstanding)}`
                : outstanding.error || '—'}
            </strong>
          </p>
        ) : null}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !filtered.length ? (
        <EmptyState
          icon={Banknote}
          title="No due invoices"
          description="Issued sales invoices awaiting payment appear here for bulk receipt."
          actionLabel="Sales invoices"
          onAction={() => navigate('/sales-invoices')}
        />
      ) : null}

      {!loading &&
        grouped.map((group) => (
          <section key={group.customer_id || group.customer_name} className="mes-card" style={{ marginBottom: 16, padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{group.customer_name}</h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {group.invoices.length} due invoice(s) · ₹
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
                {group.invoices.every((inv) => selected.has(inv.id))
                  ? 'Clear selection'
                  : 'Select all'}
              </button>
            </div>
            <div className="attendance-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Invoice</th>
                    <th>Due</th>
                    <th>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggle(inv.id)}
                        />
                      </td>
                      <td>
                        <strong>{inv.invoice_number || '—'}</strong>
                        {inv.printed_at ? (
                          <StatusBadge status="completed">Printed</StatusBadge>
                        ) : null}
                      </td>
                      <td>
                        {inv.due_date ? formatDisplayDate(inv.due_date) : '—'}
                      </td>
                      <td>₹{formatInr(inv.total_amount)}</td>
                      <td>
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          onClick={() => navigate(`/sales-invoices/${inv.id}`)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </main>
  );
}
