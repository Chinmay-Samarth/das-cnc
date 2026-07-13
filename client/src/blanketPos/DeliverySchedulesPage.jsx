import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  FileText,
  List,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Package,
} from 'lucide-react';
import api from '../api/client';
import ReleaseToFloorModal from '../production/ReleaseToFloorModal';
import { formatDueLabel, formatScheduleLabel, WEEKDAYS } from './scheduleLabels';
import { useSocket } from '../socket/socketContext';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';

function utcYmd(y, m, d) {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function monthBounds(year, monthIndex) {
  return {
    from: utcYmd(year, monthIndex, 1),
    to: utcYmd(year, monthIndex + 1, 0),
  };
}

function defaultListRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function addMonths(year, monthIndex, delta) {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function monthTitle(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function formatQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function carrierLabel(status) {
  if (status === 'released') return 'Released';
  if (status === 'planned') return 'Planned';
  if (status === 'cancelled') return 'Cancelled';
  return status || '—';
}

function ScheduleRow({ s, onRelease, onContract }) {
  return (
    <article className="mes-ship-card">
      <div>
        <p className="mes-ship-eta">
          {formatDueLabel(s.due_date, s.due_weekday_label)}
          <small>ETA / due</small>
        </p>
      </div>
      <div className="mes-ship-body">
        <h3>
          <TruncatedText>{formatScheduleLabel(s)}</TruncatedText>
        </h3>
        <p>
          <TruncatedText>
            {[s.customer_name, s.blanket_number, s.component_label].filter(Boolean).join(' · ')}
          </TruncatedText>
        </p>
        <p style={{ marginTop: 6 }}>
          Qty <strong>{s.quantity}</strong>
          {s.rule_weekday_label ? ` · weekly ${s.rule_weekday_label}` : ''}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <StatusBadge status={s.status}>{carrierLabel(s.status)}</StatusBadge>
        {s.status === 'planned' ? (
          <button type="button" className="mes-btn mes-btn-primary" onClick={() => onRelease(s)}>
            Release to floor
          </button>
        ) : null}
        {s.blanket_po_id ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => onContract(s.blanket_po_id)}
          >
            Contract
          </button>
        ) : null}
      </div>
    </article>
  );
}

function DayInspectorCard({ s, onRelease, onContract }) {
  return (
    <article className={`mes-cal-item is-${s.status || 'planned'}`}>
      <div className="mes-cal-item-top">
        <div className="mes-cal-item-id">
          <Package size={14} aria-hidden />
          <span>{s.schedule_number || 'Schedule'}</span>
        </div>
        <StatusBadge status={s.status}>{carrierLabel(s.status)}</StatusBadge>
      </div>
      <h3 className="mes-cal-item-title">
        <TruncatedText>{s.component_label || formatScheduleLabel(s)}</TruncatedText>
      </h3>
      <p className="mes-cal-item-meta">
        <TruncatedText>
          {[s.customer_name, s.blanket_number].filter(Boolean).join(' · ') || '—'}
        </TruncatedText>
      </p>
      <div className="mes-cal-item-foot">
        <span className="mes-cal-item-qty">
          Qty <strong>{formatQty(s.quantity)}</strong>
        </span>
        <div className="mes-cal-item-actions">
          {s.status === 'planned' ? (
            <button type="button" className="mes-btn mes-btn-primary" onClick={() => onRelease(s)}>
              Release
            </button>
          ) : null}
          {s.blanket_po_id ? (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => onContract(s.blanket_po_id)}
            >
              PO
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function buildMonthCells(year, monthIndex) {
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const offset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const prevMonth = addMonths(year, monthIndex, -1);
  const prevDays = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const nextMonth = addMonths(year, monthIndex, 1);

  const cells = [];
  for (let i = 0; i < offset; i += 1) {
    const day = prevDays - offset + i + 1;
    cells.push({
      key: `p-${day}`,
      date: utcYmd(prevMonth.y, prevMonth.m, day),
      day,
      inMonth: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: `c-${day}`,
      date: utcYmd(year, monthIndex, day),
      day,
      inMonth: true,
    });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({
      key: `n-${nextDay}`,
      date: utcYmd(nextMonth.y, nextMonth.m, nextDay),
      day: nextDay,
      inMonth: false,
    });
    nextDay += 1;
  }
  return cells;
}

export default function DeliverySchedulesPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const initial = defaultListRange();
  const [view, setView] = useState('list');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return { y: now.getUTCFullYear(), m: now.getUTCMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [status, setStatus] = useState('');
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [releaseSchedule, setReleaseSchedule] = useState(null);

  const applyMonth = useCallback((y, m, { selectToday = false } = {}) => {
    const bounds = monthBounds(y, m);
    setMonthCursor({ y, m });
    setFrom(bounds.from);
    setTo(bounds.to);
    const today = todayYmd();
    if (selectToday && today >= bounds.from && today <= bounds.to) {
      setSelectedDate(today);
    } else {
      setSelectedDate(null);
    }
  }, []);

  const switchView = useCallback(
    (next) => {
      setView(next);
      if (next === 'calendar') {
        applyMonth(monthCursor.y, monthCursor.m, { selectToday: true });
      }
    },
    [applyMonth, monthCursor.y, monthCursor.m]
  );

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
    let list = schedules;
    if (q) {
      list = schedules.filter((s) =>
        [
          s.schedule_number,
          s.component_label,
          s.customer_name,
          s.blanket_number,
          s.status,
          s.due_date,
          s.due_weekday_label,
          formatScheduleLabel(s),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const da = a.due_date || '9999-12-31';
      const db = b.due_date || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.schedule_number || '').localeCompare(String(b.schedule_number || ''));
    });
  }, [schedules, search]);

  const byDate = useMemo(() => {
    const map = {};
    for (const s of filtered) {
      const key = s.due_date;
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [filtered]);

  const cells = useMemo(
    () => buildMonthCells(monthCursor.y, monthCursor.m),
    [monthCursor.y, monthCursor.m]
  );

  const monthStats = useMemo(() => {
    let planned = 0;
    let released = 0;
    let cancelled = 0;
    let qty = 0;
    const shipDays = new Set();
    for (const s of filtered) {
      if (s.status === 'planned') planned += 1;
      else if (s.status === 'released') released += 1;
      else if (s.status === 'cancelled') cancelled += 1;
      qty += Number(s.quantity) || 0;
      if (s.due_date) shipDays.add(s.due_date);
    }
    return { planned, released, cancelled, qty, shipDays: shipDays.size, total: filtered.length };
  }, [filtered]);

  const today = todayYmd();
  const selectedSchedules = selectedDate ? byDate[selectedDate] || [] : [];
  const selectedQty = selectedSchedules.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  return (
    <main className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Logistics"
        title="Delivery Schedules"
        subtitle="Upcoming customer deliveries. Switch between list and calendar to plan releases."
        actions={
          <>
            <div className="mes-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`mes-view-toggle-btn${view === 'list' ? ' is-active' : ''}`}
                onClick={() => switchView('list')}
              >
                <List size={16} />
                List
              </button>
              <button
                type="button"
                className={`mes-view-toggle-btn${view === 'calendar' ? ' is-active' : ''}`}
                onClick={() => switchView('calendar')}
              >
                <CalendarDays size={16} />
                Calendar
              </button>
            </div>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/blanket-pos')}
            >
              <FileText size={16} />
              Blanket POs
            </button>
          </>
        }
      />

      <div className="mes-filters">
        {view === 'list' ? (
          <>
            <label>
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        ) : null}
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="planned">Planned</option>
            <option value="released">Released</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, schedule #…"
          />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading schedules…</p> : null}

      {!loading && view === 'list' && !filtered.length ? (
        <EmptyState
          icon={Truck}
          title="No deliveries in this range"
          description="Generate schedules from a blanket PO weekly plan, or widen the date filter."
          actionLabel="Open Blanket POs"
          onAction={() => navigate('/blanket-pos')}
        />
      ) : null}

      {!loading && view === 'list' && filtered.length ? (
        <div className="mes-ship-stack">
          {filtered.map((s) => (
            <ScheduleRow
              key={s.id}
              s={s}
              onRelease={setReleaseSchedule}
              onContract={(id) => navigate(`/blanket-pos/${id}`)}
            />
          ))}
        </div>
      ) : null}

      {!loading && view === 'calendar' ? (
        <div className="mes-cal-layout">
          <section className="mes-cal" aria-label="Delivery calendar">
            <header className="mes-cal-toolbar">
              <div className="mes-cal-toolbar-left">
                <button
                  type="button"
                  className="mes-cal-icon-btn"
                  aria-label="Previous month"
                  onClick={() => {
                    const prev = addMonths(monthCursor.y, monthCursor.m, -1);
                    applyMonth(prev.y, prev.m);
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <h2 className="mes-cal-month">{monthTitle(monthCursor.y, monthCursor.m)}</h2>
                <button
                  type="button"
                  className="mes-cal-icon-btn"
                  aria-label="Next month"
                  onClick={() => {
                    const next = addMonths(monthCursor.y, monthCursor.m, 1);
                    applyMonth(next.y, next.m);
                  }}
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  type="button"
                  className="mes-cal-today"
                  onClick={() => {
                    const now = new Date();
                    applyMonth(now.getUTCFullYear(), now.getUTCMonth(), { selectToday: true });
                  }}
                >
                  Today
                </button>
              </div>
              <div className="mes-cal-legend" aria-label="Status legend">
                <span className="mes-cal-legend-item is-planned">Planned</span>
                <span className="mes-cal-legend-item is-released">Released</span>
                <span className="mes-cal-legend-item is-cancelled">Cancelled</span>
              </div>
            </header>

            <div className="mes-cal-kpis">
              <div className="mes-cal-kpi">
                <span>Ship days</span>
                <strong>{monthStats.shipDays}</strong>
              </div>
              <div className="mes-cal-kpi">
                <span>Schedules</span>
                <strong>{monthStats.total}</strong>
              </div>
              <div className="mes-cal-kpi is-amber">
                <span>Planned</span>
                <strong>{monthStats.planned}</strong>
              </div>
              <div className="mes-cal-kpi is-green">
                <span>Released</span>
                <strong>{monthStats.released}</strong>
              </div>
              <div className="mes-cal-kpi">
                <span>Total qty</span>
                <strong>{formatQty(monthStats.qty)}</strong>
              </div>
            </div>

            <div className="mes-cal-weekdays">
              {WEEKDAYS.map((w) => (
                <div key={w.value} className="mes-cal-weekday">
                  {w.short}
                </div>
              ))}
            </div>

            <div className="mes-cal-grid">
              {cells.map((cell) => {
                const dayItems = byDate[cell.date] || [];
                const isToday = cell.date === today;
                const isSelected = cell.date === selectedDate;
                const dayQty = dayItems.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
                const visible = dayItems.slice(0, 3);
                const overflow = dayItems.length - visible.length;

                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      'mes-cal-day',
                      cell.inMonth ? '' : 'is-outside',
                      isToday ? 'is-today' : '',
                      isSelected ? 'is-selected' : '',
                      dayItems.length ? 'has-items' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelectedDate(cell.date)}
                  >
                    <div className="mes-cal-day-head">
                      <span className="mes-cal-day-num">{cell.day}</span>
                      {dayItems.length ? (
                        <span className="mes-cal-day-qty">{formatQty(dayQty)}</span>
                      ) : null}
                    </div>
                    {dayItems.length ? (
                      <div className="mes-cal-day-events">
                        {visible.map((s) => (
                          <span
                            key={s.id}
                            className={`mes-cal-event is-${s.status || 'planned'}`}
                            title={`${formatScheduleLabel(s)} · qty ${formatQty(s.quantity)}`}
                          >
                            <span className="mes-cal-event-label">
                              {s.customer_name || s.schedule_number || 'Delivery'}
                            </span>
                            <span className="mes-cal-event-qty">{formatQty(s.quantity)}</span>
                          </span>
                        ))}
                        {overflow > 0 ? (
                          <span className="mes-cal-more">+{overflow} more</span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="mes-cal-side">
            <div className="mes-cal-side-head">
              <p className="mes-cal-side-eyebrow">Day board</p>
              <h2>{selectedDate ? formatDueLabel(selectedDate) : 'Select a day'}</h2>
              <p className="mes-cal-side-sub">
                {selectedDate
                  ? `${selectedSchedules.length} ${selectedSchedules.length === 1 ? 'schedule' : 'schedules'} · qty ${formatQty(selectedQty)}`
                  : 'Pick a date to inspect deliveries and release to the floor.'}
              </p>
            </div>

            {!selectedDate ? (
              <div className="mes-cal-side-empty">
                <CalendarDays size={28} strokeWidth={1.5} />
                <p>No day selected</p>
              </div>
            ) : null}

            {selectedDate && !selectedSchedules.length ? (
              <div className="mes-cal-side-empty">
                <Truck size={28} strokeWidth={1.5} />
                <p>No deliveries due</p>
                <span>Nothing matches this day with current filters.</span>
              </div>
            ) : null}

            {selectedSchedules.length ? (
              <div className="mes-cal-side-list">
                {selectedSchedules.map((s) => (
                  <DayInspectorCard
                    key={s.id}
                    s={s}
                    onRelease={setReleaseSchedule}
                    onContract={(id) => navigate(`/blanket-pos/${id}`)}
                  />
                ))}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

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
