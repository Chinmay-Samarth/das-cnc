import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { GIRN_CATEGORIES } from '../girn/girnCategoryConfig';
import StatTile from '../components/shared/StatTile';
import { useSocket } from '../socket/socketContext';
import { formatDisplayDateTime } from '../utils/dateFormat';

const fmt = (val) =>
  val == null || isNaN(Number(val)) ? '—' : Number(val).toLocaleString('en-IN');

const CATEGORY_OPTIONS = Object.entries(GIRN_CATEGORIES)
  .filter(([, cfg]) => cfg.updatesStock)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

const CATEGORY_COLORS = {
  raw_material: '#3730a3',
  component: '#166534',
  tool: '#854d0e',
  oil: '#1d4ed8',
  gauge: '#9d174d',
};

function CategoryBadge({ category, label }) {
  const color = CATEGORY_COLORS[category] || '#374151';
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        background: `${color}18`,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label || category}
    </span>
  );
}

function formatDate(iso) {
  return formatDisplayDateTime(iso);
}

export default function StockListPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortKey, setSortKey] = useState('current_stock');
  const [sortAsc, setSortAsc] = useState(false);

  const LIMIT = 50;

  const loadSummary = useCallback(async () => {
    const { data } = await api.get('/inventory/stock/summary');
    setSummary(data.summary || []);
  }, []);

  const loadStock = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const params = {
        page,
        limit: LIMIT,
        sort: sortKey,
        order: sortAsc ? 'asc' : 'desc',
      };
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (search.trim()) params.search = search.trim();

      const { data } = await api.get('/inventory/stock', { params });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Stock load error:', err);
      setError(err.response?.data?.error || 'Unable to load stock.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, categoryFilter, search, sortKey, sortAsc]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadStock(); }, [loadStock]);
  useEffect(() => { setPage(1); }, [categoryFilter, search, sortKey, sortAsc]);

  useEffect(() => {
    return subscribe('inventory:updated', () => {
      loadSummary();
      loadStock({ silent: true });
    });
  }, [subscribe, loadSummary, loadStock]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortArrow = (key) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  const summaryByCategory = Object.fromEntries(summary.map((s) => [s.category, s]));
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Inventory</p>
          <h1>Stock</h1>
          <p className="muted">Current balances by item and lot. Click a row for movement history.</p>
        </div>
      </header>

      <section className="card summary-single-card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <div className="inventory-metrics-grid">
          {CATEGORY_OPTIONS.map(({ value, label }) => {
            const entry = summaryByCategory[value] || { total_rows: 0, total_qty: 0 };
            const active = categoryFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setCategoryFilter(active ? 'all' : value)}
                style={{
                  border: active ? '2px solid #3730a3' : '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 8,
                  background: active ? '#eef2ff' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <StatTile
                  label={label}
                  value={fmt(entry.total_qty)}
                  accent={CATEGORY_COLORS[value]}
                  fontSize= {'35px'}
                />
                <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                  {entry.total_rows} lot{entry.total_rows === 1 ? '' : 's'}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Stock list</h2>
            <p className="muted">{total} row{total === 1 ? '' : 's'}</p>
          </div>
          <div className="employees-actions">
            <input
              type="search"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
              aria-label="Search stock"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="search-input"
              style={{ width: 'auto' }}
            >
              <option value="all">All categories</option>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error ? <p className="error-message">{error}</p> : null}
        {loading ? <p className="muted">Loading stock...</p> : null}

        {!loading && (
          <div className="employees-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('category')}>
                    Category<span className="sort-indicator">{sortArrow('category')}</span>
                  </th>
                  <th onClick={() => handleSort('label')}>
                    Item<span className="sort-indicator">{sortArrow('label')}</span>
                  </th>
                  <th>Lot</th>
                  <th onClick={() => handleSort('current_stock')}>
                    Qty<span className="sort-indicator">{sortArrow('current_stock')}</span>
                  </th>
                  <th>Unit</th>
                  <th className="hide-mobile">Last movement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/stock/${row.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/stock/${row.id}`);
                    }}
                  >
                    <td>
                      <CategoryBadge category={row.item_category} label={row.category_label} />
                    </td>
                    <td>
                      <strong>{row.item_label}</strong>
                    </td>
                    <td>{row.lot_number || '—'}</td>
                    <td>{fmt(row.current_stock)}</td>
                    <td>{row.unit || '—'}</td>
                    <td className="hide-mobile">{formatDate(row.last_movement_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">No stock rows found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalPages > 1 ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="muted">Page {page} of {totalPages}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
