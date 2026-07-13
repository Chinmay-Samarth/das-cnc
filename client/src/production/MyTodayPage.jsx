import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { formatDueLabel } from '../blanketPos/scheduleLabels';
import { useSocket } from '../socket/socketContext';
import { useAuth } from '../auth/authContext';

function statusTone(status) {
  if (status === 'COMPLETED') return 'pc-tone-done';
  if (status === 'RUNNING') return 'pc-tone-run';
  if (status === 'OVERDUE') return 'pc-tone-overdue';
  return 'pc-tone-ready';
}

export default function MyTodayPage() {
  const { subscribe } = useSocket();
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState({}); // id -> { lots, nodes, shipments }
  const [inputs, setInputs] = useState({}); // id -> { good, scrap, machineQty, machineNode, lotIds, outNode, merge }

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/production/cards/my-today');
      setCards(data.cards || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load today’s tasks.');
      setCards([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('production:updated', (payload) => {
      // Refresh for own cards, or any board-wide release/rollover
      if (
        !payload?.employeeId ||
        payload.employeeId === user?.id ||
        payload.action === 'released' ||
        payload.action === 'rollover'
      ) {
        load({ silent: true });
        setDetail({});
      }
    });
  }, [subscribe, load, user?.id]);

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
    <main className="app-shell pc-floor">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Shop floor</p>
          <h1>My Today</h1>
          <p className="muted">Your daily production tasks. Overdue qty carries into the next day.</p>
        </div>
        <button type="button" className="neutral-button" onClick={load} disabled={loading}>
          Refresh
        </button>
      </header>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <div className="pc-card-stack">
        {cards.map((card) => {
          const goal = Number(card.day_goal ?? card.target_quantity + card.overdue_quantity);
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

          return (
            <article key={card.id} className={`pc-job-card ${statusTone(card.status)}`}>
              <div className="pc-job-top">
                <div>
                  <p className="pc-job-number">{card.card_number}</p>
                  <h2>{card.component_label || 'Component'}</h2>
                  <p className="muted">
                    {card.customer_name || 'Customer'}
                    {card.schedule_number ? ` · ${card.schedule_number}` : ''}
                  </p>
                  <p className="pc-due-line">
                    Due{' '}
                    <strong>
                      {formatDueLabel(
                        card.schedule_due_date,
                        card.schedule_due_weekday_label
                      )}
                    </strong>
                    {' · '}
                    Work {formatDueLabel(card.work_date)}
                  </p>
                </div>
                <span className={`pc-status-badge ${statusTone(card.status)}`}>{card.status}</span>
              </div>

              <div className="pc-metrics">
                <div>
                  <span>Goal today</span>
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
                  <span>Scrap</span>
                  <strong>{Number(card.total_scrap_produced || 0)}</strong>
                </div>
              </div>

              {card.status === 'READY' || (card.status === 'OVERDUE' && !card.started_at) ? (
                <button
                  type="button"
                  className="pc-big-btn"
                  disabled={busy}
                  onClick={() => run(card.id, () => api.post(`/production/cards/${card.id}/start`))}
                >
                  START
                </button>
              ) : null}

              {card.status === 'RUNNING' || (card.status === 'OVERDUE' && card.started_at) ? (
                <div className="pc-running-panel">
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
                  <div className="pc-action-row">
                    <button
                      type="button"
                      className="pc-big-btn pc-big-btn-secondary"
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
                      SAVE PROGRESS
                    </button>
                    <button
                      type="button"
                      className="pc-big-btn"
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
                      DONE FOR DAY
                    </button>
                  </div>

                  <details
                    className="pc-ops"
                    onToggle={async (e) => {
                      if (e.target.open) {
                        try {
                          await ensureDetail(card.id);
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
                          <select
                            value={inp.machineNode || ''}
                            disabled={busy}
                            onChange={(e) => patchInput(card.id, { machineNode: e.target.value })}
                          >
                            <option value="">Machining step…</option>
                            {machiningNodes.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.sequence}. {n.label}
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
                            className="primary-button"
                            disabled={busy || !inp.machineNode || !inp.machineQty}
                            onClick={() =>
                              run(card.id, () =>
                                api.post(
                                  `/production/cards/${card.id}/operations/${inp.machineNode}/complete`,
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
                                {n.lead_time_days != null ? ` (LT ${n.lead_time_days}d)` : ''}
                              </option>
                            ))}
                          </select>
                          <label className="pc-check-inline">
                            <input
                              type="checkbox"
                              checked={!!inp.merge}
                              onChange={(e) => patchInput(card.id, { merge: e.target.checked })}
                            />
                            Merge selected lots into one new lot
                          </label>
                          <button
                            type="button"
                            className="primary-button"
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
                                className="neutral-button"
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
                <p className="pc-done-note">Done for {formatDueLabel(card.work_date)}. Good {good} / goal {goal}.</p>
              ) : null}
            </article>
          );
        })}

        {!loading && !cards.length ? (
          <section className="card">
            <p className="muted" style={{ margin: 0 }}>
              No tasks assigned to you for today.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
