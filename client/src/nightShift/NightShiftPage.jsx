import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Moon, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import {
  AlertBanner,
  EmptyState,
  PageHeader,
  StatusBadge,
  TruncatedText,
} from '../components/mes';

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function AddNightWorkerDialog({ week, employees, excludeIds, busy, onClose, onPick }) {
  const inputRef = useRef(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const excluded = useMemo(() => new Set((excludeIds || []).map(String)), [excludeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees || []).filter((emp) => {
      if (excluded.has(String(emp.id))) return false;
      if (!q) return true;
      return [emp.full_name, emp.employee_code, emp.department, emp.job_description]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [employees, excluded, search]);

  function handleBackdrop(e) {
    if (e.target !== e.currentTarget || busy) return;
    onClose();
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className="app-dialog is-info night-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="night-add-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-dialog-icon" aria-hidden>
          <UserPlus size={22} strokeWidth={2} />
        </div>
        <div className="app-dialog-body">
          <h2 id="night-add-dialog-title" className="app-dialog-title">
            Add night worker
          </h2>
          <p className="app-dialog-message">
            Assign someone to Night for {week?.title?.toLowerCase() || 'this week'}
            {week?.label ? ` (${week.label})` : ''}. They are saved as soon as you pick them.
          </p>

          <label className="night-add-search">
            <Search size={16} aria-hidden />
            <input
              ref={inputRef}
              type="search"
              className="app-dialog-input"
              placeholder="Search by name or code…"
              value={search}
              disabled={busy}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search employees"
            />
          </label>

          <div className="night-add-list" role="listbox" aria-label="Employees">
            {!filtered.length ? (
              <p className="muted night-add-empty">No matching employees.</p>
            ) : (
              filtered.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  role="option"
                  className="night-add-option"
                  disabled={busy}
                  onClick={() => onPick(emp.id)}
                >
                  <span className="mes-avatar" title={emp.full_name}>
                    {initials(emp.full_name)}
                  </span>
                  <span className="night-add-option-info">
                    <strong>
                      <TruncatedText>{emp.full_name}</TruncatedText>
                    </strong>
                    <span>
                      {emp.employee_code || 'No code'}
                      {emp.department ? ` · ${emp.department}` : ''}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="app-dialog-actions">
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function WeekCard({
  week,
  expanded,
  onToggle,
  canEdit,
  savingWeek,
  saveStatus,
  onAddClick,
  onPersist,
}) {
  const busy = savingWeek === week.week_start;
  const members = week.employees || [];

  async function removeEmployee(id, event) {
    event?.stopPropagation?.();
    if (!canEdit || busy) return;
    await onPersist(
      week.week_start,
      members.map((m) => m.id).filter((x) => x !== id)
    );
  }

  const statusLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? 'Error'
          : week.is_current
            ? 'Current'
            : 'Planned';

  const statusTone =
    saveStatus === 'saving'
      ? 'pending'
      : saveStatus === 'saved'
        ? 'completed'
        : saveStatus === 'error'
          ? 'overdue'
          : week.is_current
            ? 'active'
            : 'open';

  return (
    <article
      className={`night-week-card mes-card${expanded ? ' is-expanded' : ''}${
        week.is_current ? ' is-current' : ''
      }`}
    >
      <button
        type="button"
        className="night-week-card-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="night-week-card-title">
          <span className="night-week-card-eyebrow">{week.title}</span>
          <strong>{week.label}</strong>
        </div>
        <div className="night-week-card-meta">
          <span className="night-week-card-count">
            <Users size={14} aria-hidden />
            {week.employee_count}{' '}
            {week.employee_count === 1 ? 'worker' : 'workers'}
          </span>
          <StatusBadge status={statusTone}>{statusLabel}</StatusBadge>
          <ChevronDown
            size={18}
            className={`night-week-chevron${expanded ? ' is-open' : ''}`}
            aria-hidden
          />
        </div>
      </button>

      <div className={`night-week-card-body${expanded ? ' is-open' : ''}`}>
        <div className="night-week-card-body-inner">
          {canEdit ? (
            <div className="night-week-add">
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddClick(week);
                }}
              >
                <Plus size={16} aria-hidden />
                Add night worker
              </button>
            </div>
          ) : (
            <p className="muted night-week-readonly-note">
              Only admins can change night shift assignments.
            </p>
          )}

          {!members.length ? (
            <EmptyState
              icon={Moon}
              title="No night workers"
              description={
                canEdit
                  ? 'Use Add night worker to assign someone to this week.'
                  : 'Nobody is scheduled for Night this week.'
              }
            />
          ) : (
            <div className="wc-ops-roster night-week-roster">
              {members.map((m) => (
                <div key={m.id} className="wc-ops-member">
                  <span className="mes-avatar" title={m.full_name}>
                    {initials(m.full_name)}
                  </span>
                  <div className="wc-ops-member-info">
                    <strong>
                      <TruncatedText>{m.full_name}</TruncatedText>
                    </strong>
                    <span>
                      {m.employee_code || 'No code'}
                      {m.department ? ` · ${m.department}` : ''}
                    </span>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      className="mes-btn cancel-button"
                      style={{ padding: '8px 10px' }}
                      disabled={busy}
                      aria-label={`Remove ${m.full_name}`}
                      onClick={(event) => removeEmployee(m.id, event)}
                    >
                      <X size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function NightShiftPage() {
  const { isAdmin } = useAuth();
  const canEdit = isAdmin();

  const [weeks, setWeeks] = useState([]);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [employeeDir, setEmployeeDir] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingWeek, setSavingWeek] = useState(null);
  const [saveStatuses, setSaveStatuses] = useState({});
  const [addWeek, setAddWeek] = useState(null);
  const saveTimers = useRef({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: roster }, { data: empData }] = await Promise.all([
        api.get('/night-shift'),
        api.get('/employees', { params: { status: 'active' } }),
      ]);
      const list = roster.weeks || [];
      setWeeks(list);
      setEmployeeDir(empData.employees || []);
      setExpandedWeek((prev) => {
        if (prev && list.some((w) => w.week_start === prev)) return prev;
        return list[0]?.week_start || null;
      });
      setAddWeek((prev) => {
        if (!prev) return null;
        return list.find((w) => w.week_start === prev.week_start) || null;
      });
    } catch (err) {
      console.error('Failed to load night shift roster:', err);
      setError(err.response?.data?.error || 'Unable to load night shift roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
    };
  }, [load]);

  const flashSaved = useCallback((weekStart) => {
    if (saveTimers.current[weekStart]) clearTimeout(saveTimers.current[weekStart]);
    setSaveStatuses((prev) => ({ ...prev, [weekStart]: 'saved' }));
    saveTimers.current[weekStart] = setTimeout(() => {
      setSaveStatuses((prev) => {
        if (prev[weekStart] !== 'saved') return prev;
        const next = { ...prev };
        delete next[weekStart];
        return next;
      });
    }, 1600);
  }, []);

  const persistWeek = useCallback(
    async (weekStart, employeeIds) => {
      if (!canEdit) return;
      setSavingWeek(weekStart);
      setSaveStatuses((prev) => ({ ...prev, [weekStart]: 'saving' }));
      setError(null);

      setWeeks((prev) =>
        prev.map((w) => {
          if (w.week_start !== weekStart) return w;
          const employees = employeeIds.map((id) => {
            const existing = (w.employees || []).find((e) => e.id === id);
            if (existing) return existing;
            const fromDir = employeeDir.find((e) => e.id === id);
            return fromDir
              ? {
                  id: fromDir.id,
                  employee_code: fromDir.employee_code,
                  full_name: fromDir.full_name,
                  department: fromDir.department,
                  is_active: true,
                }
              : {
                  id,
                  employee_code: null,
                  full_name: 'Unknown employee',
                  department: null,
                  is_active: true,
                };
          });
          return {
            ...w,
            employees,
            employee_count: employees.length,
          };
        })
      );

      try {
        const { data } = await api.put(`/night-shift/weeks/${weekStart}`, {
          employee_ids: employeeIds,
        });
        if (data?.week) {
          setWeeks((prev) =>
            prev.map((w) => (w.week_start === weekStart ? data.week : w))
          );
        }
        flashSaved(weekStart);
      } catch (err) {
        console.error('Failed to save night shift roster:', err);
        setSaveStatuses((prev) => ({ ...prev, [weekStart]: 'error' }));
        setError(err.response?.data?.error || 'Unable to save night shift roster.');
        await load();
      } finally {
        setSavingWeek(null);
      }
    },
    [canEdit, employeeDir, flashSaved, load]
  );

  async function handlePickEmployee(employeeId) {
    if (!addWeek || !employeeId) return;
    const members = addWeek.employees || [];
    if (members.some((m) => m.id === employeeId)) {
      setAddWeek(null);
      return;
    }
    await persistWeek(addWeek.week_start, [...members.map((m) => m.id), employeeId]);
    setAddWeek(null);
  }

  const subtitle = useMemo(() => {
    const current = weeks.find((w) => w.is_current);
    if (!current) return 'Plan night shift coverage for this week and the next three.';
    return `This week ${current.label}. Changes save as you add or remove people.`;
  }, [weeks]);

  const addWeekLive = useMemo(() => {
    if (!addWeek) return null;
    return weeks.find((w) => w.week_start === addWeek.week_start) || addWeek;
  }, [addWeek, weeks]);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="People"
        title="Night Shift"
        subtitle={subtitle}
      />

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      {loading ? (
        <p className="muted">Loading night shift roster…</p>
      ) : !weeks.length ? (
        <section className="mes-card">
          <EmptyState
            icon={Moon}
            title="No roster data"
            description="Unable to load week information."
          />
        </section>
      ) : (
        <div className="night-week-stack" role="list">
          {weeks.map((week) => (
            <WeekCard
              key={week.week_start}
              week={week}
              expanded={expandedWeek === week.week_start}
              onToggle={() =>
                setExpandedWeek((prev) =>
                  prev === week.week_start ? null : week.week_start
                )
              }
              canEdit={canEdit}
              savingWeek={savingWeek}
              saveStatus={saveStatuses[week.week_start]}
              onAddClick={setAddWeek}
              onPersist={persistWeek}
            />
          ))}
        </div>
      )}

      {addWeekLive ? (
        <AddNightWorkerDialog
          week={addWeekLive}
          employees={employeeDir}
          excludeIds={(addWeekLive.employees || []).map((e) => e.id)}
          busy={savingWeek === addWeekLive.week_start}
          onClose={() => setAddWeek(null)}
          onPick={handlePickEmployee}
        />
      ) : null}
    </main>
  );
}
