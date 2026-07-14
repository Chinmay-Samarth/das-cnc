import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, UserCheck, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket } from '../socket/socketContext';
import {
  PageHeader,
  MetricCard,
  AlertBanner,
  StatusBadge,
  ProgressRing,
  TruncatedText,
  EmptyState,
} from '../components/mes';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function RouteOperatorsCell({ card }) {
  const crew = card.route_operators?.length
    ? card.route_operators
    : card.assigned_employee_name
      ? [
          {
            id: card.assigned_employee_id,
            name: card.assigned_employee_name,
            code: card.assigned_employee_code,
          },
        ]
      : [];
  const shown = crew.slice(0, 3);
  const extra = crew.length - shown.length;
  const currentName = card.current_operator_name || card.assigned_employee_name || 'Unassigned';
  const secondLine = [card.current_node_label, card.current_work_center_code || card.work_center_code]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {shown.map((o, i) => (
            <span
              key={o.id || o.name}
              className="mes-avatar"
              title={o.name || '—'}
              style={{
                width: 22,
                height: 22,
                fontSize: 9,
                marginLeft: i ? -6 : 0,
                border: '1.5px solid var(--surface, #fff)',
                zIndex: shown.length - i,
              }}
            >
              {initials(o.name)}
            </span>
          ))}
          {extra > 0 ? (
            <span className="muted" style={{ marginLeft: 4, fontSize: 11 }}>
              +{extra}
            </span>
          ) : null}
        </span>
        <TruncatedText style={{ maxWidth: 110 }}>{currentName}</TruncatedText>
      </span>
      {secondLine ? (
        <span className="muted" style={{ fontSize: 11 }}>
          <TruncatedText style={{ maxWidth: 160 }}>{secondLine}</TruncatedText>
        </span>
      ) : null}
    </div>
  );
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
        c.current_operator_name,
        ...(c.route_operators || []).flatMap((o) => [o.name, o.code]),
        c.work_center_code,
        c.current_work_center_code,
        c.current_node_label,
        c.customer_name,
        c.schedule_number,
        c.status,
        c.assignment_status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [cards, search]);

  const kpis = useMemo(() => {
    const open = filtered.filter((c) => ['READY', 'RUNNING', 'OVERDUE'].includes(c.status));
    const goal = open.reduce(
      (s, c) => s + Number(c.day_goal ?? Number(c.target_quantity) + Number(c.overdue_quantity)),
      0
    );
    const good = open.reduce((s, c) => s + Number(c.total_good_produced || 0), 0);
    const overdue = filtered.filter((c) => c.status === 'OVERDUE').length;
    const unassigned = filtered.filter(
      (c) => c.assignment_status === 'unassigned' || c.assignment_status === 'blocked'
    ).length;
    return { open: open.length, goal, good, overdue, unassigned };
  }, [filtered]);

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
    <main className="mes-shell">
      <PageHeader
        eyebrow="Shop floor"
        title="Production"
        subtitle="Supervisor overview of daily execution — yield against targets and assignment health."
        actions={
          <>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={handleRollover}>
              Run overdue rollover
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/production/work-centers')}
            >
              <LayoutGrid size={16} />
              WC Board
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              onClick={() => navigate('/production/today')}
            >
              <UserCheck size={16} />
              My Today
            </button>
          </>
        }
      />

      <div className="mes-metric-grid">
        <MetricCard label="Open cards" value={kpis.open} hint="READY / RUNNING / OVERDUE" />
        <MetricCard
          label="Yield"
          value={`${Math.round(kpis.good)}/${Math.round(kpis.goal)}`}
          hint="Good vs day goal"
          tone="info"
        />
        <MetricCard label="Overdue" value={kpis.overdue} tone={kpis.overdue ? 'danger' : 'neutral'} />
        <MetricCard
          label="Unassigned"
          value={kpis.unassigned}
          tone={kpis.unassigned ? 'amber' : 'neutral'}
        />
      </div>

      {kpis.overdue > 0 || kpis.unassigned > 0 ? (
        <AlertBanner
          tone="danger"
          title="Attention required"
          icon={AlertTriangle}
        >
          {kpis.overdue > 0 ? `${kpis.overdue} overdue card(s). ` : null}
          {kpis.unassigned > 0
            ? `${kpis.unassigned} unassigned/blocked — fill from WC Board after punches.`
            : null}
        </AlertBanner>
      ) : null}

      <div className="mes-filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="READY">READY</option>
            <option value="RUNNING">RUNNING</option>
            <option value="OVERDUE">OVERDUE</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </label>
        <label>
          Operator
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">All</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 160 }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Card, WC, component…"
          />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !filtered.length ? (
        <EmptyState
          title="No production cards"
          description="Release a delivery schedule to create daily job cards for this range."
          actionLabel="Delivery Schedules"
          onAction={() => navigate('/delivery-schedules')}
        />
      ) : (
        <div className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="employees-table-wrap" style={{ margin: 0 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Yield</th>
                  <th>Card</th>
                  <th>Due</th>
                  <th>WC</th>
                  <th title="People on this route">Operators</th>
                  <th>Component</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const goal = Number(
                    c.day_goal ?? Number(c.target_quantity) + Number(c.overdue_quantity)
                  );
                  const good = Number(c.total_good_produced || 0);
                  return (
                    <tr
                      key={c.id}
                      className="pc-row-clickable"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/production/cards/${c.id}`)}
                    >
                      <td>
                        <ProgressRing value={good} max={goal || 1} size={48} stroke={4} />
                      </td>
                      <td>
                        <strong className="pc-card-link">{c.card_number}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.schedule_number}
                          {c.assignment_status && c.assignment_status !== 'assigned'
                            ? ` · ${c.assignment_status}`
                            : ''}
                        </div>
                      </td>
                      <td>{formatDueLabel(c.schedule_due_date, c.schedule_due_weekday_label)}</td>
                      <td>{c.current_work_center_code || c.work_center_code || '—'}</td>
                      <td>
                        <RouteOperatorsCell card={c} />
                      </td>
                      <td>
                        <TruncatedText style={{ maxWidth: 180 }}>
                          {c.component_label || '—'}
                        </TruncatedText>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
