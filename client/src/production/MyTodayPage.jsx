import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle2, Gauge, Hash, RefreshCw } from 'lucide-react';
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

export default function MyTodayPage() {
  const navigate = useNavigate();
  const { joinWorkCenterRoom, leaveWorkCenterRoom } = useSocket();
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
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

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/production/cards/my-today');
      setCards(data.cards || []);
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

  // Join WC rooms for assigned cards so handoffs / board moves arrive instantly
  useEffect(() => {
    const wcIds = [
      ...new Set(cards.map((c) => c.work_center_id).filter(Boolean)),
    ];
    wcIds.forEach((id) => joinWorkCenterRoom(id));
    return () => {
      wcIds.forEach((id) => leaveWorkCenterRoom(id));
    };
  }, [cards, joinWorkCenterRoom, leaveWorkCenterRoom]);

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
        payload?.action === 'task:assigned' ||
        payload?.task_id
      ) {
        load({ silent: true });
        setDetail({});
      }
    },
    [load, user?.id]
  );

  useProductionRealtime(onRealtime, [onRealtime]);

  const metrics = useMemo(() => {
    const active = cards.filter((c) => c.status === 'RUNNING').length;
    // Prefer server totals (open progress + today's op completions) so handoffs keep credit
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
  }, [cards, completedCredit, opsCompletedToday, goodToday, goalToday, efficiencyPct]);

  async function ensureDetail(cardId) {
    if (detail[cardId]) return detail[cardId];
    const { data } = await api.get(`/production/cards/${cardId}`);
    const next = {
      lots: data.lots || [],
      nodes: data.nodes || [],
      shipments: data.shipments || [],
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
      await fn();
      await load();
      setDetail((d) => {
        const copy = { ...d };
        delete copy[cardId];
        return copy;
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Operator"
        title="My Today"
        subtitle="Focused task queue for your assigned jobs — earliest delivery due first."
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

      {!loading && !cards.length ? (
        <EmptyState
          icon={Hash}
          title="No jobs assigned"
          description="Nothing on your queue for today. Check the WC Board or ask a supervisor to assign work."
          actionLabel="Open WC Board"
          onAction={() => navigate('/production/work-centers')}
        />
      ) : (
        <div className="mes-task-queue">
          {cards.map((card) => {
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
                            <h3>Finish machining → new lot</h3>
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
      )}
    </main>
  );
}
