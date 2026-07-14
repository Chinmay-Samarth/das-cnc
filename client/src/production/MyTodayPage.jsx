import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle2, Copy, Gauge, Hash, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket, useProductionRealtime } from '../socket/socketContext';
import { useAuth } from '../auth/authContext';
import {
  PageHeader,
  MetricCard,
  StatusBadge,
  EmptyState,
  TruncatedText,
} from '../components/mes';

function extractMintedLot(response) {
  const body = response?.data;
  if (!body) return null;
  const lot =
    body.lot ||
    body.card?.lot ||
    body.card?.advance?.lot ||
    body.advance?.lot ||
    null;
  if (!lot?.lot_number) return null;
  return lot;
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

export default function MyTodayPage() {
  const navigate = useNavigate();
  const { joinWorkCenterRoom, leaveWorkCenterRoom } = useSocket();
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [lots, setLots] = useState([]);
  const [opCards, setOpCards] = useState([]);
  const [completedOpsToday, setCompletedOpsToday] = useState([]);
  const [opsCompletedToday, setOpsCompletedToday] = useState(0);
  const [completedCredit, setCompletedCredit] = useState(0);
  const [goodToday, setGoodToday] = useState(0);
  const [goalToday, setGoalToday] = useState(0);
  const [efficiencyPct, setEfficiencyPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState({});
  const [inputs, setInputs] = useState({});
  const [lastMintedLot, setLastMintedLot] = useState({});
  const [lotReceipt, setLotReceipt] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/production/cards/my-today');
      setCards(data.cards || []);
      setLots(data.lots || []);
      setOpCards(data.op_cards || []);
      setCompletedOpsToday(data.completed_ops_today || []);
      setOpsCompletedToday(Number(data.ops_completed_today || 0));
      setCompletedCredit(
        Number(data.completed_credit ?? data.ops_completed_today ?? 0)
      );
      setGoodToday(Number(data.good_today || 0));
      setGoalToday(Number(data.goal_today || 0));
      setEfficiencyPct(Number(data.efficiency_pct || 0));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load today’s tasks.');
      setCards([]);
      setLots([]);
      setOpCards([]);
      setCompletedOpsToday([]);
      setOpsCompletedToday(0);
      setCompletedCredit(0);
      setGoodToday(0);
      setGoalToday(0);
      setEfficiencyPct(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Join WC rooms for assigned op cards / cards / lots so handoffs arrive instantly
  useEffect(() => {
    const wcIds = [
      ...new Set(
        [...opCards, ...cards, ...lots].map((c) => c.work_center_id).filter(Boolean)
      ),
    ];
    wcIds.forEach((id) => joinWorkCenterRoom(id));
    return () => {
      wcIds.forEach((id) => leaveWorkCenterRoom(id));
    };
  }, [opCards, cards, lots, joinWorkCenterRoom, leaveWorkCenterRoom]);

  const onRealtime = useCallback(
    (payload) => {
      if (
        !payload?.employeeId ||
        payload.employeeId === user?.id ||
        payload?.operator_id === user?.id ||
        payload?.previousEmployeeId === user?.id ||
        payload?.action === 'released' ||
        payload?.action === 'rollover' ||
        payload?.action === 'assign_unassigned' ||
        payload?.action === 'reassigned' ||
        payload?.action === 'advanced' ||
        payload?.action === 'lot_advanced' ||
        payload?.action === 'lot_created' ||
        payload?.action === 'lot_reassigned' ||
        payload?.action === 'task:assigned' ||
        payload?.task_id ||
        payload?.lotId ||
        payload?.lot_id
      ) {
        load({ silent: true });
        setDetail({});
      }
    },
    [load, user?.id]
  );

  useProductionRealtime(onRealtime, [onRealtime]);

  const useOpCards = opCards.length > 0;
  // When Op Cards exist, they are the single floor work token (avoid duplicate card+lot rows)
  const queueCards = useOpCards ? [] : cards;
  const queueLots = useOpCards ? [] : lots;
  const hasActive = opCards.length > 0 || queueCards.length > 0 || queueLots.length > 0;
  const hasDoneToday = completedOpsToday.length > 0;

  function formatOpTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  const metrics = useMemo(() => {
    const active = useOpCards
      ? opCards.filter((o) => o.status === 'RUNNING').length || opCards.length
      : cards.filter((c) => c.status === 'RUNNING').length + lots.length;
    const goal = goalToday;
    const good = goodToday;
    const efficiency =
      goal > 0
        ? efficiencyPct || Math.round((good / goal) * 100)
        : 0;
    return {
      active,
      completed: completedCredit,
      opsCompletedToday,
      efficiency,
      goal,
      good,
    };
  }, [
    useOpCards,
    opCards,
    cards,
    lots,
    completedCredit,
    opsCompletedToday,
    goodToday,
    goalToday,
    efficiencyPct,
  ]);

  async function ensureDetail(cardId) {
    if (detail[cardId]) return detail[cardId];
    const { data } = await api.get(`/production/cards/${cardId}`);
    const next = {
      lots: data.lots || [],
      nodes: data.nodes || [],
      shipments: data.shipments || [],
      op_cards: data.op_cards || [],
    };
    setDetail((d) => ({ ...d, [cardId]: next }));
    return next;
  }

  function patchInput(cardId, patch) {
    setInputs((s) => ({ ...s, [cardId]: { ...(s[cardId] || {}), ...patch } }));
  }

  async function run(cardId, fn) {
    setBusyId(cardId);
    setError(null);
    try {
      const result = await fn();
      const minted =
        extractMintedLot(result) ||
        extractMintedLot({ data: result?.data }) ||
        (result?.data?.lot?.lot_number ? result.data.lot : null) ||
        (result?.lot?.lot_number ? result.lot : null);
      const parentKey =
        cardId ||
        minted?.production_card_id ||
        result?.data?.op_card?.production_card_id;
      if (minted?.lot_number) {
        setLastMintedLot((m) => ({ ...m, [parentKey]: minted }));
        const card =
          cards.find((c) => c.id === parentKey) ||
          opCards.find((o) => o.id === cardId || o.production_card_id === parentKey);
        setLotReceipt({
          lot: minted,
          cardLabel: card?.component_label || card?.card_number || card?.op_card_number || null,
          cardId: parentKey,
        });
        patchInput(cardId, { good: '', scrap: '' });
      }
      await load();
      setDetail((d) => {
        const copy = { ...d };
        delete copy[cardId];
        if (parentKey) delete copy[parentKey];
        return copy;
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function completeLot(lot) {
    const inp = inputs[lot.id] || {};
    setBusyId(lot.id);
    setError(null);
    try {
      await api.post(`/production/lots/${lot.id}/complete`, {
        scrap_qty: Number(inp.scrap || 0),
        good_qty: inp.good !== undefined && inp.good !== '' ? Number(inp.good) : undefined,
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Lot complete failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function completeOpCard(op) {
    const inp = inputs[op.id] || {};
    setBusyId(op.id);
    setError(null);
    try {
      const { data } = await api.post(`/production/op-cards/${op.id}/complete`, {
        scrap_qty: Number(inp.scrap || 0),
        good_qty: inp.good !== undefined && inp.good !== '' ? Number(inp.good) : undefined,
      });
      const minted = data?.lot || data?.advance?.lot || data?.parent?.lot || null;
      if (minted?.lot_number) {
        setLastMintedLot((m) => ({ ...m, [op.production_card_id || op.id]: minted }));
        setLotReceipt({
          lot: minted,
          cardLabel: op.component_label || op.op_card_number,
          cardId: op.production_card_id || op.id,
        });
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Operation complete failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Operator"
        title="My Today"
        subtitle="Operation cards for your assigned work — complete each op to open the next (Ready for Dispatch only after all route ops)."
        actions={
          <button type="button" className="mes-btn mes-btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <div className="mes-metric-grid">
        <MetricCard
          label="My active tasks"
          value={metrics.active}
          hint="Currently RUNNING"
          icon={Activity}
          tone="info"
        />
        <MetricCard
          label="Completed today"
          value={metrics.completed}
          hint={
            metrics.opsCompletedToday
              ? `${metrics.opsCompletedToday} op handoff${metrics.opsCompletedToday === 1 ? '' : 's'} credited`
              : 'Finished cards / op handoffs'
          }
          icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Efficiency index"
          value={`${metrics.efficiency}%`}
          hint={`${metrics.good} / ${metrics.goal} good vs goal (incl. finished ops)`}
          icon={Gauge}
          tone={metrics.efficiency >= 80 ? 'success' : metrics.efficiency >= 50 ? 'amber' : 'danger'}
        />
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !hasActive && !hasDoneToday ? (
        <EmptyState
          icon={Hash}
          title="No jobs assigned"
          description="Nothing on your queue for today. Check the WC Board or ask a supervisor to assign work."
          actionLabel="Open WC Board"
          onAction={() => navigate('/production/work-centers')}
        />
      ) : !loading ? (
        <>
          <div className="mes-task-queue">
            <h2 className="mes-section-title" style={{ margin: '0 0 12px', fontSize: '1rem' }}>
              Active
            </h2>
            {!hasActive ? (
              <p className="muted" style={{ margin: '0 0 16px' }}>
                No open work — finished ops appear under Done today.
              </p>
            ) : null}
          {opCards.map((op) => {
            const busy = busyId === op.id;
            const inp = inputs[op.id] || {};
            const goal = Number(op.target_quantity || 0);
            const good = Number(op.good_qty || 0);
            const toneClass =
              op.status === 'RUNNING' ? 'is-running' : '';
            return (
              <article key={`op-${op.id}`} className={`mes-task-card ${toneClass}`.trim()}>
                <div className="mes-task-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="mes-task-id">
                      <Hash size={16} aria-hidden />
                      <span>{op.op_card_number}</span>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        {op.is_op1 ? 'Op 1' : 'Operation'} · {op.current_node_label || 'Op'}
                      </span>
                      {op.production_card_id ? (
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                          onClick={() => navigate(`/production/cards/${op.production_card_id}`)}
                        >
                          Track route
                        </button>
                      ) : null}
                    </p>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
                      <TruncatedText>{op.component_label || 'Component'}</TruncatedText>
                    </h2>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Goal <strong>{goal}</strong>
                      {' · '}Good <strong>{good}</strong>
                      {op.lot_number ? ` · Lot ${op.lot_number}` : ''}
                      {op.work_center_code ? ` · ${op.work_center_code}` : ''}
                      {op.parent_card_number ? ` · Schedule ${op.parent_card_number}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={op.status || 'READY'} />
                </div>

                {lastMintedLot[op.production_card_id || op.id]?.lot_number ? (
                  <button
                    type="button"
                    className="lot-receipt-inline"
                    onClick={() =>
                      setLotReceipt({
                        lot: lastMintedLot[op.production_card_id || op.id],
                        cardLabel: op.component_label || op.op_card_number,
                        cardId: op.production_card_id || op.id,
                      })
                    }
                  >
                    <span className="lot-receipt-inline-label">Lot card</span>
                    <span className="lot-receipt-inline-number">
                      {lastMintedLot[op.production_card_id || op.id].lot_number}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Tap to show again
                    </span>
                  </button>
                ) : null}

                {op.status === 'READY' ? (
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary"
                    style={{ width: '100%', padding: '16px', fontSize: 16 }}
                    disabled={busy}
                    onClick={() =>
                      run(op.id, () => api.post(`/production/op-cards/${op.id}/start`))
                    }
                  >
                    START
                  </button>
                ) : null}

                {op.status === 'RUNNING' ? (
                  <div>
                    <div className="pc-qty-row">
                      <label>
                        Good
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={inp.good ?? ''}
                          disabled={busy}
                          onChange={(e) => patchInput(op.id, { good: e.target.value })}
                        />
                      </label>
                      <label>
                        Scrap
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={inp.scrap ?? ''}
                          disabled={busy}
                          onChange={(e) => patchInput(op.id, { scrap: e.target.value })}
                        />
                      </label>
                    </div>
                    {op.is_op1 ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ flex: 1 }}
                          disabled={busy}
                          onClick={() =>
                            run(op.id, () =>
                              api.post(`/production/op-cards/${op.id}/progress`, {
                                good_qty: Number(inp.good || 0),
                                scrap_qty: Number(inp.scrap || 0),
                              })
                            )
                          }
                        >
                          Log output
                        </button>
                        <button
                          type="button"
                          className="mes-btn mes-btn-primary"
                          style={{ flex: 1 }}
                          disabled={busy}
                          onClick={() =>
                            run(op.id, () =>
                              api.post(`/production/op-cards/${op.id}/complete`, {
                                good_qty: Number(inp.good || 0),
                                scrap_qty: Number(inp.scrap || 0),
                              })
                            )
                          }
                        >
                          Done for day
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mes-btn mes-btn-primary"
                        style={{ width: '100%', padding: '14px', fontSize: 15, marginTop: 10 }}
                        disabled={busy}
                        onClick={() => completeOpCard(op)}
                      >
                        Complete op → next
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
          {queueLots.map((lot) => {
            const busy = busyId === lot.id;
            const inp = inputs[lot.id] || {};
            return (
              <article key={`lot-${lot.id}`} className="mes-task-card is-running">
                <div className="mes-task-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="mes-task-id">
                      <Hash size={16} aria-hidden />
                      <span>{lot.lot_number}</span>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        Lot traveler
                      </span>
                      {lot.production_card_id ? (
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                          onClick={() => navigate(`/production/cards/${lot.production_card_id}`)}
                        >
                          Track route
                        </button>
                      ) : null}
                    </p>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
                      <TruncatedText>{lot.component_label || 'Component'}</TruncatedText>
                    </h2>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Qty <strong>{Number(lot.quantity || 0)}</strong>
                      {lot.current_node_label ? ` · Op: ${lot.current_node_label}` : ''}
                      {lot.current_node_type ? ` (${lot.current_node_type})` : ''}
                      {lot.work_center_code ? ` · ${lot.work_center_code}` : ''}
                      {lot.card_number ? ` · Card ${lot.card_number}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={lot.status || 'in_process'} />
                </div>
                <div className="pc-qty-row">
                  <label>
                    Scrap
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={inp.scrap ?? ''}
                      disabled={busy}
                      onChange={(e) => patchInput(lot.id, { scrap: e.target.value })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="mes-btn mes-btn-primary"
                  style={{ width: '100%', padding: '14px', fontSize: 15, marginTop: 10 }}
                  disabled={busy}
                  onClick={() => completeLot(lot)}
                >
                  Complete op → next
                </button>
              </article>
            );
          })}
          {queueCards.map((card) => {
            const goal = Number(card.day_goal ?? Number(card.target_quantity) + Number(card.overdue_quantity));
            const good = Number(card.total_good_produced || 0);
            const inp = inputs[card.id] || {};
            const busy = busyId === card.id;
            const info = detail[card.id];
            const machiningNodes = (info?.nodes || []).filter((n) => n.activity_type === 'machining');
            const outsourceNodes = (info?.nodes || []).filter((n) => n.activity_type === 'outsource');
            const openLots = (info?.lots || []).filter((l) =>
              ['in_process', 'received'].includes(l.status)
            );
            const sentShipments = (info?.shipments || []).filter((s) => s.status === 'sent');
            const toneClass =
              card.status === 'OVERDUE'
                ? 'is-overdue'
                : card.status === 'RUNNING'
                  ? 'is-running'
                  : '';

            return (
              <article key={card.id} className={`mes-task-card ${toneClass}`.trim()}>
                <div className="mes-task-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="mes-task-id">
                      <Hash size={16} aria-hidden />
                      <button
                        type="button"
                        className="pc-card-link"
                        onClick={() => navigate(`/production/cards/${card.id}`)}
                      >
                        {card.card_number}
                      </button>
                      <button
                        type="button"
                        className="mes-btn mes-btn-secondary"
                        style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                        onClick={() => navigate(`/production/cards/${card.id}`)}
                      >
                        Track route
                      </button>
                    </p>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
                      <TruncatedText>{card.component_label || 'Component'}</TruncatedText>
                    </h2>
                    <p className="muted" style={{ margin: 0 }}>
                      <TruncatedText>
                        {[card.customer_name, card.schedule_number].filter(Boolean).join(' · ')}
                      </TruncatedText>
                    </p>
                    <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                      Due{' '}
                      <strong>
                        {formatDueLabel(card.schedule_due_date, card.schedule_due_weekday_label)}
                      </strong>
                      {' · '}Work {formatDueLabel(card.work_date)}
                      {card.work_center_code ? ` · ${card.work_center_code}` : ''}
                      {card.current_node_label
                        ? ` · Op: ${card.current_node_label}`
                        : ''}
                    </p>
                  </div>
                  <StatusBadge status={card.status} />
                </div>

                <div className="pc-metrics" style={{ marginBottom: 14 }}>
                  <div>
                    <span>Goal</span>
                    <strong>{goal}</strong>
                    {Number(card.overdue_quantity) > 0 ? (
                      <small>+{card.overdue_quantity} overdue</small>
                    ) : null}
                  </div>
                  <div>
                    <span>Good</span>
                    <strong>{good}</strong>
                  </div>
                  <div>
                    <span>Remaining</span>
                    <strong>{Math.max(0, goal - good)}</strong>
                  </div>
                </div>

                {lastMintedLot[card.id]?.lot_number ? (
                  <button
                    type="button"
                    className="lot-receipt-inline"
                    onClick={() =>
                      setLotReceipt({
                        lot: lastMintedLot[card.id],
                        cardLabel: card.component_label || card.card_number,
                        cardId: card.id,
                      })
                    }
                  >
                    <span className="lot-receipt-inline-label">Lot card</span>
                    <span className="lot-receipt-inline-number">
                      {lastMintedLot[card.id].lot_number}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Tap to show again
                    </span>
                  </button>
                ) : null}

                {card.status === 'READY' || (card.status === 'OVERDUE' && !card.started_at) ? (
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary"
                    style={{ width: '100%', padding: '16px', fontSize: 16 }}
                    disabled={busy}
                    onClick={() => run(card.id, () => api.post(`/production/cards/${card.id}/start`))}
                  >
                    START
                  </button>
                ) : null}

                {card.status === 'RUNNING' || (card.status === 'OVERDUE' && card.started_at) ? (
                  <div>
                    <div className="pc-qty-row">
                      <label>
                        Good
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={inp.good ?? ''}
                          disabled={busy}
                          onChange={(e) => patchInput(card.id, { good: e.target.value })}
                        />
                      </label>
                      <label>
                        Scrap
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={inp.scrap ?? ''}
                          disabled={busy}
                          onChange={(e) => patchInput(card.id, { scrap: e.target.value })}
                        />
                      </label>
                    </div>
                    <div className="pc-action-row" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="mes-btn mes-btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          run(card.id, () =>
                            api.post(`/production/cards/${card.id}/progress`, {
                              good_qty: Number(inp.good || 0),
                              scrap_qty: Number(inp.scrap || 0),
                            })
                          )
                        }
                      >
                        Save progress
                      </button>
                      <button
                        type="button"
                        className="mes-btn mes-btn-primary"
                        disabled={busy}
                        onClick={() =>
                          run(card.id, () =>
                            api.post(`/production/cards/${card.id}/complete`, {
                              good_qty: Number(inp.good || 0),
                              scrap_qty: Number(inp.scrap || 0),
                            })
                          )
                        }
                      >
                        Done for day
                      </button>
                    </div>
                    <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                      Good qty on first machining automatically creates a lot number and sends it to the next AF step.
                    </p>

                    <details
                      className="pc-ops"
                      onToggle={async (e) => {
                        if (e.target.open) {
                          try {
                            const infoLoaded = await ensureDetail(card.id);
                            const currentId = card.current_activity_flow_node_id;
                            const machining = (infoLoaded?.nodes || []).filter(
                              (n) => n.activity_type === 'machining'
                            );
                            const defaultNode =
                              (currentId && machining.some((n) => n.id === currentId)
                                ? currentId
                                : null) ||
                              machining[0]?.id ||
                              '';
                            if (defaultNode && !(inputs[card.id] || {}).machineNode) {
                              patchInput(card.id, { machineNode: defaultNode });
                            }
                          } catch (err) {
                            setError(err.response?.data?.error || 'Unable to load operations');
                          }
                        }
                      }}
                    >
                      <summary>Lots &amp; outsource</summary>
                      {!info ? <p className="muted">Loading…</p> : null}
                      {info ? (
                        <>
                          <div className="pc-ops-block">
                            <h3>Create extra lot (optional)</h3>
                            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                              Save progress / Done for day already mints lots. Use this only to lotize more qty without
                              entering progress again.
                            </p>
                            {card.current_node_label ? (
                              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                                Current op: {card.current_node_label}
                                {card.work_center_code ? ` @ ${card.work_center_code}` : ''}
                              </p>
                            ) : null}
                            <select
                              value={
                                inp.machineNode ||
                                card.current_activity_flow_node_id ||
                                ''
                              }
                              disabled={busy}
                              onChange={(e) => patchInput(card.id, { machineNode: e.target.value })}
                            >
                              <option value="">Machining step…</option>
                              {machiningNodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.sequence}. {n.label}
                                  {n.id === card.current_activity_flow_node_id ? ' (current)' : ''}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0.0001"
                              step="any"
                              placeholder="Qty through machine"
                              value={inp.machineQty || ''}
                              disabled={busy}
                              onChange={(e) => patchInput(card.id, { machineQty: e.target.value })}
                            />
                            <button
                              type="button"
                              className="mes-btn mes-btn-primary"
                              disabled={
                                busy ||
                                !(inp.machineNode || card.current_activity_flow_node_id) ||
                                !inp.machineQty
                              }
                              onClick={() =>
                                run(card.id, () =>
                                  api.post(
                                    `/production/cards/${card.id}/operations/${
                                      inp.machineNode || card.current_activity_flow_node_id
                                    }/complete`,
                                    { quantity: Number(inp.machineQty) }
                                  )
                                )
                              }
                            >
                              Create lot
                            </button>
                          </div>

                          <div className="pc-ops-block">
                            <h3>Open lots</h3>
                            <ul className="pc-lot-list">
                              {openLots.map((l) => (
                                <li key={l.id}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={(inp.lotIds || []).includes(l.id)}
                                      onChange={(e) => {
                                        const set = new Set(inp.lotIds || []);
                                        if (e.target.checked) set.add(l.id);
                                        else set.delete(l.id);
                                        patchInput(card.id, { lotIds: [...set] });
                                      }}
                                    />
                                    {l.lot_number} · {l.quantity} · {l.status}
                                  </label>
                                </li>
                              ))}
                              {!openLots.length ? <li className="muted">No open lots yet.</li> : null}
                            </ul>

                            <select
                              value={inp.outNode || ''}
                              disabled={busy}
                              onChange={(e) => patchInput(card.id, { outNode: e.target.value })}
                            >
                              <option value="">Outsource step…</option>
                              {outsourceNodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.sequence}. {n.label}
                                </option>
                              ))}
                            </select>
                            <label className="pc-check-inline">
                              <input
                                type="checkbox"
                                checked={!!inp.merge}
                                onChange={(e) => patchInput(card.id, { merge: e.target.checked })}
                              />
                              Merge selected lots
                            </label>
                            <button
                              type="button"
                              className="mes-btn mes-btn-primary"
                              disabled={busy || !inp.outNode || !(inp.lotIds || []).length}
                              onClick={() =>
                                run(card.id, () =>
                                  api.post('/production/outsource/send', {
                                    production_card_id: card.id,
                                    activity_flow_node_id: inp.outNode,
                                    lot_ids: inp.lotIds,
                                    merge: !!inp.merge,
                                  })
                                )
                              }
                            >
                              Send outsource
                            </button>
                          </div>

                          {sentShipments.length ? (
                            <div className="pc-ops-block">
                              <h3>At supplier</h3>
                              {sentShipments.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  className="mes-btn mes-btn-secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    run(card.id, () =>
                                      api.post(`/production/outsource/${s.id}/receive`)
                                    )
                                  }
                                >
                                  Receive {s.shipment_number}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </details>
                  </div>
                ) : null}

                {card.status === 'COMPLETED' ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Done for {formatDueLabel(card.work_date)}. Good {good} / goal {goal}.
                  </p>
                ) : null}
              </article>
            );
          })}
          </div>

          {hasDoneToday ? (
            <section style={{ marginTop: 28 }}>
              <h2 className="mes-section-title" style={{ margin: '0 0 12px', fontSize: '1rem' }}>
                Done today
              </h2>
              <div className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="employees-table-wrap" style={{ margin: 0 }}>
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Operation</th>
                        <th>Card / lot</th>
                        <th>Good</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {completedOpsToday.map((row) => (
                        <tr key={`${row.source}-${row.id}`}>
                          <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                            {formatOpTime(row.completed_at)}
                          </td>
                          <td>
                            <strong>{row.op_label}</strong>
                            {row.work_center_code ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                {row.work_center_code}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <div>{row.card_number || '—'}</div>
                            {row.lot_number ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                Lot {row.lot_number}
                              </div>
                            ) : null}
                          </td>
                          <td>{Number(row.good_qty || 0)}</td>
                          <td>
                            {row.production_card_id ? (
                              <button
                                type="button"
                                className="mes-btn mes-btn-secondary"
                                style={{ padding: '2px 8px', fontSize: 12 }}
                                onClick={() => navigate(`/production/cards/${row.production_card_id}`)}
                              >
                                Track
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {lotReceipt?.lot?.lot_number ? (
        <LotReceiptModal
          lot={lotReceipt.lot}
          cardLabel={lotReceipt.cardLabel}
          onClose={() => setLotReceipt(null)}
        />
      ) : null}
    </main>
  );
}
