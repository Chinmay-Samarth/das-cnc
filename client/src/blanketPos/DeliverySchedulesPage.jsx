import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import ReleaseToFloorModal from '../production/ReleaseToFloorModal';
import { formatDueLabel, formatScheduleLabel } from './scheduleLabels';
import { useSocket } from '../socket/socketContext';

function statusClass(status) {
  if (status === 'released') return 'status-pill status-active';
  if (status === 'planned') return 'status-pill';
  return 'status-pill status-inactive';
}

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 2, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export default function DeliverySchedulesPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [releaseSchedule, setReleaseSchedule] = useState(null);

  const reload = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      return api
        .get('/delivery-schedules', {
          params: {
            from: from || undefined,
            to: to || undefined,
            status: status || undefined,
          },
        })
        .then(({ data }) => {
          setSchedules(data.schedules || []);
          setError(null);
        })
        .catch((err) => {
          setError(err.response?.data?.error || 'Unable to load schedules.');
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [from, to, status]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    return subscribe('delivery-schedule:updated', () => {
      reload({ silent: true });
    });
  }, [subscribe, reload]);

  useEffect(() => {
    return subscribe('production:updated', (payload) => {
      if (payload?.action === 'released' || payload?.deliveryScheduleId) {
        reload({ silent: true });
      }
    });
  }, [subscribe, reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schedules;
    return schedules.filter((s) =>
      [
        s.schedule_number,
        s.component_label,
        s.customer_name,
        s.blanket_number,
        s.status,
        s.due_date,
        s.due_weekday_label,
        s.rule_weekday_label,
        formatDueLabel(s.due_date, s.due_weekday_label),
        formatScheduleLabel(s),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [schedules, search]);

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Demand management</p>
          <h1>Delivery Schedules</h1>
          <p className="muted">Upcoming deliveries generated from customer weekly plans.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Schedule list</h2>
            <p className="muted">Filter by date range and status. Release planned rows to create daily shop-floor cards.</p>
          </div>
          <div className="employees-actions" style={{ flexWrap: 'wrap' }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="planned">Planned</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input
              type="search"
              className="search-input"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="employees-table-wrap">
          {error ? <p className="error-message">{error}</p> : null}
          {loading ? <p className="muted">Loading...</p> : null}
          <table className="app-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Due</th>
                <th>Customer</th>
                <th>Blanket</th>
                <th>Component</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td
                    style={{ cursor: s.blanket_po_id ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (s.blanket_po_id) navigate(`/blanket-pos/${s.blanket_po_id}`);
                    }}
                  >
                    <strong>{s.schedule_number}</strong>
                  </td>
                  <td>{formatDueLabel(s.due_date, s.due_weekday_label)}</td>
                  <td>{s.customer_name || '—'}</td>
                  <td>{s.blanket_number || '—'}</td>
                  <td>
                    {s.component_label || '—'}
                    {s.rule_weekday_label ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Weekly {s.rule_weekday_label}
                      </div>
                    ) : s.rule_month_day != null ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Monthly day {s.rule_month_day}
                      </div>
                    ) : null}
                  </td>
                  <td>{s.quantity}</td>
                  <td>
                    <span className={statusClass(s.status)}>{s.status}</span>
                  </td>
                  <td>
                    {s.status === 'planned' || s.status === 'released' ? (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => setReleaseSchedule(s)}
                      >
                        Release to floor
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length ? (
                <tr>
                  <td colSpan="8" className="muted">
                    No schedules in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <ReleaseToFloorModal
        open={!!releaseSchedule}
        schedule={releaseSchedule}
        onClose={() => setReleaseSchedule(null)}
        onReleased={() => {
          setReleaseSchedule(null);
          reload();
          navigate('/production');
        }}
      />
    </main>
  );
}
