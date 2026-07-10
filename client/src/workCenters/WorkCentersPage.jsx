import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const sortBy = (rows, key, asc) => {
  return [...rows].sort((a, b) => {
    const left = String(a[key] ?? '').toLowerCase();
    const right = String(b[key] ?? '').toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
};

export default function WorkCentersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('code');
  const [sortAsc, setSortAsc] = useState(true);
  const [workCenters, setWorkCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadWorkCenters() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get('/work-centers');
        if (!mounted) return;
        setWorkCenters(data.work_centers || []);
      } catch (err) {
        console.error('Failed to load work centers:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load work centers.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadWorkCenters();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = workCenters.filter((wc) => {
      if (!query) return true;
      return [
        wc.code,
        wc.name,
        wc.department,
        wc.is_active ? 'active' : 'inactive',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    return sortBy(matches, sortKey, sortAsc);
  }, [search, sortKey, sortAsc, workCenters]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortMark = (key) =>
    sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Production resources</p>
          <h1>Work Centers</h1>
          <p className="muted">
            Group machines by process (cutting, drilling, etc.) with capacity and cost rates for scheduling.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Work center list</h2>
            <p className="muted">Search by code, name, department, or status.</p>
          </div>

          <div className="employees-actions">
            <input
              type="search"
              placeholder="Search work centers..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search work centers"
            />
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate('/work-centers/add')}
            >
              Add Work Center
            </button>
          </div>
        </div>

        <div className="employees-table-wrap">
          {error ? <p className="error-message">{error}</p> : null}
          {loading ? <p className="muted">Loading work centers...</p> : null}
          <table className="app-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('code')}>
                  Code<span className="sort-indicator">{sortMark('code')}</span>
                </th>
                <th onClick={() => handleSort('name')}>
                  Name<span className="sort-indicator">{sortMark('name')}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('department')}>
                  Department<span className="sort-indicator">{sortMark('department')}</span>
                </th>
                <th onClick={() => handleSort('machine_count')}>
                  Machines<span className="sort-indicator">{sortMark('machine_count')}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('speed')}>
                  Speed<span className="sort-indicator">{sortMark('speed')}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('efficiency')}>
                  Efficiency<span className="sort-indicator">{sortMark('efficiency')}</span>
                </th>
                <th onClick={() => handleSort('is_active')}>
                  Status<span className="sort-indicator">{sortMark('is_active')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((wc) => (
                <tr
                  key={wc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/work-centers/${wc.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/work-centers/${wc.id}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{wc.code}</strong>
                  </td>
                  <td>{wc.name}</td>
                  <td className="hide-mobile">{wc.department || '—'}</td>
                  <td>{wc.machine_count ?? 0}</td>
                  <td className="hide-mobile">{wc.speed}</td>
                  <td className="hide-mobile">{wc.efficiency}%</td>
                  <td>
                    <span className={wc.is_active ? 'status-pill status-active' : 'status-pill status-inactive'}>
                      {wc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="muted">
                    No matching work centers found.
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
