import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Package,
  CalendarRange,
  Truck,
  Plus,
} from 'lucide-react';
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
import {
  PageHeader,
  StatusBadge,
  MetricCard,
  ProgressBar,
  EmptyState,
  TruncatedText,
} from '../components/mes';

function formatMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function carrierLabel(status) {
  if (status === 'released') return 'Released to floor';
  if (status === 'planned') return 'Awaiting release';
  if (status === 'cancelled') return 'Cancelled';
  return status || '—';
}

const TABS = [
  { id: 'lines', label: 'Lines', icon: Package },
  { id: 'rules', label: 'Schedule rules', icon: CalendarRange },
  { id: 'schedules', label: 'Schedules', icon: Truck },
];

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
  const [showTerms, setShowTerms] = useState(false);

  const [compId, setCompId] = useState('');
  const [compLabel, setCompLabel] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [uom, setUom] = useState('pcs');
  const [lineNotes, setLineNotes] = useState('');

  const [rules, setRules] = useState([]);
  const [ruleForm, setRuleForm] = useState({
    blanket_po_line_id: '',
    cadence: 'weekly',
    weekday: '1',
    month_day: '1',
    default_quantity: '1',
  });

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

  const reload = useCallback(
    async ({ silent = false } = {}) => {
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
    },
    [loadBlanket, loadRulesForLines, loadSchedules]
  );

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

  const drawDown = useMemo(() => {
    const released = lines.reduce(
      (s, l) => s + Number(l.released_qty || 0) * Number(l.unit_price || 0),
      0
    );
    const contract = schedules
      .filter((s) => s.status !== 'cancelled')
      .reduce((s, row) => {
        const line = lines.find((l) => l.id === row.blanket_po_line_id);
        const price = Number(line?.unit_price || 0);
        return s + Number(row.quantity || 0) * price;
      }, 0);
    return {
      released,
      contract: contract > 0 ? contract : Math.max(released, 1),
    };
  }, [lines, schedules]);

  const sortedSchedules = useMemo(
    () =>
      [...schedules].sort((a, b) => {
        const da = a.due_date || '9999-12-31';
        const db = b.due_date || '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return String(a.schedule_number || '').localeCompare(String(b.schedule_number || ''));
      }),
    [schedules]
  );

  const plannedCount = schedules.filter((s) => s.status === 'planned').length;
  const releasedCount = schedules.filter((s) => s.status === 'released').length;

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Sourcing"
        title={blanket?.blanket_number || 'Blanket PO'}
        subtitle={
          blanket
            ? `${blanket.customer_name || 'Customer'} · locked part pricing and delivery plan`
            : 'Loading contract…'
        }
        actions={
          <>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => navigate('/blanket-pos')}
            >
              <ArrowLeft size={16} />
              All contracts
            </button>
            {blanket?.status === 'draft' || blanket?.status === 'on_hold' ? (
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                disabled={busy}
                onClick={() => handleStatus('activate')}
              >
                Activate
              </button>
            ) : null}
            {blanket?.status === 'active' ? (
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                disabled={busy}
                onClick={() => handleStatus('hold')}
              >
                Hold
              </button>
            ) : null}
            {blanket?.status === 'active' || blanket?.status === 'on_hold' ? (
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                disabled={busy}
                onClick={() => handleStatus('close')}
              >
                Close
              </button>
            ) : null}
          </>
        }
      />

      {loading ? <p className="muted">Loading contract…</p> : null}
      {error ? <p className="error-message">{error}</p> : null}

      {!loading && blanket ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={blanket.status} />
            <span className="muted" style={{ fontSize: 13 }}>
              {blanket.valid_from
                ? `Valid ${formatDisplayDate(blanket.valid_from)} — ${
                    blanket.valid_to ? formatDisplayDate(blanket.valid_to) : 'present'
                  }`
                : blanket.status === 'draft'
                  ? 'Not activated yet'
                  : '—'}
            </span>
          </div>

          <div className="mes-metric-grid">
            <MetricCard
              label="Drawn down"
              value={formatMoney(drawDown.released)}
              hint={`of ${formatMoney(drawDown.contract)} scheduled`}
              tone="info"
            />
            <MetricCard label="Lines" value={lines.length} icon={Package} />
            <MetricCard
              label="Active rules"
              value={activeRules.length}
              hint={`${rules.length} total`}
              icon={CalendarRange}
            />
            <MetricCard
              label="Schedules"
              value={schedules.length}
              hint={`${plannedCount} planned · ${releasedCount} released`}
              icon={Truck}
            />
          </div>

          <div className="mes-card" style={{ marginBottom: 20 }}>
            <ProgressBar
              value={drawDown.released}
              max={drawDown.contract}
              label="Contract draw-down"
            />
            <div className="mes-detail-grid" style={{ marginTop: 16 }}>
              <div>
                <p className="mes-detail-label">Currency</p>
                <p className="mes-detail-value">{blanket.currency || 'INR'}</p>
              </div>
              <div>
                <p className="mes-detail-label">Customer</p>
                <p className="mes-detail-value">
                  <TruncatedText>{blanket.customer_name || '—'}</TruncatedText>
                </p>
              </div>
              <div>
                <p className="mes-detail-label">Payment terms</p>
                <p className="mes-detail-value">{blanket.payment_terms || '—'}</p>
              </div>
            </div>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => setShowTerms((v) => !v)}
            >
              {showTerms ? 'Hide notes' : 'Show notes'}
            </button>
            {showTerms ? (
              <p className="mes-detail-value" style={{ marginTop: 12 }}>
                {blanket.notes || 'No notes on this contract.'}
              </p>
            ) : null}
          </div>

          <div className="pill-tabs" style={{ marginBottom: 16 }} role="tablist">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`pill-tab ${tab === t.id ? 'pill-tab-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <Icon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'lines' ? (
            <section className="mes-card">
              <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Contract lines</h2>
              <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
                Locked unit prices for each component on this blanket.
              </p>

              {!lines.length ? (
                <EmptyState
                  icon={Package}
                  title="No lines yet"
                  description="Add a component and locked unit price to start planning deliveries."
                />
              ) : (
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
                          <td>
                            <TruncatedText as="strong">{l.component_label}</TruncatedText>
                          </td>
                          <td>{l.uom}</td>
                          <td>₹{Number(l.unit_price).toLocaleString('en-IN')}</td>
                          <td>{l.released_qty}</td>
                          <td>
                            {Number(l.released_qty) === 0 ? (
                              <button
                                type="button"
                                className="mes-btn mes-btn-secondary"
                                disabled={busy}
                                onClick={() => handleDeleteLine(l.id)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {blanket.status !== 'closed' && blanket.status !== 'cancelled' ? (
                <form
                  onSubmit={handleAddLine}
                  className="mes-card"
                  style={{ background: 'var(--bg-raised)', boxShadow: 'none' }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={16} /> Add line
                  </h3>
                  <div className="bpo-grid-2">
                    <label>
                      Component
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
                      Unit price
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
                      UOM
                      <input value={uom} onChange={(e) => setUom(e.target.value)} disabled={busy} />
                    </label>
                    <label>
                      Notes
                      <input
                        value={lineNotes}
                        onChange={(e) => setLineNotes(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="mes-btn mes-btn-primary"
                    style={{ marginTop: 12 }}
                    disabled={busy || !compId || unitPrice === ''}
                  >
                    Add line
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}

          {tab === 'rules' ? (
            <section className="mes-card">
              <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Recurring schedule rules</h2>
              <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
                Draft a rule, then activate it. Activating starts validity today; a new rule for the
                same line + day retires the previous one.
              </p>

              {!rules.length ? (
                <EmptyState
                  icon={CalendarRange}
                  title="No schedule rules"
                  description="Add a weekly or monthly rule after the blanket is active and has lines."
                />
              ) : (
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
                            <td>
                              <TruncatedText>
                                {line?.component_label || r.blanket_po_line_id.slice(0, 8)}
                              </TruncatedText>
                            </td>
                            <td>{r.cadence}</td>
                            <td>{formatRuleWhen(r)}</td>
                            <td>{r.default_quantity}</td>
                            <td>
                              {r.valid_from
                                ? `${formatDisplayDate(r.valid_from)} — ${
                                    r.valid_to ? formatDisplayDate(r.valid_to) : 'present'
                                  }`
                                : '—'}
                            </td>
                            <td>
                              <StatusBadge status={ruleStatus} />
                            </td>
                            <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {!r.is_active && !r.valid_from ? (
                                <button
                                  type="button"
                                  className="mes-btn mes-btn-primary"
                                  disabled={busy || blanket.status !== 'active'}
                                  onClick={() => handleActivateRule(r.id)}
                                >
                                  Activate
                                </button>
                              ) : null}
                              {r.is_active ? (
                                <button
                                  type="button"
                                  className="mes-btn mes-btn-secondary"
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
                    </tbody>
                  </table>
                </div>
              )}

              {blanket.status === 'active' && lines.length ? (
                <form
                  onSubmit={handleAddRule}
                  className="mes-card"
                  style={{ background: 'var(--bg-raised)', boxShadow: 'none' }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Add draft rule</h3>
                  <div className="bpo-grid-2">
                    <label>
                      Line
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
                      Cadence
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
                        Weekday
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
                        Day of month (1–28)
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
                      Default quantity
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
                  </div>
                  <button type="submit" className="mes-btn mes-btn-primary" style={{ marginTop: 12 }} disabled={busy}>
                    Add draft rule
                  </button>
                </form>
              ) : (
                <p className="muted" style={{ marginTop: 12 }}>
                  Activate the blanket and add lines to create schedule rules.
                </p>
              )}
            </section>
          ) : null}

          {tab === 'schedules' ? (
            <section className="mes-card">
              <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Delivery schedules</h2>
              <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
                Dated deliveries sorted by soonest due. Release planned rows to create shop-floor cards.
              </p>

              {blanket.status === 'active' && activeRules.length ? (
                <form
                  onSubmit={handleGenerate}
                  className="mes-card"
                  style={{ background: 'var(--bg-raised)', boxShadow: 'none', marginBottom: 16 }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Generate from rule</h3>
                  <div className="bpo-grid-3">
                    <label>
                      Rule
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
                      Horizon start
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
                      Horizon end
                      <input
                        type="date"
                        value={genForm.horizon_end}
                        onChange={(e) => setGenForm((f) => ({ ...f, horizon_end: e.target.value }))}
                        required
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <button type="submit" className="mes-btn mes-btn-primary" style={{ marginTop: 12 }} disabled={busy}>
                    Generate occurrences
                  </button>
                </form>
              ) : null}

              {blanket.status === 'active' && lines.length ? (
                <form
                  onSubmit={handleOneOff}
                  className="mes-card"
                  style={{ background: 'var(--bg-raised)', boxShadow: 'none', marginBottom: 16 }}
                >
                  <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Add one-off schedule</h3>
                  <div className="bpo-grid-3">
                    <label>
                      Line
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
                      Due date
                      <input
                        type="date"
                        value={oneOff.due_date}
                        onChange={(e) => setOneOff((f) => ({ ...f, due_date: e.target.value }))}
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Quantity
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
                  </div>
                  <button type="submit" className="mes-btn mes-btn-primary" style={{ marginTop: 12 }} disabled={busy}>
                    Add schedule
                  </button>
                </form>
              ) : null}

              {!sortedSchedules.length ? (
                <EmptyState
                  icon={Truck}
                  title="No delivery schedules yet"
                  description="Generate from an active rule over a horizon, or add a one-off due date."
                />
              ) : (
                <div className="mes-ship-stack">
                  {sortedSchedules.map((s) => (
                    <article key={s.id} className="mes-ship-card">
                      <div>
                        <p className="mes-ship-eta">
                          {formatDueLabel(s.due_date, s.due_weekday_label)}
                          <small>ETA / due</small>
                        </p>
                      </div>
                      <div className="mes-ship-body">
                        <h3>
                          <TruncatedText>{s.schedule_number}</TruncatedText>
                        </h3>
                        <p>
                          <TruncatedText>{s.component_label || '—'}</TruncatedText>
                        </p>
                        <p style={{ marginTop: 6 }}>
                          Qty <strong>{s.quantity}</strong>
                          {s.rule_weekday_label
                            ? ` · weekly ${s.rule_weekday_label}`
                            : s.rule_month_day != null
                              ? ` · monthly day ${s.rule_month_day}`
                              : ''}
                        </p>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 8,
                        }}
                      >
                        <StatusBadge status={s.status}>{carrierLabel(s.status)}</StatusBadge>
                        <div className="" style={{display: 'flex', flexDirection: 'row', gap: 4}}>
                        {s.status === 'planned' ? (
                          <>
                            <button
                              type="button"
                              className="mes-btn mes-btn-secondary"
                              disabled={busy}
                              onClick={() => handleEditQty(s)}
                            >
                              Edit qty
                            </button>
                            <button
                              type="button"
                              className="mes-btn mes-btn-primary"
                              disabled={busy}
                              onClick={() => setReleaseSchedule(s)}
                            >
                              Release to floor
                            </button>
                          </>
                        ) : null}
                        {s.status !== 'cancelled' ? (
                          <button
                            type="button"
                            className="mes-btn mes-btn-secondary"
                            disabled={busy}
                            onClick={() => handleCancelSchedule(s.id)}
                          >
                            Cancel
                          </button>
                        ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}

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
