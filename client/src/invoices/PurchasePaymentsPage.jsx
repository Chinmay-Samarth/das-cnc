import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banknote, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { PageHeader, EmptyState, StatusBadge } from '../components/mes';
import { appAlert } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';
import {
  openPurchasePaymentDialog,
  formatInr,
  invoiceDueAmount,
} from './purchasePaymentDialog';

export default function PurchasePaymentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedSupplierId = searchParams.get('supplierId');

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(preselectedSupplierId || '');
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
    if (preselectedSupplierId) setSupplierId(preselectedSupplierId);
  }, [preselectedSupplierId]);

  useEffect(() => {
    setSelected(new Set());
  }, [supplierId]);

  useEffect(() => {
    let cancelled = false;
    async function loadOutstanding() {
      if (!tallyEnabled || !supplierId) {
        setOutstanding(null);
        return;
      }
      try {
        const { data } = await api.get(
          `/invoices/tally/supplier-outstanding/${supplierId}`
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
  }, [supplierId, tallyEnabled]);

  const filtered = useMemo(() => {
    if (!supplierId) return rows;
    return rows.filter((r) => r.supplier_id === supplierId);
  }, [rows, supplierId]);

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
    <main className="mes-shell">
      <PageHeader
        eyebrow="Accounts payable"
        title="Purchase payments"
        subtitle="Record bulk payments when settling several supplier invoices together"
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
          Supplier
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 4 }}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {selectedInvoices.length ? (
          <p className="muted" style={{ margin: 0 }}>
            Selected total: <strong>₹{formatInr(selectedTotal)}</strong>
          </p>
        ) : null}
        {supplierId && outstanding ? (
          <p className="muted" style={{ margin: 0 }}>
            Payable (Tally):{' '}
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
          description="Unpaid purchase invoices appear here for bulk payment."
          actionLabel="Purchase invoices"
          onAction={() => navigate('/invoices')}
        />
      ) : null}

      {!loading &&
        grouped.map((group) => (
          <section
            key={group.supplier_id || group.supplier_name}
            className="mes-card"
            style={{ marginBottom: 16, padding: 16 }}
          >
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
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{group.supplier_name}</h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {group.invoices.length} due invoice(s) · ₹
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
                    <th>Amount due</th>
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
                        {Number(inv.po_advance_amount) > 0 ? (
                          <StatusBadge status="completed">Advance</StatusBadge>
                        ) : null}
                      </td>
                      <td>
                        {inv.due_date ? formatDisplayDate(inv.due_date) : '—'}
                      </td>
                      <td>₹{formatInr(invoiceDueAmount(inv))}</td>
                      <td>
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          onClick={() => navigate(`/invoices/${inv.id}`)}
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
