import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';

const sortBy = (rows, key, asc) =>
  [...rows].sort((a, b) => {
    const left = String(a[key] ?? '').toLowerCase();
    const right = String(b[key] ?? '').toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });

function statusClass(status) {
  if (status === 'active') return 'status-pill status-active';
  if (status === 'draft') return 'status-pill';
  return 'status-pill status-inactive';
}

export default function BlanketPosPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('blanket_number');
  const [sortAsc, setSortAsc] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .get('/blanket-pos')
      .then(({ data }) => {
        if (!mounted) return;
        setRows(data.blanket_pos || []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load blanket POs.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = rows.filter((r) => {
      if (!q) return true;
      return [r.blanket_number, r.customer_name, r.status, r.payment_terms]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return sortBy(matches, sortKey, sortAsc);
  }, [rows, search, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const mark = (key) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Demand management</p>
          <h1>Blanket POs</h1>
          <p className="muted">
            Customer contracts with a locked part price and weekly delivery plan.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Blanket PO list</h2>
            <p className="muted">Search by number, customer, or status.</p>
          </div>
          <div className="employees-actions">
            <input
              type="search"
              className="search-input"
              placeholder="Search blanket POs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="primary-button" onClick={() => navigate('/blanket-pos/add')}>
              New contract
            </button>
          </div>
        </div>

        <div className="employees-table-wrap">
          {error ? <p className="error-message">{error}</p> : null}
          {loading ? <p className="muted">Loading...</p> : null}
          <table className="app-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('blanket_number')}>
                  Number<span className="sort-indicator">{mark('blanket_number')}</span>
                </th>
                <th onClick={() => handleSort('customer_name')}>
                  Customer<span className="sort-indicator">{mark('customer_name')}</span>
                </th>
                <th onClick={() => handleSort('status')}>
                  Status<span className="sort-indicator">{mark('status')}</span>
                </th>
                <th className="hide-mobile">Valid</th>
                <th onClick={() => handleSort('line_count')}>
                  Lines<span className="sort-indicator">{mark('line_count')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/blanket-pos/${r.id}`)}
                >
                  <td>
                    <strong>{r.blanket_number}</strong>
                  </td>
                  <td>{r.customer_name || '—'}</td>
                  <td>
                    <span className={statusClass(r.status)}>{r.status}</span>
                  </td>
                  <td className="hide-mobile">
                    {r.valid_from
                      ? `${formatDisplayDate(r.valid_from)} — ${r.valid_to ? formatDisplayDate(r.valid_to) : 'present'}`
                      : r.status === 'draft'
                        ? 'Not activated'
                        : '—'}
                  </td>
                  <td>{r.line_count ?? 0}</td>
                </tr>
              ))}
              {!loading && !filtered.length ? (
                <tr>
                  <td colSpan="5" className="muted">
                    No blanket POs found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
