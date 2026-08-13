import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Copy,
  Package,
  RefreshCw,
  UserCheck,
  Users,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { useSocket } from '../socket/socketContext';
import { PageHeader, EmptyState, StatusBadge, TruncatedText } from '../components/mes';
import { appAlert } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';

const DONE_CHIP_LIMIT = 8;
const PLANT_TZ = 'Asia/Kolkata';

function plantTodayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function plantMonthYear() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Calendar days in month up to today (plant TZ) — same idea as Employee Details. */
function monthDaysUpToToday(year, month, todayYmd) {
  const lastOfMonth = new Date(year, month, 0).getDate();
  const [ty, tm, td] = String(todayYmd).split('-').map(Number);
  const last =
    ty === year && tm === month ? Math.min(lastOfMonth, td) : lastOfMonth;
  const days = [];
  for (let d = 1; d <= last; d += 1) days.push(ymd(year, month, d));
  return days;
}

const PRESENT_STATUSES = new Set(['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY']);

/**
 * Approved leave days for the month (explicit LEAVE only).
 */
function buildLeaveDays(records) {
  const leaveDays = [];
  for (const row of records || []) {
    const status = String(row.status || '').toUpperCase();
    if (status !== 'LEAVE') continue;
    const date = String(row.shift_date || '').slice(0, 10);
    if (!date) continue;
    leaveDays.push({
      shift_date: date,
      status: 'LEAVE',
      shift: row.shift || null,
      supervisor_note: row.supervisor_note || null,
    });
  }
  leaveDays.sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)));
  return leaveDays;
}

function getEfficiencyMood(efficiency, opsCompletedToday, hasActive) {
  if (efficiency >= 80 && opsCompletedToday >= 1) return 'good';
  if (efficiency >= 50 || (opsCompletedToday >= 1 && efficiency < 80)) return 'ok';
  if (efficiency < 50 && (opsCompletedToday === 0 || hasActive)) return 'low';
  return 'ok';
}

const MOOD_META = {
  good: { emoji: '🙂', label: 'On track', className: 'is-good' },
  ok: { emoji: '😐', label: 'Steady pace', className: 'is-ok' },
  low: { emoji: '☹️', label: 'Needs attention', className: 'is-low' },
};

function EfficiencyHero({ efficiency, good, goal, opsCompletedToday, hasActive }) {
  const mood = getEfficiencyMood(efficiency, opsCompletedToday, hasActive);
  const meta = MOOD_META[mood];
  return (
    <section className={`mt-efficiency-hero ${meta.className}`} aria-label="Efficiency index">
      <span className="mt-efficiency-emoji" role="img" aria-label={meta.label}>
        {meta.emoji}
      </span>
      <div className="mt-efficiency-body">
        <p className="mt-efficiency-label">Efficiency index</p>
        <p className="mt-efficiency-value">{efficiency}%</p>
        <p className="mt-efficiency-sub">
          {opsCompletedToday} op{opsCompletedToday === 1 ? '' : 's'} done · {Number(good)} /{' '}
          {Number(goal)} good vs goal
        </p>
      </div>
    </section>
  );
}

