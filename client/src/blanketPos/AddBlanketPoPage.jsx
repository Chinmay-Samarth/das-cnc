import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, CalendarRange } from 'lucide-react';
import api from '../api/client';
import ComponentSelect from './ComponentSelect';
import { WEEKDAYS } from './scheduleLabels';
import { EmptyState, PageHeader } from '../components/mes';

const STEPS = [
  { id: 1, title: 'Customer', hint: 'Who is this contract for?' },
  { id: 2, title: 'Part & price', hint: 'Component and locked unit price' },
  { id: 3, title: 'Weekly schedule', hint: 'Days, quantities, and horizon' },
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
  const [week, setWeek] = useState(emptyWeek);
  const [activateNow, setActivateNow] = useState(true);
  const [horizonStart, setHorizonStart] = useState(todayStr);
  const [horizonEnd, setHorizonEnd] = useState(() => plusWeeks(todayStr(), 4));
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

  async function handleSubmit() {
    if (!enabledDays.length) {
      setError('Turn on at least one delivery day and enter a quantity.');
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
      for (const day of enabledDays) {
        const { data: ruleRes } = await api.post('/delivery-schedules/rules', {
          blanket_po_line_id: lineId,
          cadence: 'weekly',
          weekday: day.value,
          default_quantity: Number(week[day.value].qty),
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
        subtitle="Pick the customer, lock the part price, set weekly delivery days, and generate dated schedules."
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
            <h2>Weekly delivery schedule</h2>
            <p className="muted bpo-lead">
              Tap delivery days and enter quantities. When you activate, dated delivery schedules are
              generated for the horizon below — no spreadsheet upload required.
            </p>

            {!enabledDays.length ? (
              <EmptyState
                icon={CalendarRange}
                title="No delivery days yet"
                description="Enable at least one weekday and set a quantity to build the recurring plan."
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

            <div className="bpo-grid-2" style={{ marginTop: 20 }}>
              <label>
                Horizon start
                <input
                  type="date"
                  value={horizonStart}
                  onChange={(e) => setHorizonStart(e.target.value)}
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
              Defaults to today through four weeks. Schedules are created only when you activate.
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
                <small>Starts validity today, activates weekly rules, and creates dated deliveries</small>
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
                  <span>Weekly days</span>
                  <strong>
                    {enabledDays.length
                      ? enabledDays.map((d) => `${d.short} ${week[d.value].qty}`).join(' · ')
                      : 'None selected'}
                  </strong>
                </li>
                <li>
                  <span>Horizon</span>
                  <strong>
                    {activateNow ? `${horizonStart} → ${horizonEnd}` : 'Draft — no dates yet'}
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
              disabled={submitting || !enabledDays.length}
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
