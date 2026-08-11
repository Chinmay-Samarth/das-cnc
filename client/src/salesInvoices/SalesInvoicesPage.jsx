import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, RefreshCw, Settings } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge } from '../components/mes';
import { formatDisplayDate } from '../utils/dateFormat';
import { formatInr } from './downloadSalesInvoicePdf';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/sales-invoices', { params: { status: tab } });
      setRows(data.sales_invoices || []);
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
                    {inv.payment_transaction_id
                      ? ` · Txn ${inv.payment_transaction_id}`
                      : ''}
                  </p>
                </div>
                <StatusBadge status={statusTone(inv.status)}>
                  {String(inv.status || '').toUpperCase()}
                </StatusBadge>
              </div>
              <div style={{ marginTop: 10 }}>
                <Link
                  to={`/sales-invoices/${inv.id}`}
                  className="mes-btn mes-btn-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
