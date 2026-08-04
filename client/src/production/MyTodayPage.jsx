import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Package, RefreshCw, UserCheck, Users } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { PageHeader, EmptyState, StatusBadge, TruncatedText } from '../components/mes';
import { appAlert } from '../components/dialog';

const DONE_CHIP_LIMIT = 8;

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
  return (
    <button type="button" className="mes-list-item mt-complete-item" onClick={onOpenTracking}>
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
    </button>
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

function EfficiencyMatrix({ team, workCenterId, workDate, initiallySaved, onSave }) {
  const [rows, setRows] = useState(() =>
    team.map((emp) => ({
      employee_id: emp.employee_id || emp.id,
      full_name: emp.full_name,
      efficiency_pct: emp.efficiency_pct ?? '',
      notes: emp.notes || '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [savedCollapsed, setSavedCollapsed] = useState(!!initiallySaved);
  const [expanded, setExpanded] = useState(!initiallySaved);

  useEffect(() => {
    setRows(
      team.map((emp) => ({
        employee_id: emp.employee_id || emp.id,
        full_name: emp.full_name,
        efficiency_pct: emp.efficiency_pct ?? '',
        notes: emp.notes || '',
      }))
    );
    if (initiallySaved) {
      setSavedCollapsed(true);
      setExpanded(false);
    }
  }, [team, initiallySaved]);

  async function handleSave() {
    setSaving(true);
    try {
      for (const row of rows) {
        if (row.efficiency_pct !== '' && row.efficiency_pct != null) {
          await api.post('/campaigns/efficiency', {
            work_center_id: workCenterId,
            work_date: workDate,
            employee_id: row.employee_id,
            efficiency_pct: Number(row.efficiency_pct),
            notes: row.notes || undefined,
          });
        }
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
                <TruncatedText className="mt-eff-name">{row.full_name}</TruncatedText>
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
          ? 'Update values and save again if needed.'
          : 'Optional after lot handoff — save when ready.'}
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
                <td>{row.full_name}</td>
                <td>
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
                </td>
                <td>
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
  return new Date().toISOString().slice(0, 10);
}

export default function MyTodayPage() {
  const navigate = useNavigate();
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
      if (data?.efficiency_saved) setEfficiencyUnlocked(true);
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

  function handleWcChange(wcId) {
    setSelectedWc(wcId);
    setSearchParams(wcId ? { wc: wcId } : {});
    setJustCompletedCard(null);
    setEfficiencyUnlocked(false);
  }

  const camp = command?.active_campaign;
  const commit = command?.today_card || command?.today_commitment;
  const campaignQueue = command?.campaign_queue || [];
  const team = command?.team || [];
  const closedCommitments = command?.closed_cards || command?.closed_commitments || [];

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

  const efficiency = goal > 0 ? Math.round((good / goal) * 100) : 0;

  const lastClosed = closedCommitments[closedCommitments.length - 1];
  const canShowEfficiencyMatrix =
    team.length > 0 &&
    (efficiencyUnlocked ||
      command?.efficiency_saved ||
      lastClosed?.efficiency_unlocked ||
      lastClosed?.lot_minted_at ||
      justCompletedCard?.lot_number ||
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
          onAction={() => navigate('/home')}
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
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {!selectedWc ? (
        <EmptyState
          icon={UserCheck}
          title="Select a work center"
          description="Choose a work center to view today's daily card and post good/scrap quantities."
        />
      ) : !camp ? (
        <EmptyState
          icon={UserCheck}
          title="No active campaign"
          description="Release a horizon wave in the planner to start production on this work center."
          actionLabel="Open Horizon Planner"
          onAction={() => navigate('/production/horizon-planner')}
        />
      ) : (
        <>
          <EfficiencyHero
            efficiency={efficiency}
            good={good}
            goal={goal}
            opsCompletedToday={opsCompletedToday}
            hasActive={!!camp && commit && commit.status !== 'COMPLETED'}
          />

          {commit && commit.status !== 'COMPLETED' ? (
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

          {!commit && command?.next_card_date ? (
            <div className="mes-card" style={{ padding: 16, marginTop: 12 }}>
              <StatusBadge status="READY">Day complete</StatusBadge>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                No daily card due today. Next card unlocks on{' '}
                <strong>{command.next_card_date}</strong>.
              </p>
            </div>
          ) : null}

          {!commit && !command?.next_card_date && closedCommitments.length > 0 ? (
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
                onOpenTracking={() => navigate(`/production/cards/${collapsedCompleted.id}`)}
              />
            </div>
          ) : null}

          {canShowEfficiencyMatrix ? (
            <EfficiencyMatrix
              team={team}
              workCenterId={selectedWc}
              workDate={todayStr()}
              initiallySaved={!!command?.efficiency_saved}
              onSave={() => load({ silent: true })}
            />
          ) : null}

          {closedCommitments.length > 0 ? (
            <DoneTodayList
              rows={closedCommitments}
              formatOpTime={formatOpTime}
              onOpenCard={(id) => navigate(`/production/cards/${id}`)}
            />
          ) : null}

          {campaignQueue.length > 1 ? (
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
