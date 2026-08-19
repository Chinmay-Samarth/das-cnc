import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart } from 'lucide-react';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import { PageHeader, EmptyState, StatusBadge, AlertBanner } from '../components/mes';
import { appAlert } from '../components/dialog';

function poStatusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'pending';
  return 'draft';
}

function fmtMoney(val) {
  return `₹${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function PurchaseOrdersTab() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/purchase-orders');
      setRows(Array.isArray(data.purchase_orders) ? data.purchase_orders : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load purchase orders.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.po_number, r.supplier_name, r.status, r.match_status]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, statusFilter]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { data } = await api.post('/purchase-orders/generate-from-campaigns');
      const count = data.purchase_orders?.length || 0;
      await appAlert({
        title: count ? 'Draft POs created' : 'Nothing to order',
        message: data.message || (count ? `Created ${count} draft PO(s) from active campaigns.` : 'No RM gaps for active campaigns.'),
        tone: count ? 'success' : 'info',
      });
      await load();
      if (count === 1 && data.purchase_orders[0]?.id) {
        navigate(`/purchase-orders/${data.purchase_orders[0].id}`);
      }
    } catch (err) {
      await appAlert({
        title: 'Generate failed',
        message: err.response?.data?.error || 'Unable to generate POs.',
        tone: 'danger',
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Procurement for raw materials and tools — admin only"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="neutral-button" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating…' : 'Generate from campaigns'}
            </button>
            <button type="button" className="primary-button" onClick={() => navigate('/purchase-orders/create')}>
              <Plus size={16} style={{ marginRight: 6, display: "inline" }} />
              New PO
            </button>
          </div>
        }
      />

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      <div className="toolbar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search PO number, supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="due">Due</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? <p className="muted">Loading purchase orders…</p> : null}
      {!loading && !filtered.length ? (
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders"
          description="Generate from active campaigns or create a new PO."
        />
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>PO #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Match</th>
                <th>Lines</th>
                <th>Fulfilled</th>
                <th>Total</th>
                <th>Expected delivery</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="clickable-row"
                  onClick={() => navigate(`/purchase-orders/${r.id}`)}
                >
                  <td><strong>{r.po_number}</strong></td>
                  <td>{r.supplier_name || '—'}</td>
                  <td>
                    <StatusBadge status={poStatusTone(r.status)}>{String(r.status || '').toUpperCase()}</StatusBadge>
                  </td>
                  <td>{r.match_status || 'pending'}</td>
                  <td>{r.line_count ?? '—'}</td>
                  <td>{r.fulfillment_pct != null ? `${r.fulfillment_pct}%` : '—'}</td>
                  <td>{fmtMoney(r.total_amount)}</td>
                  <td>{r.expected_delivery_date ? formatDisplayDate(r.expected_delivery_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
