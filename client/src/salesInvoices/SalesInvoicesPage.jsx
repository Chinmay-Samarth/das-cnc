import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, RefreshCw, Settings, Banknote } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge } from '../components/mes';
import { formatDisplayDate } from '../utils/dateFormat';
import { formatInr } from './downloadSalesInvoicePdf';
import { openSalesPaymentDialog } from './salesPaymentDialog';
import { appAlert } from '../components/dialog';

const TABS = [
  { id: 'due', label: 'Due' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

function statusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'ready';
  return 'pending';
}

export default function SalesInvoicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'due';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, tallyRes] = await Promise.all([
        api.get('/sales-invoices', { params: { status: tab } }),
        api.get('/sales-invoices/tally/status'),
      ]);
      setRows(invRes.data.sales_invoices || []);
      setTallyEnabled(Boolean(tallyRes.data?.tally_enabled));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load sales invoices');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleBulkPay() {
    setPaying(true);
    try {
      const due = rows.filter((r) => r.status === 'due');
      if (!due.length) {
        await appAlert('No due invoices on this tab to pay');
        return;
      }
      // Prefer opening the shared dialog when all due rows share one customer
      const customerIds = [...new Set(due.map((r) => r.customer_id).filter(Boolean))];
      if (customerIds.length === 1 && tab === 'due') {
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

  const subtitle = useMemo(() => {
    if (tab === 'due') return 'Issued invoices awaiting payment';
    if (tab === 'paid') return 'Fully paid invoices with payment trail';
    return 'Cancelled invoices kept for GST numbering integrity';
  }, [tab]);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Accounts receivable"
        title="Sales Invoices"
        subtitle={subtitle}
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

      <div className="mes-view-toggle" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mes-view-toggle-btn${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setSearchParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !rows.length ? (
        <EmptyState
          icon={FileText}
          title={`No ${tab} invoices`}
          description="Create a sales invoice from Ready for Dispatch before shipping a lot."
          actionLabel="Open dispatch queue"
          onAction={() => navigate('/production/dispatch')}
        />
      ) : null}

      {!loading && rows.length ? (
        <div className="mes-task-queue">
          {rows.map((inv) => (
            <article
              key={inv.id}
              className="mes-task-card"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/sales-invoices/${inv.id}`)}
            >
              <div className="mes-task-top">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="mes-task-id">
                    <FileText size={15} />
                    <span>{inv.invoice_number || 'Draft'}</span>
                  </p>
                  <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
                    {inv.customer_name || 'Customer'}
                  </h2>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    ₹{formatInr(inv.total_amount)}
                    {inv.due_date ? ` · Due ${formatDisplayDate(inv.due_date)}` : ''}
                    {inv.printed_at ? ' · Printed' : ''}
                    {inv.packing_slip_printed_at ? ' · Packing slip' : ''}
                    {inv.dispatched_at ? ' · Dispatched' : ''}
                    {inv.tally_sync_status ? ` · Sales ${inv.tally_sync_status}` : ''}
                    {inv.tally_receipt_sync_status
                      ? ` · Receipt ${inv.tally_receipt_sync_status}`
                      : ''}
                    {inv.payment_transaction_id
                      ? ` · Txn ${inv.payment_transaction_id}`
                      : ''}
                  </p>
                </div>
                <StatusBadge status={statusTone(inv.status)}>
                  {String(inv.status || '').toUpperCase()}
                </StatusBadge>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link
                  to={`/sales-invoices/${inv.id}`}
                  className="mes-btn mes-btn-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                </Link>
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
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
