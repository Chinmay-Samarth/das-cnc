import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';

const fmt = (val) =>
  val == null || isNaN(Number(val)) ? '—' : Number(val).toLocaleString('en-IN');

const STATUS_LABELS = {
  draft: 'Draft',
  pending_inspection: 'Pending Inspection',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_STYLES = {
  draft: { background: '#f3f4f6', color: '#374151' },
  pending_inspection: { background: '#fef9c3', color: '#854d0e' },
  approved: { background: '#dcfce7', color: '#166534' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
};

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span
      style={{
        ...style,
        padding: '2px 10px',
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const sortBy = (rows, key, asc) =>
  [...rows].sort((a, b) => {
    const l = String(a[key] ?? '').toLowerCase();
    const r = String(b[key] ?? '').toLowerCase();
    if (l === r) return 0;
    return asc ? (l < r ? -1 : 1) : l > r ? -1 : 1;
  });

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
      return [g.girn_number, g.supplier_name, g.received_by_name, g.received_by_code, g.po_reference, g.csr]
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
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Procurement</p>
          <h1>Goods Inwards Receipt Notes</h1>
          <p className="muted">Track and manage all incoming raw material receipts.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>GIRN list</h2>
            <p className="muted">Click a row to view full details.</p>
          </div>

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
              New GIRN
            </button>
          </div>
        </div>

        {error ? <p className="error-message">{error}</p> : null}
        {loading ? <p className="muted">Loading GIRNs...</p> : null}

        {!loading && (
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
                      {g.po_reference ? (
                        <div className="table-subtext">PO: {g.po_reference}</div>
                      ) : null}
                    </td>
                    <td>{g.supplier_name || '—'}</td>
                    <td className="hide-mobile">{g.received_date || '—'}</td>
                    <td className="hide-mobile">
                      {g.received_by_name || '—'}
                      {g.received_by_code ? (
                        <div className="table-subtext">{g.received_by_code}</div>
                      ) : null}
                    </td>
                    <td>₹{fmt(g.grand_total)}</td>
                    <td>
                      <StatusBadge status={g.status} />
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No GIRNs found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
