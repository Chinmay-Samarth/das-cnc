import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { formatDisplayDate } from '../utils/dateFormat';
import { ListPage, EmptyState, StatusBadge } from '../components/mes';
import { sortBy } from '../utils/listHelpers';

const fmt = (val) =>
  val == null || isNaN(Number(val)) ? '—' : Number(val).toLocaleString('en-IN');

const STATUS_LABELS = {
  draft: 'Draft',
  pending_inspection: 'Pending Inspection',
  approved: 'Approved',
  rejected: 'Rejected',
};

function girnStatusTone(status) {
  if (status === 'approved') return 'completed';
  if (status === 'rejected') return 'overdue';
  if (status === 'pending_inspection') return 'running';
  return 'draft';
}

export default function GIRNListPage() {
  const navigate = useNavigate();
  const [girns, setGirns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('received_date');
  const [sortAsc, setSortAsc] = useState(false);
  const { subscribe } = useSocket();

  const loadGirns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await api.get('/girn');
      setGirns(data.girns || []);
    } catch (err) {
      console.error('Failed to load GIRNs:', err);
      setError(err.response?.data?.error || 'Unable to load GIRNs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGirns();
  }, [loadGirns]);

  useEffect(() => {
    const unsubscribe = subscribe('girn:updated', () => {
      loadGirns();
    });
    return unsubscribe;
  }, [subscribe, loadGirns]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = girns.filter((g) => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (!query) return true;
      return [g.girn_number, g.supplier_name, g.received_by_name, g.received_by_code, g.po_reference, g.purchase_order_number, g.csr]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    return sortBy(matches, sortKey, sortAsc);
  }, [girns, search, statusFilter, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortArrow = (key) =>
    sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  return (
    <ListPage
      eyebrow="Procurement"
      title="Goods Inwards Receipt Notes"
      subtitle="Track and manage all incoming raw material receipts."
      error={error}
      filters={
        <div className="employees-actions">
          <input
            type="search"
            placeholder="Search GIRNs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            aria-label="Search GIRNs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="search-input"
            style={{ width: 'auto' }}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_inspection">Pending Inspection</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            type="button"
            className="primary-button"
            onClick={() => navigate('/girn/create')}
          >
            <Plus size={16} />
            New GIRN
          </button>
        </div>
      }
    >
      {loading ? <p className="muted">Loading GIRNs...</p> : null}
      {!loading && filtered.length === 0 ? (
        <EmptyState title="No GIRNs found" description="Create a new GIRN or adjust your filters." />
      ) : (
        <div className="employees-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('girn_number')}>
                  GIRN Number<span className="sort-indicator">{sortArrow('girn_number')}</span>
                </th>
                <th onClick={() => handleSort('supplier_name')}>
                  Supplier<span className="sort-indicator">{sortArrow('supplier_name')}</span>
                </th>
                <th onClick={() => handleSort('purchase_order_number')}>
                  Purchase order<span className="sort-indicator">{sortArrow('purchase_order_number')}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('received_date')}>
                  Received Date<span className="sort-indicator">{sortArrow('received_date')}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('received_by_name')}>
                  Received By<span className="sort-indicator">{sortArrow('received_by_name')}</span>
                </th>
                <th onClick={() => handleSort('grand_total')}>
                  Grand Total<span className="sort-indicator">{sortArrow('grand_total')}</span>
                </th>
                <th onClick={() => handleSort('status')}>
                  Status<span className="sort-indicator">{sortArrow('status')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/girn/${g.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') navigate(`/girn/${g.id}`);
                  }}
                >
                  <td>
                    <strong>{g.girn_number}</strong>
                  </td>
                  <td>{g.supplier_name || '—'}</td>
                  <td>
                    {g.purchase_order_id ? (
                      <Link
                        to={`/purchase-orders/${g.purchase_order_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {g.purchase_order_number || g.po_reference || 'Open PO'}
                      </Link>
                    ) : (
                      g.po_reference || '—'
                    )}
                  </td>
                  <td className="hide-mobile">{formatDisplayDate(g.received_date)}</td>
                  <td className="hide-mobile">
                    {g.received_by_name || '—'}
                    {g.received_by_code ? (
                      <div className="table-subtext">{g.received_by_code}</div>
                    ) : null}
                  </td>
                  <td>₹{fmt(g.grand_total)}</td>
                  <td>
                    <StatusBadge status={girnStatusTone(g.status)}>
                      {STATUS_LABELS[g.status] || g.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  );
}
