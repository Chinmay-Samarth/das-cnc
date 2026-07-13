import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api/client';
import ComponentSelect from './ComponentSelect';
import ReleaseToFloorModal from '../production/ReleaseToFloorModal';
import {
  WEEKDAYS,
  formatRuleLabel,
  formatDueLabel,
  formatRuleWhen,
} from './scheduleLabels';
import { useSocket } from '../socket/socketContext';
import { formatDisplayDate } from '../utils/dateFormat';

function statusClass(status) {
  if (status === 'active' || status === 'released') return 'status-pill status-active';
  if (status === 'planned' || status === 'draft') return 'status-pill';
  return 'status-pill status-inactive';
}

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="employee-detail-label">{label}</p>
      <p className="employee-detail-value">{value ?? '—'}</p>
    </div>
  );
}

export default function BlanketPoDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { subscribe, joinBlanketPoRoom, leaveBlanketPoRoom } = useSocket();

  const [blanket, setBlanket] = useState(null);
  const [tab, setTab] = useState('lines');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [releaseSchedule, setReleaseSchedule] = useState(null);

  // Lines form
  const [compId, setCompId] = useState('');
  const [compLabel, setCompLabel] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [uom, setUom] = useState('pcs');
  const [lineNotes, setLineNotes] = useState('');

  // Rules
  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState({
    blanket_po_line_id: '',
    cadence: 'weekly',
    weekday: '1',
    month_day: '1',
    default_quantity: '1',
  });

  // Schedules
  const [schedules, setSchedules] = useState([]);
  const [genForm, setGenForm] = useState({
    rule_id: '',
    horizon_start: '',
    horizon_end: '',
  });
  const [oneOff, setOneOff] = useState({
    blanket_po_line_id: '',
    due_date: '',
    quantity: '1',
  });

  const loadBlanket = useCallback(async () => {
    const { data } = await api.get(`/blanket-pos/${id}`);
    setBlanket(data.blanket_po);
    return data.blanket_po;
  }, [id]);

  const loadRulesForLines = useCallback(async (lines) => {
    if (!lines?.length) {
      setRules([]);
      return;
    }
    const results = await Promise.all(
      lines.map((l) =>
        api
          .get('/delivery-schedules/rules', { params: { blanket_po_line_id: l.id } })
          .then(({ data }) => data.rules || [])
          .catch(() => [])
      )
    );
    setRules(results.flat());
  }, []);

  const loadSchedules = useCallback(async () => {
    const { data } = await api.get('/delivery-schedules', {
      params: { blanket_po_id: id },
    });
    setSchedules(data.schedules || []);
  }, [id]);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const b = await loadBlanket();
      await Promise.all([loadRulesForLines(b.lines || []), loadSchedules()]);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load blanket PO.');
      setBlanket(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loadBlanket, loadRulesForLines, loadSchedules]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!id) return undefined;
    joinBlanketPoRoom(id);
    return () => leaveBlanketPoRoom(id);
  }, [id, joinBlanketPoRoom, leaveBlanketPoRoom]);

  useEffect(() => {
    return subscribe('delivery-schedule:updated', (payload) => {
      if (!payload?.blanketPoId || payload.blanketPoId === id) {
        reload({ silent: true });
      }
    });
  }, [subscribe, reload, id]);

  useEffect(() => {
    return subscribe('production:updated', (payload) => {
      if (payload?.action === 'released') {
        reload({ silent: true });
      }
    });
  }, [subscribe, reload]);

  async function runAction(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload({ silent: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(action) {
    await runAction(() => api.post(`/blanket-pos/${id}/${action}`));
  }

  async function handleAddLine(e) {
    e.preventDefault();
    await runAction(async () => {
      await api.post(`/blanket-pos/${id}/lines`, {
        master_record_id: compId,
        unit_price: Number(unitPrice),
        uom,
        notes: lineNotes.trim() || null,
      });
      setCompId('');
      setCompLabel('');
      setUnitPrice('');
      setUom('pcs');
      setLineNotes('');
    });
  }

  async function handleDeleteLine(lineId) {
    if (!window.confirm('Delete this line?')) return;
    await runAction(() => api.delete(`/blanket-pos/${id}/lines/${lineId}`));
  }

  async function handleAddRule(e) {
    e.preventDefault();
    const body = {
      blanket_po_line_id: ruleForm.blanket_po_line_id,
      cadence: ruleForm.cadence,
      default_quantity: Number(ruleForm.default_quantity),
    };
    if (ruleForm.cadence === 'weekly') body.weekday = Number(ruleForm.weekday);
    else body.month_day = Number(ruleForm.month_day);

    await runAction(async () => {
      await api.post('/delivery-schedules/rules', body);
      setRuleForm((f) => ({
        ...f,
        default_quantity: '1',
      }));
    });
  }

  async function handleActivateRule(ruleId) {
    await runAction(() => api.post(`/delivery-schedules/rules/${ruleId}/activate`));
  }

  async function handleDeactivateRule(ruleId) {
    await runAction(() => api.post(`/delivery-schedules/rules/${ruleId}/deactivate`));
  }

  async function handleGenerate(e) {
    e.preventDefault();
    await runAction(async () => {
      const { data } = await api.post('/delivery-schedules/generate', {
        rule_id: genForm.rule_id,
        horizon_start: genForm.horizon_start,
        horizon_end: genForm.horizon_end,
      });
      alert(
        `Created ${data.created_count} schedule(s)` +
          (data.skipped_count ? `, skipped ${data.skipped_count} existing date(s)` : '')
      );
    });
  }

  async function handleOneOff(e) {
    e.preventDefault();
    await runAction(async () => {
      await api.post('/delivery-schedules', {
        blanket_po_line_id: oneOff.blanket_po_line_id,
        due_date: oneOff.due_date,
        quantity: Number(oneOff.quantity),
      });
      setOneOff((f) => ({ ...f, due_date: '', quantity: '1' }));
    });
  }

  async function handleRelease(schedule) {
    setReleaseSchedule(schedule);
  }

  async function handleCancelSchedule(scheduleId) {
    if (!window.confirm('Cancel this delivery schedule?')) return;
    await runAction(() => api.post(`/delivery-schedules/${scheduleId}/cancel`));
  }

  async function handleEditQty(schedule) {
    const next = window.prompt('New quantity', String(schedule.quantity));
    if (next == null) return;
    const qty = Number(next);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }
    await runAction(() => api.patch(`/delivery-schedules/${schedule.id}`, { quantity: qty }));
  }

  const lines = blanket?.lines || [];
  const activeRules = rules.filter((r) => r.is_active);

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <p onClick={() => navigate('/blanket-pos')} style={{ cursor: 'pointer' }}>
          <ArrowLeft size={16} style={{ marginRight: 4, display: 'inline' }} />
          Back to blanket POs
        </p>
        <div className="employee-title-block">
          <div>
            <h1>{blanket?.blanket_number || 'Blanket PO'}</h1>
            <p className="muted">{blanket?.customer_name}</p>
          </div>
          <div className="employee-top-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {blanket?.status === 'draft' || blanket?.status === 'on_hold' ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => handleStatus('activate')}
              >
                Activate
              </button>
            ) : null}
            {blanket?.status === 'active' ? (
              <button
                type="button"
                className="neutral-button"
                disabled={busy}
                onClick={() => handleStatus('hold')}
              >
                Hold
              </button>
            ) : null}
            {blanket?.status === 'active' || blanket?.status === 'on_hold' ? (
              <button
                type="button"
                className="cancel-button"
                disabled={busy}
                onClick={() => handleStatus('close')}
              >
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div className="pill-tabs">
          {['lines', 'rules', 'schedules'].map((t) => (
            <button
              key={t}
              type="button"
              className={`pill-tab ${tab === t ? 'pill-tab-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'lines' ? 'Lines' : t === 'rules' ? 'Schedule rules' : 'Schedules'}
            </button>
          ))}
        </div>
      </header>

      <section className="card employee-main">
        {loading ? <p className="muted">Loading...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}

        {!loading && blanket ? (
          <>
            <div className="employee-detail-grid" style={{ marginBottom: 20 }}>
              <DetailItem label="Status" value={blanket.status} />
              <DetailItem label="Currency" value={blanket.currency} />
              <DetailItem
                label="Valid"
                value={
                  blanket.valid_from
                    ? `${formatDisplayDate(blanket.valid_from)} — ${blanket.valid_to ? formatDisplayDate(blanket.valid_to) : 'present'}`
                    : blanket.status === 'draft'
                      ? 'Not activated yet'
                      : '—'
                }
              />
              <DetailItem label="Payment terms" value={blanket.payment_terms} />
              <DetailItem label="Notes" value={blanket.notes} />
            </div>

            {tab === 'lines' ? (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Lines</h2>
                <div className="employees-table-wrap" style={{ marginBottom: 20 }}>
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Component</th>
                        <th>UOM</th>
                        <th>Unit price</th>
                        <th>Released qty</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.line_no}</td>
                          <td>{l.component_label}</td>
                          <td>{l.uom}</td>
                          <td>{l.unit_price}</td>
                          <td>{l.released_qty}</td>
                          <td>
                            {Number(l.released_qty) === 0 ? (
                              <button
                                type="button"
                                className="cancel-button"
                                disabled={busy}
                                onClick={() => handleDeleteLine(l.id)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!lines.length ? (
                        <tr>
                          <td colSpan="6" className="muted">
                            No lines yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {blanket.status !== 'closed' && blanket.status !== 'cancelled' ? (
                  <form onSubmit={handleAddLine} className="af-inspector" style={{ maxWidth: 480 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>Add line</h3>
                    <label>
                      <span className="employee-detail-label">Component</span>
                      <ComponentSelect
                        value={compId}
                        label={compLabel}
                        disabled={busy}
                        onChange={({ id: cid, label }) => {
                          setCompId(cid);
                          setCompLabel(label);
                        }}
                      />
                    </label>
                    <label>
                      <span className="employee-detail-label">Unit price</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={unitPrice}
                        onChange={(e) => setUnitPrice(e.target.value)}
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="employee-detail-label">UOM</span>
                      <input value={uom} onChange={(e) => setUom(e.target.value)} disabled={busy} />
                    </label>
                    <label>
                      <span className="employee-detail-label">Notes</span>
                      <input
                        value={lineNotes}
                        onChange={(e) => setLineNotes(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={busy || !compId || unitPrice === ''}
                    >
                      Add line
                    </button>
                  </form>
                ) : null}
              </>
            ) : null}

            {tab === 'rules' ? (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recurring schedule rules</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Add a draft rule, then activate it. Validity starts today and stays open until you
                  deactivate or replace it. Activating a new rule for the same line + day retires the
                  previous active one (stop date = today).
                </p>

                <div className="employees-table-wrap" style={{ marginBottom: 20 }}>
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Cadence</th>
                        <th>When</th>
                        <th>Qty</th>
                        <th>Valid</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r) => {
                        const line = lines.find((l) => l.id === r.blanket_po_line_id);
                        const ruleStatus = r.is_active
                          ? 'active'
                          : r.valid_from
                            ? 'closed'
                            : 'draft';
                        return (
                          <tr key={r.id}>
                            <td>{line?.component_label || r.blanket_po_line_id.slice(0, 8)}</td>
                            <td>{r.cadence}</td>
                            <td>{formatRuleWhen(r)}</td>
                            <td>{r.default_quantity}</td>
                            <td>
                              {r.valid_from
                                ? `${formatDisplayDate(r.valid_from)} — ${r.valid_to ? formatDisplayDate(r.valid_to) : 'present'}`
                                : '—'}
                            </td>
                            <td>
                              <span className={statusClass(ruleStatus)}>{ruleStatus}</span>
                            </td>
                            <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {!r.is_active && !r.valid_from ? (
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={busy || blanket.status !== 'active'}
                                  onClick={() => handleActivateRule(r.id)}
                                >
                                  Activate
                                </button>
                              ) : null}
                              {r.is_active ? (
                                <button
                                  type="button"
                                  className="neutral-button"
                                  disabled={busy}
                                  onClick={() => handleDeactivateRule(r.id)}
                                >
                                  Deactivate
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {!rules.length ? (
                        <tr>
                          <td colSpan="7" className="muted">
                            No rules yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {blanket.status === 'active' && lines.length ? (
                  <form onSubmit={handleAddRule} className="af-inspector" style={{ maxWidth: 480 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>Add draft rule</h3>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      Dates are set automatically when you activate.
                    </p>
                    <label>
                      <span className="employee-detail-label">Line</span>
                      <select
                        value={ruleForm.blanket_po_line_id}
                        onChange={(e) =>
                          setRuleForm((f) => ({ ...f, blanket_po_line_id: e.target.value }))
                        }
                        required
                        disabled={busy}
                      >
                        <option value="">Select line</option>
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            #{l.line_no} {l.component_label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="employee-detail-label">Cadence</span>
                      <select
                        value={ruleForm.cadence}
                        onChange={(e) => setRuleForm((f) => ({ ...f, cadence: e.target.value }))}
                        disabled={busy}
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    {ruleForm.cadence === 'weekly' ? (
                      <label>
                        <span className="employee-detail-label">Weekday</span>
                        <select
                          value={ruleForm.weekday}
                          onChange={(e) => setRuleForm((f) => ({ ...f, weekday: e.target.value }))}
                          disabled={busy}
                        >
                          {WEEKDAYS.map((w) => (
                            <option key={w.value} value={w.value}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        <span className="employee-detail-label">Day of month (1–28)</span>
                        <input
                          type="number"
                          min="1"
                          max="28"
                          value={ruleForm.month_day}
                          onChange={(e) => setRuleForm((f) => ({ ...f, month_day: e.target.value }))}
                          disabled={busy}
                          required
                        />
                      </label>
                    )}
                    <label>
                      <span className="employee-detail-label">Default quantity</span>
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={ruleForm.default_quantity}
                        onChange={(e) =>
                          setRuleForm((f) => ({ ...f, default_quantity: e.target.value }))
                        }
                        required
                        disabled={busy}
                      />
                    </label>
                    <button type="submit" className="primary-button" disabled={busy}>
                      Add draft rule
                    </button>
                  </form>
                ) : (
                  <p className="muted">Activate the blanket and add lines to create schedule rules.</p>
                )}
              </>
            ) : null}

            {tab === 'schedules' ? (
              <>
                <h2 style={{ fontSize: 16, marginBottom: 12 }}>Delivery schedules</h2>

                {blanket.status === 'active' && activeRules.length ? (
                  <form
                    onSubmit={handleGenerate}
                    className="af-inspector"
                    style={{ maxWidth: 520, marginBottom: 24 }}
                  >
                    <h3 style={{ margin: 0, fontSize: 14 }}>Generate from rule</h3>
                    <label>
                      <span className="employee-detail-label">Rule</span>
                      <select
                        value={genForm.rule_id}
                        onChange={(e) => setGenForm((f) => ({ ...f, rule_id: e.target.value }))}
                        required
                        disabled={busy}
                      >
                        <option value="">Select rule</option>
                        {activeRules.map((r) => {
                          const line = lines.find((l) => l.id === r.blanket_po_line_id);
                          return (
                            <option key={r.id} value={r.id}>
                              {formatRuleLabel({
                                ...r,
                                component_label: line?.component_label,
                              })}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      <span className="employee-detail-label">Horizon start</span>
                      <input
                        type="date"
                        value={genForm.horizon_start}
                        onChange={(e) =>
                          setGenForm((f) => ({ ...f, horizon_start: e.target.value }))
                        }
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="employee-detail-label">Horizon end</span>
                      <input
                        type="date"
                        value={genForm.horizon_end}
                        onChange={(e) => setGenForm((f) => ({ ...f, horizon_end: e.target.value }))}
                        required
                        disabled={busy}
                      />
                    </label>
                    <button type="submit" className="primary-button" disabled={busy}>
                      Generate occurrences
                    </button>
                  </form>
                ) : null}

                {blanket.status === 'active' && lines.length ? (
                  <form
                    onSubmit={handleOneOff}
                    className="af-inspector"
                    style={{ maxWidth: 520, marginBottom: 24 }}
                  >
                    <h3 style={{ margin: 0, fontSize: 14 }}>Add one-off schedule</h3>
                    <label>
                      <span className="employee-detail-label">Line</span>
                      <select
                        value={oneOff.blanket_po_line_id}
                        onChange={(e) =>
                          setOneOff((f) => ({ ...f, blanket_po_line_id: e.target.value }))
                        }
                        required
                        disabled={busy}
                      >
                        <option value="">Select line</option>
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            #{l.line_no} {l.component_label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="employee-detail-label">Due date</span>
                      <input
                        type="date"
                        value={oneOff.due_date}
                        onChange={(e) => setOneOff((f) => ({ ...f, due_date: e.target.value }))}
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="employee-detail-label">Quantity</span>
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={oneOff.quantity}
                        onChange={(e) => setOneOff((f) => ({ ...f, quantity: e.target.value }))}
                        required
                        disabled={busy}
                      />
                    </label>
                    <button type="submit" className="primary-button" disabled={busy}>
                      Add schedule
                    </button>
                  </form>
                ) : null}

                <div className="employees-table-wrap">
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Number</th>
                        <th>Due</th>
                        <th>Component</th>
                        <th>Qty</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map((s) => (
                        <tr key={s.id}>
                          <td>{s.schedule_number}</td>
                          <td>
                            <strong>
                              {formatDueLabel(s.due_date, s.due_weekday_label)}
                            </strong>
                            {s.rule_weekday_label || s.rule_month_day != null ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                Rule:{' '}
                                {s.rule_cadence === 'weekly'
                                  ? `Weekly ${s.rule_weekday_label}`
                                  : s.rule_cadence === 'monthly'
                                    ? `Monthly day ${s.rule_month_day}`
                                    : s.rule_cadence}
                              </div>
                            ) : null}
                          </td>
                          <td>{s.component_label}</td>
                          <td>{s.quantity}</td>
                          <td>
                            <span className={statusClass(s.status)}>{s.status}</span>
                          </td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {s.status === 'planned' || s.status === 'released' ? (
                              <>
                                {s.status === 'planned' ? (
                                  <button
                                    type="button"
                                    className="neutral-button"
                                    disabled={busy}
                                    onClick={() => handleEditQty(s)}
                                  >
                                    Edit qty
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={busy}
                                  onClick={() => handleRelease(s)}
                                >
                                  Release to shop floor
                                </button>
                              </>
                            ) : null}
                            {s.status !== 'cancelled' ? (
                              <button
                                type="button"
                                className="neutral-button"
                                disabled={busy}
                                onClick={() => handleCancelSchedule(s.id)}
                              >
                                Cancel
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!schedules.length ? (
                        <tr>
                          <td colSpan="6" className="muted">
                            No schedules yet. Generate from a rule or add a one-off.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      <ReleaseToFloorModal
        open={!!releaseSchedule}
        schedule={releaseSchedule}
        onClose={() => setReleaseSchedule(null)}
        onReleased={async () => {
          setReleaseSchedule(null);
          await reload();
        }}
      />
    </main>
  );
}
