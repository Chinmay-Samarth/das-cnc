import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket } from '../socket/socketContext';

function statusClass(status) {
  if (status === 'COMPLETED') return 'status-pill status-active';
  if (status === 'RUNNING') return 'status-pill';
  if (status === 'OVERDUE') return 'status-pill status-inactive';
  return 'status-pill';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProductionBoardPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .get('/employees')
      .then(({ data }) => setEmployees(data.employees || data || []))
      .catch(() => setEmployees([]));
  }, []);

  const loadCards = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await api.get('/production/cards', {
          params: {
            from: from || undefined,
            to: to || undefined,
            status: status || undefined,
            employee_id: employeeId || undefined,
          },
        });
        setCards(data.cards || []);
        setError(null);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load production cards.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [from, to, status, employeeId]
  );

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  useEffect(() => {
    return subscribe('production:updated', () => {
      loadCards({ silent: true });
    });
  }, [subscribe, loadCards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [
        c.card_number,
        c.component_label,
        c.assigned_employee_name,
        c.customer_name,
        c.schedule_number,
        c.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [cards, search]);

  async function handleRollover() {
    setError(null);
    try {
      await api.post('/production/rollover');
      await loadCards({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Rollover failed');
    }
  }

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Shop floor</p>
          <h1>Production</h1>
          <p className="muted">Daily job cards by employee. Shortfalls roll to the next day as overdue.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="neutral-button" onClick={handleRollover}>
            Run overdue rollover
          </button>
          <button type="button" className="primary-button" onClick={() => navigate('/production/today')}>
            My Today
          </button>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Daily cards</h2>
            <p className="muted">Filter by work date and assignee.</p>
          </div>
          <div className="employees-actions" style={{ flexWrap: 'wrap' }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="READY">READY</option>
              <option value="RUNNING">RUNNING</option>
              <option value="OVERDUE">OVERDUE</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="search-input"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="employees-table-wrap">
          {error ? <p className="error-message">{error}</p> : null}
          {loading ? <p className="muted">Loading…</p> : null}
          <table className="app-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Work date</th>
                <th>Delivery due</th>
                <th>Employee</th>
                <th>Component</th>
                <th>Goal</th>
                <th>Good</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.card_number}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.schedule_number}
                    </div>
                  </td>
                  <td>{formatDueLabel(c.work_date)}</td>
                  <td>
                    {formatDueLabel(c.schedule_due_date, c.schedule_due_weekday_label)}
                  </td>
                  <td>{c.assigned_employee_name || '—'}</td>
                  <td>{c.component_label || '—'}</td>
                  <td>
                    {c.day_goal}
                    {Number(c.overdue_quantity) > 0 ? (
                      <span className="muted"> (+{c.overdue_quantity} od)</span>
                    ) : null}
                  </td>
                  <td>{c.total_good_produced}</td>
                  <td>
                    <span className={statusClass(c.status)}>{c.status}</span>
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length ? (
                <tr>
                  <td colSpan="8" className="muted">
                    No production cards in this range.
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
