import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, Eye, RefreshCw, Search } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge, SkeletonList } from '../components/mes';
import { appAlert } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';
import {
  openPurchasePaymentDialog,
  formatInr,
  invoiceDueAmount,
} from './purchasePaymentDialog';

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function isPaymentOverdue(inv) {
  const due = String(inv?.due_date || '').slice(0, 10);
  if (!due) return false;
  return due < todayYmd();
}

export default function PurchasePaymentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedSupplierId = searchParams.get('supplierId');
  const highlightInvoiceId = searchParams.get('highlightInvoice');

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tallyEnabled, setTallyEnabled] = useState(false);
  const [outstanding, setOutstanding] = useState(null);
  const [highlightId, setHighlightId] = useState(highlightInvoiceId);
  const highlightRowRef = useRef(null);
  const skipClearSelectionRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, supRes, tallyRes] = await Promise.all([
        api.get('/invoices/payable'),
        api.get('/suppliers'),
        api.get('/invoices/tally/status'),
      ]);
      setRows(invRes.data.invoices || []);
      setSuppliers(supRes.data.suppliers || []);
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
    if (highlightInvoiceId) return;
    if (!preselectedSupplierId || !suppliers.length) return;
    const match = suppliers.find((s) => s.id === preselectedSupplierId);
    if (match?.name) setSearch(match.name);
  }, [preselectedSupplierId, suppliers, highlightInvoiceId]);

  useEffect(() => {
    if (skipClearSelectionRef.current) {
      skipClearSelectionRef.current = false;
      return;
    }
    setSelected(new Set());
  }, [search]);

  useEffect(() => {
    setHighlightId(highlightInvoiceId);
  }, [highlightInvoiceId]);

  useEffect(() => {
    if (!highlightInvoiceId || !rows.length) return;
    const inv = rows.find((r) => String(r.id) === String(highlightInvoiceId));
    if (!inv) return;
    skipClearSelectionRef.current = true;
    setSearch(inv.invoice_number || inv.supplier_name || '');
    setSelected(new Set([inv.id]));
    setHighlightId(inv.id);
  }, [highlightInvoiceId, rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const supplier = String(r.supplier_name || r.suppliers?.name || '').toLowerCase();
      const ledger = String(r.ledger_name || r.suppliers?.ledger_name || '').toLowerCase();
      const invoice = String(r.invoice_number || '').toLowerCase();
      return supplier.includes(q) || ledger.includes(q) || invoice.includes(q);
    });
  }, [rows, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const inv of filtered) {
      const key = inv.supplier_id || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          supplier_id: inv.supplier_id,
          supplier_name: inv.supplier_name || inv.suppliers?.name || 'Supplier',
          ledger_name: inv.ledger_name || inv.suppliers?.ledger_name || null,
          invoices: [],
        });
      }
      map.get(key).invoices.push(inv);
    }
    return [...map.values()];
  }, [filtered]);

  useEffect(() => {
    if (!highlightId || !highlightRowRef.current) return;
    highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, grouped]);

  const activeSupplierId = useMemo(() => {
    if (grouped.length === 1) return grouped[0].supplier_id || null;
    return null;
  }, [grouped]);

  useEffect(() => {
    let cancelled = false;
    async function loadOutstanding() {
      if (!tallyEnabled || !activeSupplierId) {
        setOutstanding(null);
        return;
      }
      try {
        const { data } = await api.get(
          `/invoices/tally/supplier-outstanding/${activeSupplierId}`
        );
        if (!cancelled) setOutstanding(data);
      } catch (err) {
        if (!cancelled) {
          setOutstanding({
            outstanding: null,
            error: err.response?.data?.error || 'Unable to load Tally payable',
          });
        }
      }
    }
    loadOutstanding();
    return () => {
      cancelled = true;
    };
  }, [activeSupplierId, tallyEnabled]);

  const selectedInvoices = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected]
  );

  const selectedTotal = useMemo(
    () => selectedInvoices.reduce((s, inv) => s + invoiceDueAmount(inv), 0),
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
    const supplierIds = [...new Set(selectedInvoices.map((i) => i.supplier_id))];
    if (supplierIds.length !== 1) {
      await appAlert('Select invoices from a single supplier for bulk payment');
      return;
    }
    const group = grouped.find((g) => g.supplier_id === supplierIds[0]);
    const sup =
      suppliers.find((s) => s.id === supplierIds[0]) ||
      {
        id: supplierIds[0],
        name: group?.supplier_name || selectedInvoices[0].supplier_name,
        ledger_name: group?.ledger_name,
      };

    setBusy(true);
    try {
      const data = await openPurchasePaymentDialog({
        supplierId: sup.id,
        supplierName: sup.name,
        ledgerName: sup.ledger_name,
        invoices: selectedInvoices,
        tallyEnabled,
        mode: selectedInvoices.length > 1 ? 'bulk' : 'single',
      });
      if (!data) return;
      await appAlert({
        title: 'Payment recorded',
        message:
          data.payment_sync?.status === 'synced'
            ? 'Payment voucher synced to Tally'
            : data.payment_sync?.error ||
              data.invoice?.tally_payment_sync_error ||
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
        eyebrow="Accounts payable"
        title="Purchase payments"
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
            placeholder="Search suppliers or invoice numbers…"
            aria-label="Search suppliers or invoices"
          />
        </label>
        {selectedInvoices.length ? (
          <p className="payments-meta">
            Selected · <strong>₹{formatInr(selectedTotal)}</strong>
          </p>
        ) : null}
        {activeSupplierId && outstanding ? (
          <p className="payments-meta">
            Tally payable ·{' '}
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
              ? 'Try a different supplier name or invoice number.'
              : 'Unpaid purchase invoices appear here for bulk payment.'
          }
          actionLabel={search.trim() ? 'Clear search' : 'Purchase invoices'}
          onAction={() => (search.trim() ? setSearch('') : navigate('/invoices'))}
        />
      ) : null}

      {!loading &&
        grouped.map((group) => {
          const allSelected = group.invoices.every((inv) => selected.has(inv.id));
          return (
            <section
              key={group.supplier_id || group.supplier_name}
              className="mes-card payments-group"
            >
              <div className="payments-group-head">
                <div>
                  <h2>{group.supplier_name}</h2>
                  <p>
                    {group.invoices.length} due · ₹
                    {formatInr(
                      group.invoices.reduce((s, inv) => s + invoiceDueAmount(inv), 0)
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
                      <th>Amount due</th>
                      <th className="payments-view-col" aria-label="View" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.invoices.map((inv, index) => {
                      const isSelected = selected.has(inv.id);
                      const isOverdue = isPaymentOverdue(inv);
                      const isHighlighted =
                        highlightId && String(inv.id) === String(highlightId);
                      const rowClass = [
                        isSelected ? 'is-selected' : '',
                        isOverdue ? 'is-overdue' : '',
                        isHighlighted ? 'is-alert-highlight' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <tr
                          key={inv.id}
                          ref={isHighlighted ? highlightRowRef : undefined}
                          className={rowClass || undefined}
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
                              {Number(inv.po_advance_amount) > 0 ? (
                                <StatusBadge status="completed">Advance</StatusBadge>
                              ) : null}
                            </span>
                          </td>
                          <td>{inv.due_date ? formatDisplayDate(inv.due_date) : '—'}</td>
                          <td>₹{formatInr(invoiceDueAmount(inv))}</td>
                          <td className="payments-view-col">
                            <button
                              type="button"
                              className="payments-eye"
                              title="View invoice"
                              aria-label={`View invoice ${inv.invoice_number || ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/invoices/${inv.id}`);
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