function LotReceiptModal({ lot, cardLabel, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copyLotNumber() {
    try {
      await navigator.clipboard.writeText(String(lot.lot_number));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="pc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pc-modal lot-receipt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lot-receipt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="lot-receipt-eyebrow">Lot card ready</p>
        <h2 id="lot-receipt-title">Write this lot number on the card</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>
          Send this lot card with the manufactured components to the next step
          {cardLabel ? ` for ${cardLabel}` : ''}.
        </p>
        <div className="lot-receipt-number" aria-live="polite">
          {lot.lot_number}
        </div>
        <div className="lot-receipt-meta">
          <span>
            Qty <strong>{Number(lot.quantity || 0)}</strong>
          </span>
          {lot.current_node_label ? (
            <span>
              Next <strong>{lot.current_node_label}</strong>
              {lot.current_node_type ? ` (${lot.current_node_type})` : ''}
            </span>
          ) : lot.ready_for_dispatch ? (
            <span>
              Next <strong>Ready for Dispatch</strong>
            </span>
          ) : null}
        </div>
        <div className="pc-modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="mes-btn mes-btn-secondary" onClick={copyLotNumber}>
            <Copy size={16} />
            {copied ? 'Copied' : 'Copy lot #'}
          </button>
          <button type="button" className="mes-btn mes-btn-primary" onClick={onClose} autoFocus>
            Got it — send lot
          </button>
        </div>
      </div>
    </div>
  );
}

function MyTodayJobCard({
  cardNumber,
  componentLabel,
  operationLabel,
  todayGoal,
  goodSoFar,
  busy,
  goodValue,
  scrapValue,
  onGoodChange,
  onScrapChange,
  onDone,
  isActive,
  children,
}) {
  return (
    <article className={`mt-job-card${isActive ? ' is-focus' : ' is-subdued'}`}>
      <div className="mt-job-fields">
        {cardNumber ? (
          <div className="mt-job-row">
            <span className="mt-job-field-label">Card</span>
            <span className="mt-job-number">{cardNumber}</span>
          </div>
        ) : null}
        <div className="mt-job-row">
          <span className="mt-job-field-label">Component</span>
          <span className="mt-job-component">{componentLabel || '—'}</span>
        </div>
        <div className="mt-job-row">
          <span className="mt-job-field-label">Operation</span>
          <span className="mt-job-operation">{operationLabel}</span>
        </div>
        {todayGoal != null && todayGoal > 0 ? (
          <div className="mt-job-row mt-job-row-goal">
            <span className="mt-job-field-label">Today&apos;s goal</span>
            <span className="mt-job-goal">
              <strong>{Number(goodSoFar ?? 0)}</strong>
              <span className="mt-job-goal-sep"> / </span>
              <strong>{Number(todayGoal)}</strong>
            </span>
          </div>
        ) : null}
      </div>

      {isActive ? (
        <div className="mt-job-actions">
          <label className="mt-qty-label mt-qty-good">
            Good
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={goodValue ?? ''}
              disabled={busy}
              onChange={(e) => onGoodChange(e.target.value)}
            />
          </label>
          <label className="mt-qty-label mt-qty-scrap">
            Scrap
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={scrapValue ?? ''}
              disabled={busy}
              onChange={(e) => onScrapChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="mes-btn mes-btn-primary mt-job-done"
            disabled={busy}
            onClick={onDone}
          >
            Done
          </button>
        </div>
      ) : null}

      {children}
    </article>
  );
}

/** Collapsed summary for a completed daily card */
function CompletedCardCollapsed({ card, lotNumber, onOpenTracking }) {
  const Tag = onOpenTracking ? 'button' : 'div';
  return (
    <Tag
      type={onOpenTracking ? 'button' : undefined}
      className="mes-list-item mt-complete-item"
      onClick={onOpenTracking || undefined}
    >
      <div className="mes-list-item-top">
        <span className="mes-list-item-title mt-mono">{card.card_number || 'Card'}</span>
        <StatusBadge status="COMPLETED">Done</StatusBadge>
      </div>
      <p className="mes-list-item-sub">
        <TruncatedText>{card.component_label || '—'}</TruncatedText>
      </p>
      <div className="mt-list-meta">
        <span>
          {Number(card.good_qty || 0)} / {Number(card.committed_qty || 0)} good
        </span>
        {lotNumber ? (
          <span className="mt-mono mt-lot-tag">
            <Package size={12} strokeWidth={2} aria-hidden />
            {lotNumber}
          </span>
        ) : null}
      </div>
    </Tag>
  );
}

function DoneTodayList({ rows, formatOpTime, onOpenCard }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, DONE_CHIP_LIMIT);
  const hiddenCount = rows.length - DONE_CHIP_LIMIT;

  if (!rows.length) return null;

  return (
    <section className="mes-card mt-panel" aria-label="Done today">
      <header className="mt-panel-header">
        <div>
          <p className="mes-eyebrow">Completed</p>
          <h2 className="mt-panel-title">Done today</h2>
        </div>
        <StatusBadge status="COMPLETED">{rows.length}</StatusBadge>
      </header>

      <div className="mt-panel-list">
        {visible.map((row) => {
          const lotLabel =
            row.lot_number ||
            (row.lot_numbers && row.lot_numbers.length ? row.lot_numbers.join(', ') : null);
          return (
            <button
              key={row.id}
              type="button"
              className="mes-list-item mt-done-item"
              // onClick={() => onOpenCard?.(row.id)}
            >
              <div className="mes-list-item-top">
                <span className="mes-list-item-title mt-mono">{row.card_number || '—'}</span>
                <span className="mt-list-time">{formatOpTime(row.completed_at || row.work_date)}</span>
              </div>
              <p className="mes-list-item-sub">
              <div className="mt-list-meta">
                <TruncatedText>#{row.component_label || '—'}</TruncatedText>
                <span>{Number(row.good_qty || 0)} good</span>
                {lotLabel ? (
                  <span className="mt-mono mt-lot-tag">
                    <Package size={12} strokeWidth={2} aria-hidden />
                    {lotLabel}
                  </span>
                ) : null}
              </div>
                </p>
            </button>
          );
        })}
      </div>

      {!expanded && hiddenCount > 0 ? (
        <button type="button" className="mes-btn mes-btn-secondary mt-panel-more" onClick={() => setExpanded(true)}>
          View all ({rows.length})
        </button>
      ) : null}
    </section>
  );
}

function EfficiencyMatrix({
  team,
  workCenterId,
  workDate,
  initiallySaved,
  onSave,
  efficiencyIndex = 0,
  managerEmployeeId = null,
}) {
  const indexPct = Number.isFinite(Number(efficiencyIndex)) ? Math.round(Number(efficiencyIndex)) : 0;

  const buildRows = (list, { liveManagerIndex }) =>
    list.map((emp) => {
      const employeeId = emp.employee_id || emp.id;
      const isManager =
        emp.is_wc_manager === true ||
        (!!managerEmployeeId && employeeId === managerEmployeeId);
      const stored =
        emp.efficiency_pct !== '' && emp.efficiency_pct != null
          ? Number(emp.efficiency_pct)
          : null;
      return {
        employee_id: employeeId,
        full_name: emp.full_name,
        is_manager: isManager,
        efficiency_pct: isManager
          ? liveManagerIndex
            ? indexPct
            : stored != null
              ? stored
              : indexPct
          : emp.efficiency_pct ?? '',
        notes: isManager
          ? emp.notes || 'Derived from day efficiency index'
          : emp.notes || '',
      };
    });

  const [rows, setRows] = useState(() => buildRows(team, { liveManagerIndex: !initiallySaved }));
  const [saving, setSaving] = useState(false);
  const [savedCollapsed, setSavedCollapsed] = useState(!!initiallySaved);
  const [expanded, setExpanded] = useState(!initiallySaved);

  useEffect(() => {
    const editing = !initiallySaved || expanded;
    setRows(buildRows(team, { liveManagerIndex: editing }));
    if (initiallySaved && !expanded) {
      setSavedCollapsed(true);
    }
  }, [team, initiallySaved, indexPct, managerEmployeeId, expanded]);

  async function handleSave() {
    setSaving(true);
    try {
      for (const row of rows) {
        const isManager = row.is_manager;
        const pct = isManager ? indexPct : row.efficiency_pct;
        if (pct === '' || pct == null) continue;
        await api.post('/campaigns/efficiency', {
          work_center_id: workCenterId,
          work_date: workDate,
          employee_id: row.employee_id,
          efficiency_pct: Number(pct),
          notes: isManager
            ? row.notes || 'Derived from day efficiency index'
            : row.notes || undefined,
        });
      }
      setSavedCollapsed(true);
      setExpanded(false);
      await appAlert({ title: 'Efficiency saved', tone: 'success' });
      if (onSave) onSave();
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Efficiency save failed');
    } finally {
      setSaving(false);
    }
  }

  const filled = rows.filter((r) => r.efficiency_pct !== '' && r.efficiency_pct != null);
  const avg =
    filled.length > 0
      ? Math.round(filled.reduce((s, r) => s + Number(r.efficiency_pct), 0) / filled.length)
      : null;

  if (savedCollapsed && !expanded) {
    return (
      <section className="mes-card mt-panel" aria-label="Team efficiency">
        <header className="mt-panel-header">
          <div className="mt-panel-header-main">
            <span className="mt-panel-icon" aria-hidden>
              <Users size={16} strokeWidth={1.75} />
            </span>
            <div>
              <p className="mes-eyebrow">Team</p>
              <h2 className="mt-panel-title">Efficiency</h2>
            </div>
          </div>
          <div className="mt-panel-header-actions">
            <StatusBadge status="COMPLETED">Saved</StatusBadge>
            {avg != null ? <span className="mt-eff-avg">{avg}% avg</span> : null}
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => setExpanded(true)}
              aria-expanded="false"
            >
              View
              <ChevronRight size={16} />
            </button>
          </div>
        </header>

        {filled.length === 0 ? (
          <p className="mt-panel-empty">No efficiency percentages recorded.</p>
        ) : (
          <ul className="mt-eff-summary">
            {filled.map((row) => (
              <li key={row.employee_id} className="mt-eff-summary-row">
                <TruncatedText className="mt-eff-name">
                  {row.full_name}
                  {row.is_manager ? ' (manager)' : ''}
                </TruncatedText>
                <span className="mt-eff-pct">{Number(row.efficiency_pct)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="mes-card mt-panel" aria-label="Team efficiency editor">
      <header className="mt-panel-header">
        <div className="mt-panel-header-main">
          <span className="mt-panel-icon" aria-hidden>
            <Users size={16} strokeWidth={1.75} />
          </span>
          <div>
            <p className="mes-eyebrow">Team</p>
            <h2 className="mt-panel-title">Efficiency</h2>
          </div>
        </div>
        {savedCollapsed ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => setExpanded(false)}
            aria-expanded="true"
          >
            <ChevronDown size={16} />
            Collapse
          </button>
        ) : null}
      </header>

      <p className="mt-panel-hint">
        {savedCollapsed
          ? 'Update operator values and save again if needed. Manager % follows the efficiency index.'
          : 'Optional after lot handoff — operators are entered manually; manager % is taken from the efficiency index.'}
      </p>

      <div className="data-table-wrap">
        <table className="app-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Efficiency %</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.employee_id}>
                <td>
                  {row.full_name}
                  {row.is_manager ? (
                    <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                      manager
                    </span>
                  ) : null}
                </td>
                <td>
                  {row.is_manager ? (
                    <span className="mt-eff-pct" title="From efficiency index">
                      {indexPct}%
                    </span>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      max="200"
                      step="1"
                      value={row.efficiency_pct}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx].efficiency_pct = e.target.value;
                        setRows(next);
                      }}
                      style={{ width: 80 }}
                    />
                  )}
                </td>
                <td>
                  {row.is_manager ? (
                    <span className="muted" style={{ fontSize: 13 }}>
                      From efficiency index
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={row.notes}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx].notes = e.target.value;
                        setRows(next);
                      }}
                      style={{ width: '100%' }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="mes-btn mes-btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ marginTop: 12 }}
      >
        {saving ? 'Saving…' : savedCollapsed ? 'Update efficiency' : 'Save efficiency'}
      </button>
    </section>
  );
}

function todayStr() {
  return plantTodayStr();
}

/** OPERATOR personal view: today's worker_efficiency_entries + monthly leave days */
function OperatorPersonalToday() {
  const { user } = useAuth();
  const { subscribe } = useSocket();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [todayEntries, setTodayEntries] = useState([]);
  const [leaveRecords, setLeaveRecords] = useState([]);
  const [monthLabel, setMonthLabel] = useState('');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    const today = plantTodayStr();
    const { year, month } = plantMonthYear();
    setMonthLabel(
      new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    );

    const errors = [];
    try {
      const [effSettled, attSettled] = await Promise.allSettled([
        api.get(`/employees/${user.id}/efficiency`),
        api.get(`/attendance/employee/${user.id}/monthly`, {
          params: { month, year },
        }),
      ]);

      if (effSettled.status === 'fulfilled') {
        const entries = (effSettled.value.data?.entries || []).filter(
          (row) => String(row.work_date).slice(0, 10) === today
        );
        setTodayEntries(entries);
      } else {
        setTodayEntries([]);
        errors.push('efficiency');
      }

      if (attSettled.status === 'fulfilled') {
        const records = attSettled.value.data?.records || [];
        setLeaveRecords(buildLeaveDays(records));
      } else {
        setLeaveRecords([]);
        errors.push('attendance');
      }

      if (errors.length === 2) {
        setError('Unable to load your today summary');
      } else if (errors.includes('attendance')) {
        setError('Unable to load monthly leave days');
      } else if (errors.includes('efficiency')) {
        setError('Unable to load today efficiency');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load your today summary');
      setTodayEntries([]);
      setLeaveRecords([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('leave-requests:updated', (payload) => {
      if (payload?.employeeId && user?.id && payload.employeeId !== user.id) return;
      load();
    });
  }, [subscribe, load, user?.id]);

  useEffect(() => {
    return subscribe('attendance:updated', (payload) => {
      if (payload?.action === 'leave_approved') load();
    });
  }, [subscribe, load]);

  const todayAvg = useMemo(() => {
    if (!todayEntries.length) return 0;
    const sum = todayEntries.reduce((s, r) => s + Number(r.efficiency_pct || 0), 0);
    return Math.round(sum / todayEntries.length);
  }, [todayEntries]);

  const recorded = todayEntries.length > 0;

  return (
    <main className="mes-shell mt-page">
      <PageHeader
        eyebrow="Operator"
        title="My Today"
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <>
          <EfficiencyHero
            efficiency={todayAvg}
            good={todayAvg}
            goal={100}
            opsCompletedToday={recorded ? todayEntries.length : 0}
            hasActive={false}
          />

          <section className="mes-card mt-panel" aria-label="Monthly leaves" style={{ marginTop: 16 }}>
            <header className="mt-panel-header">
              <div>
                <p className="mes-eyebrow">Attendance</p>
                <h2 className="mt-panel-title">Leaves · {monthLabel}</h2>
              </div>
              <StatusBadge status={leaveRecords.length ? 'overdue' : 'completed'}>
                {leaveRecords.length}
              </StatusBadge>
            </header>

            {!leaveRecords.length ? (
              <EmptyState
                icon={CalendarDays}
                title="No approved leave this month"
                description="Approved leave days will list here."
              />
            ) : (
              <div className="mt-panel-list">
                {leaveRecords
                  .slice()
                  .sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
                  .map((row) => {
                    return (
                      <div key={row.shift_date} className="mes-list-item">
                        <div className="mes-list-item-top">
                          <span className="mes-list-item-title">
                            {formatDisplayDate(row.shift_date)}
                          </span>
                          <StatusBadge status="READY">Leave</StatusBadge>
                        </div>
                        {row.supervisor_note ? (
                          <p className="mes-list-item-sub">{row.supervisor_note}</p>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default function MyTodayPage() {
  const navigate = useNavigate();
  const { isFloorOnly, user } = useAuth();
  const floorOnly = isFloorOnly();
  const isOperator = user?.accessLevel === 'OPERATOR';

  if (isOperator) {
    return <OperatorPersonalToday />;
  }

  return <ManagerMyToday floorOnly={floorOnly} navigate={navigate} />;
}

function ManagerMyToday({ floorOnly, navigate }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useSocket();
  const [managedWcs, setManagedWcs] = useState([]);
  const [selectedWc, setSelectedWc] = useState('');
  const [command, setCommand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessReady, setAccessReady] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [postForm, setPostForm] = useState({ good: '', scrap: '' });
  const [lotReceipt, setLotReceipt] = useState(null);
  const [efficiencyUnlocked, setEfficiencyUnlocked] = useState(false);
  const [justCompletedCard, setJustCompletedCard] = useState(null);
  const [incomingForms, setIncomingForms] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    const wcId = searchParams.get('wc') || selectedWc;
    if (!wcId) {
      setCommand(null);
      if (!silent) setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/campaigns/work-centers/${wcId}/command`, {
        params: { work_date: todayStr() },
      });
      setCommand(data);
      if (
        data?.efficiency_saved ||
        (data?.closed_mid_route_ops || []).length > 0 ||
        (data?.closed_cards || []).some((c) => c.efficiency_unlocked || c.kind === 'mid_route_op')
      ) {
        setEfficiencyUnlocked(true);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load command');
      setCommand(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [searchParams, selectedWc]);

  useEffect(() => {
    async function loadManagedWcs() {
      try {
        const { data } = await api.get('/campaigns/managed-work-centers');
        const centers = data.work_centers || [];
        setManagedWcs(centers);
        const wcParam = searchParams.get('wc');
        if (wcParam && centers.some((wc) => wc.id === wcParam)) {
          setSelectedWc(wcParam);
        } else if (centers.length === 1) {
          setSelectedWc(centers[0].id);
        } else if (wcParam && !centers.some((wc) => wc.id === wcParam)) {
          setSelectedWc('');
          setSearchParams({});
        }
      } catch {
        setManagedWcs([]);
      } finally {
        setAccessReady(true);
        setLoading(false);
      }
    }
    loadManagedWcs();
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const wcParam = searchParams.get('wc');
    if (wcParam && wcParam !== selectedWc && managedWcs.some((wc) => wc.id === wcParam)) {
      setSelectedWc(wcParam);
    }
  }, [searchParams, selectedWc, managedWcs]);

  useEffect(() => {
    if (!accessReady || !managedWcs.length) return;
    load();
  }, [load, accessReady, managedWcs.length]);

  useEffect(() => {
    return subscribe('production:updated', () => {
      if (managedWcs.length) load({ silent: true });
    });
  }, [subscribe, load, managedWcs.length]);

  const hasManagerAccess = managedWcs.length > 0;

  async function handleDone() {
    const card = command?.today_card || command?.today_commitment;
    if (!card?.id) return;

    const hasQty =
      (postForm.good !== '' && Number(postForm.good) > 0) ||
      (postForm.scrap !== '' && Number(postForm.scrap) > 0);
    if (!hasQty) {
      setError('Enter good or scrap quantity before Done.');
      return;
    }

    setBusyId(card.id);
    setError(null);
    try {
      let receiptLot = null;

      const { data: progressData } = await api.post(`/production/cards/${card.id}/progress`, {
        good_qty: postForm.good !== '' ? Number(postForm.good) : undefined,
        scrap_qty: postForm.scrap !== '' ? Number(postForm.scrap) : undefined,
        done_for_day: true,
      });
      setPostForm({ good: '', scrap: '' });

      const cardResult = progressData?.card || progressData;
      receiptLot =
        cardResult?.lot ||
        cardResult?.minted_lot?.lot ||
        cardResult?.advance?.lot ||
        progressData?.lot ||
        null;

      if (cardResult?.status === 'COMPLETED' || cardResult?.efficiency_unlocked || receiptLot) {
        setJustCompletedCard({
          ...card,
          ...cardResult,
          good_qty: cardResult?.total_good_produced ?? cardResult?.good_qty ?? card.good_qty,
          committed_qty: cardResult?.target_quantity ?? cardResult?.committed_qty ?? card.committed_qty,
          card_number: cardResult?.card_number || card.card_number,
          component_label: command?.active_campaign?.component_label || card.component_label,
          lot_number: receiptLot?.lot_number || null,
        });
      }

      if (cardResult?.efficiency_unlocked || cardResult?.lot_minted_at || receiptLot?.lot_number) {
        if (!receiptLot?.lot_number) setEfficiencyUnlocked(true);
      }

      if (receiptLot?.lot_number) {
        setLotReceipt({
          lot: receiptLot,
          cardLabel: command?.active_campaign?.component_label || null,
          unlockEfficiency: true,
        });
      }

      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Done failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleIncomingOpDone(op) {
    if (!op?.id) return;
    const form = incomingForms[op.id] || { good: '', scrap: '' };
    const hasQty =
      (form.good !== '' && Number(form.good) > 0) ||
      (form.scrap !== '' && Number(form.scrap) > 0);
    if (!hasQty) {
      setError('Enter good or scrap quantity before Done.');
      return;
    }

    setBusyId(op.id);
    setError(null);
    try {
      await api.post(`/production/op-cards/${op.id}/progress`, {
        good_qty: form.good !== '' ? Number(form.good) : undefined,
        scrap_qty: form.scrap !== '' ? Number(form.scrap) : undefined,
        done_for_day: true,
      });
      setIncomingForms((prev) => {
        const next = { ...prev };
        delete next[op.id];
        return next;
      });
      setEfficiencyUnlocked(true);
      setJustCompletedCard({
        id: op.id,
        kind: 'mid_route_op',
        card_number: op.op_card_number || op.card_number || null,
        component_label: op.component_label || op.lot_number || null,
        good_qty: Number(form.good || op.good_qty || 0),
        committed_qty: Number(op.target_quantity || 0),
        completed_at: new Date().toISOString(),
        lot_number: op.lot_number || null,
        efficiency_unlocked: true,
      });
      await load({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Incoming op Done failed');
    } finally {
      setBusyId(null);
    }
  }

  function handleWcChange(wcId) {
    setSelectedWc(wcId);
    setSearchParams(wcId ? { wc: wcId } : {});
    setJustCompletedCard(null);
    setEfficiencyUnlocked(false);
    setIncomingForms({});
  }

  const camp = command?.active_campaign;
  const commit = command?.today_card || command?.today_commitment;
  const campaignQueue = command?.campaign_queue || [];
  const team = command?.team || [];
  const closedCommitments = command?.closed_cards || command?.closed_commitments || [];
  const incomingOps = command?.incoming_ops || [];
  const hasIncoming = incomingOps.length > 0;

  const opsCompletedToday =
    Number(command?.ops_completed_today ?? closedCommitments.length) || 0;

  // Hero uses full day totals (completed cards + active card progress)
  const goal =
    command?.today_goal_qty != null
      ? Number(command.today_goal_qty)
      : closedCommitments.reduce((s, c) => s + Number(c.committed_qty || 0), 0) +
        (commit && commit.status !== 'COMPLETED' ? Number(commit.committed_qty || 0) : 0);

  const good =
    command?.today_good_qty != null
      ? Number(command.today_good_qty)
      : closedCommitments.reduce((s, c) => s + Number(c.good_qty || 0), 0) +
        (commit && commit.status !== 'COMPLETED' ? Number(commit.good_qty || 0) : 0);

  const efficiency =
    command?.efficiency_index_pct != null
      ? Number(command.efficiency_index_pct)
      : goal > 0
        ? Math.round((good / goal) * 100)
        : 0;

  const managerEmployeeId = command?.work_center?.manager_employee_id || null;

  const lastClosed = closedCommitments[closedCommitments.length - 1];
  const midRouteClosedCount = (command?.closed_mid_route_ops || []).length;
  // Mid-route Done clears incoming but must still count as floor work (hero + matrix).
  // Include local unlock / just-completed so panels don't flash away if the reload
  // briefly returns an empty closed list.
  const hasFloorActivity =
    !!camp ||
    hasIncoming ||
    closedCommitments.length > 0 ||
    midRouteClosedCount > 0 ||
    !!command?.has_floor_activity ||
    !!justCompletedCard ||
    efficiencyUnlocked;
  const canShowEfficiencyMatrix =
    team.length > 0 &&
    hasFloorActivity &&
    (efficiencyUnlocked ||
      command?.efficiency_saved ||
      lastClosed?.efficiency_unlocked ||
      lastClosed?.lot_minted_at ||
      justCompletedCard?.efficiency_unlocked ||
      justCompletedCard?.kind === 'mid_route_op' ||
      justCompletedCard?.lot_number ||
      midRouteClosedCount > 0 ||
      (commit?.status === 'COMPLETED' && (commit.efficiency_unlocked || commit.lot_minted_at)));

  // Prefer live closed list; fall back to just-completed chip until reload lands
  const collapsedCompleted =
    justCompletedCard &&
    !closedCommitments.some((c) => c.id === justCompletedCard.id)
      ? justCompletedCard
      : null;

  function formatOpTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  if (!accessReady || (loading && !command && hasManagerAccess)) {
    return (
      <main className="mes-shell mt-page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!hasManagerAccess) {
    return (
      <main className="mes-shell mt-page">
        <PageHeader eyebrow="Manager" title="My Today" />
        <EmptyState
          icon={UserCheck}
          title="Work center managers only"
          description="You are not assigned as manager on any work center. Ask an admin to set you as WC Manager on the Operators tab."
          actionLabel="Back to home"
          onAction={() => navigate('/production/today')}
        />
      </main>
    );
  }

  return (
    <main className="mes-shell mt-page">
      <PageHeader
        eyebrow="Manager"
        title="My Today"
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <div className="mes-filters" style={{ marginBottom: 16 }}>
        <label>
          Work center
          <select value={selectedWc} onChange={(e) => handleWcChange(e.target.value)}>
            <option value="">Select work center…</option>
            {managedWcs.map((wc) => (
              <option key={wc.id} value={wc.id}>
                {wc.code ? `${wc.code} — ` : ''}
                {wc.name}
                {wc.is_acting ? ' (acting)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {command?.contingency?.acting_employee_id &&
      command?.contingency?.manager_unavailable ? (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Acting manager today
          {command.contingency.pinned ? ' (pinned)' : ''}
          {command.contingency.acting_employee?.full_name
            ? ` — ${command.contingency.acting_employee.full_name}`
            : ''}
          . Regular manager is absent or on leave.
        </p>
      ) : null}

      {error ? <p className="error-message">{error}</p> : null}

      {!selectedWc ? (
        <EmptyState
          icon={UserCheck}
          title="Select a work center"
          description="Choose a work center to view today's daily card and post good/scrap quantities."
        />
      ) : !camp && !hasIncoming && !hasFloorActivity ? (
        <EmptyState
          icon={UserCheck}
          title="No work queued"
          description="No active campaign and no incoming lots from upstream work centers. Release a horizon wave or wait for WIP from the previous operation."
          actionLabel="Open Horizon Planner"
          onAction={() => navigate('/production/horizon-planner')}
        />
      ) : (
        <>
          {hasFloorActivity ? (
            <EfficiencyHero
              efficiency={efficiency}
              good={good}
              goal={goal}
              opsCompletedToday={opsCompletedToday}
              hasActive={
                (!!camp && commit && commit.status !== 'COMPLETED') || hasIncoming
              }
            />
          ) : null}

          {hasIncoming ? (
            <section style={{ marginTop: hasFloorActivity ? 16 : 0 }} aria-label="Incoming lots">
              <h3 className="mes-section-title" style={{ marginBottom: 10 }}>
                Incoming lots
              </h3>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                WIP parked here after an upstream operation. Start/complete these before they move on.
              </p>
              {incomingOps.map((op) => {
                const form = incomingForms[op.id] || { good: '', scrap: '' };
                return (
                  <MyTodayJobCard
                    key={op.id}
                    cardNumber={op.op_card_number || op.card_number}
                    componentLabel={op.component_label || op.lot_number || 'Incoming lot'}
                    operationLabel={
                      op.current_node_label ||
                      `${op.lot_number ? `Lot ${op.lot_number} · ` : ''}Mid-route op`
                    }
                    todayGoal={Number(op.target_quantity || 0)}
                    goodSoFar={Number(op.good_qty || 0)}
                    busy={busyId === op.id}
                    goodValue={form.good}
                    scrapValue={form.scrap}
                    onGoodChange={(v) =>
                      setIncomingForms((prev) => ({
                        ...prev,
                        [op.id]: { ...(prev[op.id] || { good: '', scrap: '' }), good: v },
                      }))
                    }
                    onScrapChange={(v) =>
                      setIncomingForms((prev) => ({
                        ...prev,
                        [op.id]: { ...(prev[op.id] || { good: '', scrap: '' }), scrap: v },
                      }))
                    }
                    onDone={() => handleIncomingOpDone(op)}
                    isActive
                  >
                    <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                      {op.lot_number ? `Lot ${op.lot_number}` : 'Lot'}
                      {op.parent_card_number ? ` · from ${op.parent_card_number}` : ''}
                      {op.status ? ` · ${op.status}` : ''}
                      {op.lot_status ? ` · lot ${op.lot_status}` : ''}
                    </p>
                  </MyTodayJobCard>
                );
              })}
            </section>
          ) : null}

          {camp && commit && commit.status !== 'COMPLETED' ? (
            <MyTodayJobCard
              cardNumber={commit.card_number}
              componentLabel={camp.component_label || camp.master_record_id}
              operationLabel={
                commit.current_node_label || camp.operation_label || 'Campaign operation'
              }
              todayGoal={Number(commit.committed_qty || commit.target_quantity || 0)}
              goodSoFar={Number(commit.good_qty || commit.total_good_produced || 0)}
              busy={!!busyId}
              goodValue={postForm.good}
              scrapValue={postForm.scrap}
              onGoodChange={(v) => setPostForm((f) => ({ ...f, good: v }))}
              onScrapChange={(v) => setPostForm((f) => ({ ...f, scrap: v }))}
              onDone={handleDone}
              isActive
            />
          ) : null}

          {camp && !commit && command?.next_card_date ? (
            <div className="mes-card" style={{ padding: 16, marginTop: 12 }}>
              <StatusBadge status="READY">Day complete</StatusBadge>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                No daily card due today. Next card unlocks on{' '}
                <strong>{command.next_card_date}</strong>.
              </p>
            </div>
          ) : null}

          {camp && !commit && !command?.next_card_date && closedCommitments.length > 0 ? (
            <div className="mes-card" style={{ padding: 16, marginTop: 12 }}>
              <StatusBadge status="COMPLETED">Caught up</StatusBadge>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                No open daily cards right now for this campaign.
              </p>
            </div>
          ) : null}

          {collapsedCompleted ? (
            <div className="mt-panel-list" style={{ marginTop: 12 }}>
              <CompletedCardCollapsed
                card={collapsedCompleted}
                lotNumber={collapsedCompleted.lot_number}
                onOpenTracking={
                  floorOnly
                    ? undefined
                    : () => navigate(`/production/cards/${collapsedCompleted.id}`)
                }
              />
            </div>
          ) : null}

          {canShowEfficiencyMatrix ? (
            <EfficiencyMatrix
              team={team}
              workCenterId={selectedWc}
              workDate={todayStr()}
              initiallySaved={!!command?.efficiency_saved}
              efficiencyIndex={efficiency}
              managerEmployeeId={managerEmployeeId}
              onSave={() => load({ silent: true })}
            />
          ) : null}

          {closedCommitments.length > 0 ? (
            <DoneTodayList
              rows={closedCommitments}
              formatOpTime={formatOpTime}
              onOpenCard={
                floorOnly
                  ? undefined
                  : (id) => {
                      const row = closedCommitments.find((c) => c.id === id);
                      const trackId =
                        row?.kind === 'mid_route_op'
                          ? row.parent_card_id || id
                          : id;
                      navigate(`/production/cards/${trackId}`);
                    }
              }
            />
          ) : null}

          {camp && campaignQueue.length > 1 ? (
            <div style={{ marginTop: 20 }}>
              <h3 className="mes-section-title">Campaign queue</h3>
              {campaignQueue.slice(1).map((q) => (
                <MyTodayJobCard
                  key={q.id}
                  cardNumber={null}
                  componentLabel={q.component_label || q.master_record_id}
                  operationLabel="Queued"
                  todayGoal={null}
                  goodSoFar={q.good_quantity}
                  busy={false}
                  goodValue=""
                  scrapValue=""
                  onGoodChange={() => {}}
                  onScrapChange={() => {}}
                  onDone={() => {}}
                  isActive={false}
                >
                  <div style={{ marginTop: 8 }}>
                    <StatusBadge status={q.status}>{q.status}</StatusBadge>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      {q.good_quantity} / {q.target_quantity}
                    </span>
                  </div>
                </MyTodayJobCard>
              ))}
            </div>
          ) : null}

        </>
      )}

      {lotReceipt?.lot?.lot_number ? (
        <LotReceiptModal
          lot={lotReceipt.lot}
          cardLabel={lotReceipt.cardLabel}
          onClose={() => {
            if (lotReceipt.unlockEfficiency) setEfficiencyUnlocked(true);
            setLotReceipt(null);
          }}
        />
      ) : null}
    </main>
  );
}
