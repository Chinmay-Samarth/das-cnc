import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import { PageHeader, EmptyState, StatusBadge, AlertBanner, MetricCard, ProgressBar } from '../components/mes';
import { appAlert } from '../components/dialog';

function poStatusTone(status) {
  if (status === 'paid') return 'completed';
  if (status === 'cancelled') return 'overdue';
  if (status === 'due') return 'pending';
  if (status === 'delivered') return 'running';
  return 'draft';
}

function fmtMoney(val) {
  return `₹${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'due', label: 'Due' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function PurchaseOrdersTab() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [demand, setDemand] = useState([]);
  const [demandTotals, setDemandTotals] = useState({ item_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [demandOpen, setDemandOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [poRes, demandRes] = await Promise.all([
        api.get('/purchase-orders'),
        api.get('/purchase-orders/demand-summary'),
      ]);
      setRows(Array.isArray(poRes.data.purchase_orders) ? poRes.data.purchase_orders : []);
      setDemand(demandRes.data.items || []);
      setDemandTotals(demandRes.data.totals || { item_count: 0 });
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
      return [r.po_number, r.supplier_name, r.status, r.match_status, ...(r.girns || []).map((g) => g.girn_number)]
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
        message:
          data.message ||
          (count ? `Created ${count} draft PO(s) from active campaigns.` : 'No RM gaps for active campaigns.'),
        tone: count ? 'success' : 'info',
      });
      await load();
      if (count === 1 && data.purchase_orders[0]?.id) {
        navigate(`/purchase-orders/create?id=${data.purchase_orders[0].id}`);
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
        subtitle="Campaign demand, reorder gaps, drafts, and supplier orders"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="neutral-button" onClick={handleGenerate} disabled={generating}>
              <Sparkles size={16} />
              {generating ? 'Generating…' : 'Generate from campaigns'}
            </button>
            <button type="button" className="primary-button" onClick={() => navigate('/purchase-orders/create')}>
              <Plus size={16} />
              New PO wizard
            </button>
          </div>
        }
      />

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      <section className="mes-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Demand overview</h2>
          <button type="button" className="link-button" onClick={() => setDemandOpen((v) => !v)}>
            {demandOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {demandOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
          <MetricCard label="Items to order" value={demandTotals.item_count ?? demand.length} />
        </div>
        {demandOpen ? (
          loading && !demand.length ? (
            <p className="muted">Loading demand…</p>
          ) : demand.length === 0 ? (
            <EmptyState title="No reorder gaps" description="Stock covers campaign need and reorder levels." />
          ) : (
            <div className="app-table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Campaign need</th>
                  <th>On-hand</th>
                  <th>ROL gap</th>
                  <th>Open POs</th>
                  <th>Suggested qty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {demand.map((item) => (
                  <tr key={item.master_record_id}>
                    <td>
                      {item.item_label}
                      <div className="muted">{item.trigger_reason?.replace(/_/g, ' ')}</div>
                    </td>
                    <td>{item.campaign_requirement}</td>
                    <td>{item.on_hand}</td>
                    <td>{item.rol_gap}</td>
                    <td>{item.open_po_qty}</td>
                    <td>
                      {item.suggested_qty} {item.unit}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="neutral-button"
                        onClick={() =>
                          navigate(
                            `/purchase-orders/create?master_record_id=${item.master_record_id}&item_category=${item.item_category}`
                          )
                        }
                      >
                        <Plus size={16} />
                        Add to draft
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )
        ) : null}
      </section>

      <div className="toolbar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search PO number, supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={statusFilter === tab.id ? 'primary-button' : 'neutral-button'}
              onClick={() => setStatusFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !rows.length ? (
        <p className="muted">Loading purchase orders…</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No purchase orders" description="Create a draft from demand or the wizard." />
      ) : (
        <div className="app-table-wrap">
        <table className="app-table">
          <thead>
            <tr>
              <th>PO#</th>
              <th>Supplier</th>
              <th>GIRN</th>
              <th>Lines</th>
              <th>Fulfillment</th>
              <th>Total</th>
              <th>Delivery</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/purchase-orders/${row.id}`)}>
                <td>{row.po_number}</td>
                <td>{row.supplier_name || '—'}</td>
                <td>
                  {(row.girns || []).length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {row.girns.map((g) => (
                        <Link
                          key={g.id}
                          to={`/girn/${g.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {g.girn_number}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{row.line_count ?? '—'}</td>
                <td style={{ minWidth: 120 }}>
                  <ProgressBar value={row.fulfillment_pct || 0} max={100} />
                </td>
                <td>{fmtMoney(row.total_amount)}</td>
                <td>{row.expected_delivery_date ? formatDisplayDate(row.expected_delivery_date) : '—'}</td>
                <td>
                  <StatusBadge status={poStatusTone(row.status)}>{String(row.status || '').toUpperCase()}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
