import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CalendarRange } from 'lucide-react';
import api from '../api/client';
import ComponentSelect from './ComponentSelect';
import { WEEKDAYS, weekdayName } from './scheduleLabels';
import { formatDisplayDate, parseDateListToISO } from '../utils/dateFormat';
import { EmptyState, PageHeader } from '../components/mes';

const STEPS = [
  { id: 1, title: 'Customer', hint: 'Who is this contract for?' },
  { id: 2, title: 'Part & price', hint: 'Component and locked unit price' },
  { id: 3, title: 'Delivery cadence', hint: 'How often and how much' },
];

const CADENCE_MODES = [
  { id: 'weekly', label: 'Weekly', hint: 'Same weekday every week' },
  { id: 'biweekly', label: 'Every 2 weeks', hint: 'Alternate weeks from an anchor' },
  { id: 'n_weeks', label: 'Every N weeks', hint: 'Custom week interval' },
  { id: 'monthly', label: 'Monthly', hint: 'Day of month (1–31)' },
  { id: 'custom', label: 'Custom dates', hint: 'Explicit preferred dates' },
];

function emptyWeek() {
  return WEEKDAYS.reduce((acc, d) => {
    acc[d.value] = { enabled: false, qty: '' };
    return acc;
  }, {});
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function plusWeeks(iso, weeks) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function plusMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function defaultHorizonEnd(mode, start) {
  if (mode === 'monthly') return plusMonths(start, 3);
  if (mode === 'biweekly' || mode === 'n_weeks') return plusWeeks(start, 12);
  if (mode === 'custom') return plusMonths(start, 6);
  return plusWeeks(start, 8);
}

export default function AddBlanketPoPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [compId, setCompId] = useState('');
  const [compLabel, setCompLabel] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [uom, setUom] = useState('pcs');
  const [cadenceMode, setCadenceMode] = useState('weekly');
  const [week, setWeek] = useState(emptyWeek);
  const [intervalWeeks, setIntervalWeeks] = useState('3');
  const [anchorDate, setAnchorDate] = useState('');
  const [monthDay, setMonthDay] = useState('15');
  const [monthQty, setMonthQty] = useState('');
  const [customDatesText, setCustomDatesText] = useState('');
  const [customQty, setCustomQty] = useState('');
  const [activateNow, setActivateNow] = useState(true);
  const [horizonStart, setHorizonStart] = useState(todayStr);
  const [horizonEnd, setHorizonEnd] = useState(() => plusWeeks(todayStr(), 8));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/customers')
      .then(({ data }) => setCustomers(data.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  const customerName = useMemo(
    () => customers.find((c) => String(c.id) === String(customerId))?.name || '',
    [customers, customerId]
  );

  const enabledDays = useMemo(
    () => WEEKDAYS.filter((d) => week[d.value]?.enabled && Number(week[d.value].qty) > 0),
    [week]
  );

  const customDates = useMemo(() => parseDateListToISO(customDatesText), [customDatesText]);

  const isWeeklyFamily = cadenceMode === 'weekly' || cadenceMode === 'biweekly' || cadenceMode === 'n_weeks';

  function resolvedInterval() {
    if (cadenceMode === 'biweekly') return 2;
    if (cadenceMode === 'n_weeks') {
      const n = Number(intervalWeeks);
      return Number.isInteger(n) && n >= 1 ? n : 1;
    }
    return 1;
  }

  function selectCadenceMode(mode) {
    setCadenceMode(mode);
    setHorizonEnd(defaultHorizonEnd(mode, horizonStart));
  }

  function toggleDay(day) {
    setWeek((w) => ({
      ...w,
      [day]: {
        enabled: !w[day].enabled,
        qty: w[day].qty || '',
      },
    }));
  }

  function setDayQty(day, qty) {
    setWeek((w) => ({
      ...w,
      [day]: { ...w[day], enabled: true, qty },
    }));
  }

  function canNext() {
    if (step === 1) return Boolean(customerId);
    if (step === 2) {
      const price = Number(unitPrice);
      return Boolean(compId) && Number.isFinite(price) && price >= 0;
    }
    return true;
  }

  function cadenceValid() {
    if (isWeeklyFamily) return enabledDays.length > 0;
    if (cadenceMode === 'monthly') {
      const day = Number(monthDay);
      const qty = Number(monthQty);
      return Number.isInteger(day) && day >= 1 && day <= 31 && Number.isFinite(qty) && qty > 0;
    }
    if (cadenceMode === 'custom') {
      const qty = Number(customQty);
      return customDates.length > 0 && Number.isFinite(qty) && qty > 0;
    }
    return false;
  }

  function cadenceSummary() {
    if (isWeeklyFamily) {
      const iv = resolvedInterval();
      const days = enabledDays.map((d) => `${d.short} ${week[d.value].qty}`).join(' · ');
      if (!days) return 'None selected';
      if (iv <= 1) return days;
      return `Every ${iv} weeks · ${days}${anchorDate ? ` · from ${formatDisplayDate(anchorDate)}` : ''}`;
    }
    if (cadenceMode === 'monthly') {
      return `Day ${monthDay || '—'} · qty ${monthQty || '—'}`;
    }
    return `${customDates.length} date(s) · qty ${customQty || '—'}`;
  }

  async function handleSubmit() {
    if (!cadenceValid()) {
      setError(
        isWeeklyFamily
          ? 'Turn on at least one delivery day and enter a quantity.'
          : cadenceMode === 'monthly'
            ? 'Set a day of month (1–31) and quantity.'
            : 'Paste at least one DD-MM-YYYY date and a default quantity.'
      );
      return;
    }
    if (activateNow && (!horizonStart || !horizonEnd || horizonEnd < horizonStart)) {
      setError('Set a valid schedule horizon (end on or after start).');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data: created } = await api.post('/blanket-pos', {
        customer_id: customerId,
        currency: 'INR',
        payment_terms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      });
      const blanketId = created.blanket_po.id;

      const { data: lineRes } = await api.post(`/blanket-pos/${blanketId}/lines`, {
        master_record_id: compId,
        unit_price: Number(unitPrice),
        uom: uom.trim() || 'pcs',
      });
      const lineId = lineRes.line.id;

      const ruleIds = [];
      const interval = resolvedInterval();

      if (isWeeklyFamily) {
        for (const day of enabledDays) {
          const body = {
            blanket_po_line_id: lineId,
            cadence: 'weekly',
            weekday: day.value,
            default_quantity: Number(week[day.value].qty),
            interval_weeks: interval,
          };
          if (interval > 1 && anchorDate) body.anchor_date = anchorDate;
          const { data: ruleRes } = await api.post('/delivery-schedules/rules', body);
          ruleIds.push(ruleRes.rule.id);
        }
      } else if (cadenceMode === 'monthly') {
        const { data: ruleRes } = await api.post('/delivery-schedules/rules', {
          blanket_po_line_id: lineId,
          cadence: 'monthly',
          month_day: Number(monthDay),
          default_quantity: Number(monthQty),
        });
        ruleIds.push(ruleRes.rule.id);
      } else {
        const { data: ruleRes } = await api.post('/delivery-schedules/rules', {
          blanket_po_line_id: lineId,
          cadence: 'custom',
          default_quantity: Number(customQty),
          custom_dates: customDates,
        });
        ruleIds.push(ruleRes.rule.id);
      }

      if (activateNow) {
        await api.post(`/blanket-pos/${blanketId}/activate`);
        for (const ruleId of ruleIds) {
          await api.post(`/delivery-schedules/rules/${ruleId}/activate`);
          await api.post('/delivery-schedules/generate', {
            rule_id: ruleId,
            horizon_start: horizonStart,
            horizon_end: horizonEnd,
          });
        }
      }

      navigate(`/blanket-pos/${blanketId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save blanket PO.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mes-shell bpo-setup-page">
      <PageHeader
        eyebrow="Sourcing"
        title="New customer contract"
        subtitle="Pick the customer, lock the part price, choose a delivery cadence, and generate dated schedules."
        actions={
          <button type="button" className="mes-btn mes-btn-secondary" onClick={() => navigate('/blanket-pos')}>
            <ArrowLeft size={16} />
            All contracts
          </button>
        }
      />

      <nav className="bpo-steps" aria-label="Setup steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step || (s.id === step + 1 && canNext())) setStep(s.id);
              else if (s.id < step) setStep(s.id);
            }}
            disabled={s.id > step + 1 || (s.id > step && !canNext())}
          >
            <span className="bpo-step-num">
              {step > s.id ? <Check size={14} strokeWidth={3} /> : s.id}
            </span>
            <span className="bpo-step-text">
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="card bpo-setup-card">
        {error ? <p className="error-message">{error}</p> : null}

        {step === 1 ? (
          <div className="bpo-panel">
            <h2>Customer</h2>
            <p className="muted bpo-lead">Who should this open contract belong to?</p>

            <label>
              Customer <span className="req">*</span>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="bpo-grid-2">
              <label>
                Payment terms
                <input
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="e.g. Net 30"
                  disabled={submitting}
                />
              </label>
              <label>
                Notes
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  disabled={submitting}
                />
              </label>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="bpo-panel">
            <h2>Part & locked price</h2>
            <p className="muted bpo-lead">
              Choose the component and the contract unit price. This price stays locked on the blanket.
            </p>

            <label>
              Component <span className="req">*</span>
              <ComponentSelect
                value={compId}
                label={compLabel}
                disabled={submitting}
                onChange={({ id, label }) => {
                  setCompId(id);
                  setCompLabel(label);
                }}
              />
            </label>

            <div className="bpo-grid-2">
              <label>
                Locked unit price (INR) <span className="req">*</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="0.00"
                  required
                  disabled={submitting}
                />
              </label>
              <label>
                Unit
                <input
                  value={uom}
                  onChange={(e) => setUom(e.target.value)}
                  placeholder="pcs"
                  disabled={submitting}
                />
              </label>
            </div>

            {compLabel && unitPrice !== '' ? (
              <div className="bpo-summary-chip">
                <strong>{compLabel}</strong>
                <span>
                  ₹{Number(unitPrice).toLocaleString('en-IN', { maximumFractionDigits: 4 })} / {uom || 'pcs'}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="bpo-panel">
            <h2>Delivery cadence</h2>
            <p className="muted bpo-lead">
              Choose how often deliveries repeat. When you activate, dated schedules are generated for
              the horizon below.
            </p>

            <div className="bpo-week-grid" style={{ marginTop: 12, marginBottom: 16 }}>
              {CADENCE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`bpo-day-card${cadenceMode === m.id ? ' is-on' : ''}`}
                  style={{ textAlign: 'left', cursor: 'pointer', padding: 12 }}
                  disabled={submitting}
                  onClick={() => selectCadenceMode(m.id)}
                  aria-pressed={cadenceMode === m.id}
                >
                  <strong style={{ display: 'block', fontSize: 13 }}>{m.label}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {m.hint}
                  </span>
                </button>
              ))}
            </div>

            {isWeeklyFamily ? (
              <>
                {!enabledDays.length ? (
                  <EmptyState
                    icon={CalendarRange}
                    title="No delivery days yet"
                    description="Enable at least one weekday and set a quantity."
                  />
                ) : null}

                <div className="bpo-week-grid" style={{ marginTop: 16 }}>
                  {WEEKDAYS.map((d) => {
                    const cell = week[d.value];
                    return (
                      <div key={d.value} className={`bpo-day-card${cell.enabled ? ' is-on' : ''}`}>
                        <button
                          type="button"
                          className="bpo-day-toggle"
                          disabled={submitting}
                          onClick={() => toggleDay(d.value)}
                          aria-pressed={cell.enabled}
                        >
                          <span className="bpo-day-short">{d.short}</span>
                          <span className="bpo-day-full">{d.label}</span>
                        </button>
                        <label className="bpo-day-qty">
                          <span>Qty</span>
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={cell.qty}
                            disabled={submitting || !cell.enabled}
                            placeholder="—"
                            onChange={(e) => setDayQty(d.value, e.target.value)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                {(cadenceMode === 'biweekly' || cadenceMode === 'n_weeks') && (
                  <div className="bpo-grid-2" style={{ marginTop: 16 }}>
                    {cadenceMode === 'n_weeks' ? (
                      <label>
                        Interval (weeks)
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={intervalWeeks}
                          onChange={(e) => setIntervalWeeks(e.target.value)}
                          disabled={submitting}
                        />
                      </label>
                    ) : (
                      <label>
                        Interval
                        <input value="Every 2 weeks" disabled readOnly />
                      </label>
                    )}
                    <label>
                      First delivery / anchor (optional)
                      <input
                        type="date"
                        value={anchorDate}
                        onChange={(e) => setAnchorDate(e.target.value)}
                        disabled={submitting}
                      />
                    </label>
                  </div>
                )}
              </>
            ) : null}

            {cadenceMode === 'monthly' ? (
              <div className="bpo-grid-2" style={{ marginTop: 8 }}>
                <label>
                  Day of month (1–31)
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={monthDay}
                    onChange={(e) => setMonthDay(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>
                <label>
                  Default quantity
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={monthQty}
                    onChange={(e) => setMonthQty(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>
              </div>
            ) : null}

            {cadenceMode === 'custom' ? (
              <div style={{ marginTop: 8 }}>
                <label>
                  Preferred dates (DD-MM-YYYY, one per line or comma-separated)
                  <textarea
                    rows={5}
                    value={customDatesText}
                    onChange={(e) => setCustomDatesText(e.target.value)}
                    placeholder={'20-07-2026\n03-08-2026\n17-08-2026'}
                    disabled={submitting}
                    style={{ width: '100%', fontFamily: 'inherit' }}
                  />
                </label>
                <p className="muted" style={{ marginTop: 4 }}>
                  {customDates.length
                    ? `${customDates.length} valid date${customDates.length === 1 ? '' : 's'} parsed`
                    : 'No valid dates yet'}
                </p>
                <label style={{ marginTop: 8, display: 'block' }}>
                  Default quantity
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={customQty}
                    onChange={(e) => setCustomQty(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>
              </div>
            ) : null}

            <div className="bpo-grid-2" style={{ marginTop: 20 }}>
              <label>
                Horizon start
                <input
                  type="date"
                  value={horizonStart}
                  onChange={(e) => {
                    setHorizonStart(e.target.value);
                    if (!e.target.value) return;
                    setHorizonEnd(defaultHorizonEnd(cadenceMode, e.target.value));
                  }}
                  disabled={submitting || !activateNow}
                />
              </label>
              <label>
                Horizon end
                <input
                  type="date"
                  value={horizonEnd}
                  onChange={(e) => setHorizonEnd(e.target.value)}
                  disabled={submitting || !activateNow}
                />
              </label>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Horizon defaults adjust by cadence (weekly ~8 weeks, biweekly ~12, monthly ~3 months).
              Schedules are created only when you activate.
            </p>

            <label className="bpo-check">
              <input
                type="checkbox"
                checked={activateNow}
                onChange={(e) => setActivateNow(e.target.checked)}
                disabled={submitting}
              />
              <span>
                Activate & generate schedules
                <small>Starts validity today, activates rules, and creates dated deliveries</small>
              </span>
            </label>

            <div className="bpo-review">
              <h3>Review</h3>
              <ul>
                <li>
                  <span>Customer</span>
                  <strong>{customerName || '—'}</strong>
                </li>
                <li>
                  <span>Component</span>
                  <strong>{compLabel || '—'}</strong>
                </li>
                <li>
                  <span>Locked price</span>
                  <strong>
                    ₹{unitPrice !== '' ? Number(unitPrice).toLocaleString('en-IN') : '—'} / {uom || 'pcs'}
                  </strong>
                </li>
                <li>
                  <span>Cadence</span>
                  <strong>
                    {CADENCE_MODES.find((m) => m.id === cadenceMode)?.label}
                    {isWeeklyFamily && enabledDays.length === 1
                      ? ` · ${weekdayName(enabledDays[0].value)}`
                      : ''}
                  </strong>
                </li>
                <li>
                  <span>Plan</span>
                  <strong>{cadenceSummary()}</strong>
                </li>
                <li>
                  <span>Horizon</span>
                  <strong>
                    {activateNow
                      ? `${formatDisplayDate(horizonStart)} → ${formatDisplayDate(horizonEnd)}`
                      : 'Draft — no dates yet'}
                  </strong>
                </li>
              </ul>
            </div>
          </div>
        ) : null}

        <div className="bpo-footer">
          {step > 1 ? (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              disabled={submitting}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              disabled={submitting}
              onClick={() => navigate('/blanket-pos')}
            >
              Cancel
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              disabled={submitting || !canNext()}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              disabled={submitting || !cadenceValid()}
              onClick={handleSubmit}
            >
              {submitting
                ? 'Saving…'
                : activateNow
                  ? 'Save, activate & schedule'
                  : 'Save as draft'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
