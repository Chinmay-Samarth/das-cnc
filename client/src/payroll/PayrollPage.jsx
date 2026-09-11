import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Download,
  Lock,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import api from '../api/client';
import {
  ListPage,
  EmptyState,
  AlertBanner,
} from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';

const ATTENDANCE_EDITABLE_KEYS = [
  'days_worked',
  'paid_leave',
  'earned_leave',
  'overtime_hours',
];

const SALARY_COLUMNS = [
  { key: 'basic', label: 'Basic', title: 'Basic salary' },
  { key: 'basic_earned', label: 'Basic Earned', title: 'Basic earned' },
  { key: 'allowance', label: 'Allowance', title: 'Allowance' },
  { key: 'incentive_paid', label: 'Incentive Paid', title: 'Incentive paid' },
  { key: 'production_allowance', label: 'Production Allowance', title: 'Production allowance' },
  { key: 'inc_plus_prod_all', label: 'Inc+ Prod All', title: 'Incentive + Production Allowance' },
  { key: 'allowance_plus_pa', label: 'Allowance + Production Allowance', title: 'Allowance + Production Allowance' },
  { key: 'overtime_pay', label: 'Overtime Pay', title: 'Overtime pay' },
  { key: 'total_earned', label: 'Total Earned', title: 'Total earned' },
  { key: 'esi', label: 'ESI', title: 'ESI' },
  { key: 'pf', label: 'PF', title: 'PF' },
  { key: 'pt', label: 'PT', title: 'PT' },
  { key: 'total_deductions', label: 'Total', title: 'Total deductions' },
  { key: 'net_paid', label: 'Net Paid', title: 'Net paid' },
];

const EDITABLE_KEYS = [
  ...ATTENDANCE_EDITABLE_KEYS,
  ...SALARY_COLUMNS.map((col) => col.key),
];

const FORMULA_KEYS = [
  'basic_earned',
  'allowance',
  'inc_plus_prod_all',
  'allowance_plus_pa',
  'overtime_pay',
  'total_earned',
  'esi',
  'pf',
  'pt',
  'total_deductions',
  'net_paid',
];

const FORMULA_LABELS = {
  basic_earned: 'Basic Earned',
  allowance: 'Allowance',
  inc_plus_prod_all: 'Inc+ Prod All',
  allowance_plus_pa: 'Allowance + Production Allowance',
  overtime_pay: 'Overtime Pay',
  total_earned: 'Total Earned',
  esi: 'ESI',
  pf: 'PF',
  pt: 'PT',
  total_deductions: 'Total',
  net_paid: 'Net Paid',
};

function formulaFieldLabel(key) {
  if (FORMULA_LABELS[key]) return FORMULA_LABELS[key];
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function overrideList(line) {
  return Array.isArray(line?.manual_overrides) ? line.manual_overrides : [];
}

function currentYm() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatInr(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatNum(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

export default function PayrollPage() {
  const initial = currentYm();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [run, setRun] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [showFormulas, setShowFormulas] = useState(false);
  const [formulaVersions, setFormulaVersions] = useState([]);
  const [formulaDraft, setFormulaDraft] = useState({});
  const [formulaLabel, setFormulaLabel] = useState('');
  const [formulaBusy, setFormulaBusy] = useState(false);
  const tableScrollRef = useRef(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    pointerId: null,
  });

  const locked = run?.status === 'locked';

  const onTablePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (
      target?.closest?.(
        'input, button, select, textarea, a, label, .payroll-input, .payroll-save-btn'
      )
    ) {
      return;
    }
    const el = tableScrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      pointerId: e.pointerId,
    };
    el.classList.add('is-dragging');
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onTablePointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const el = tableScrollRef.current;
    if (!el) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    el.scrollLeft = drag.scrollLeft - dx;
    el.scrollTop = drag.scrollTop - dy;
  }, []);

  const endTableDrag = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const el = tableScrollRef.current;
    drag.active = false;
    if (el) {
      el.classList.remove('is-dragging');
      if (drag.pointerId != null) {
        try {
          el.releasePointerCapture(drag.pointerId);
        } catch {
          /* ignore */
        }
      }
    }
    drag.pointerId = null;
    // Prevent accidental click after a drag
    if (drag.moved && e?.type === 'pointerup') {
      e.preventDefault?.();
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/payroll', { params: { year, month } });
      setRun(data.run || null);
      setLines(data.lines || []);
      setDrafts({});
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load payroll');
      setRun(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.net += Number(line.net_paid) || 0;
        acc.earned += Number(line.total_earned) || 0;
        return acc;
      },
      { net: 0, earned: 0 }
    );
  }, [lines]);

  function setDraftValue(lineId, key, value) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || {}), [key]: value },
    }));
  }

  function cellValue(line, key) {
    const draft = drafts[line.id];
    if (draft && draft[key] !== undefined) return draft[key];
    return line[key] ?? '';
  }

  async function handleGenerate() {
    setBusy(true);
    try {
      const { data } = await api.post(`/payroll/${year}/${month}/generate`);
      setRun(data.run || null);
      setLines(data.lines || []);
      setDrafts({});
      await appAlert({
        title: 'Payroll generated',
        message: `Loaded ${data.lines?.length || 0} employee line(s) for ${monthLabel(year, month)}.`,
        tone: 'success',
      });
    } catch (err) {
      await appAlert({
        title: 'Generate failed',
        message: err.response?.data?.error || 'Could not generate payroll',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveLine(line) {
    if (locked) return;
    const patch = drafts[line.id];
    if (!patch || !Object.keys(patch).length) return;
    setBusy(true);
    try {
      const body = {};
      for (const key of EDITABLE_KEYS) {
        if (patch[key] !== undefined) body[key] = Number(patch[key]);
      }
      const { data } = await api.patch(`/payroll/lines/${line.id}`, body);
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...data.line } : l)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
    } catch (err) {
      await appAlert({
        title: 'Save failed',
        message: err.response?.data?.error || 'Could not update line',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    const ok = await appConfirm({
      title: 'Lock payroll month?',
      message: `Lock ${monthLabel(year, month)}? Inputs and formulas for this month will become read-only.`,
      confirmLabel: 'Lock month',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/payroll/${year}/${month}/lock`);
      setRun(data.run || null);
      setLines(data.lines || []);
      await appAlert({ title: 'Month locked', message: 'This payroll month is now frozen.', tone: 'success' });
    } catch (err) {
      await appAlert({
        title: 'Lock failed',
        message: err.response?.data?.error || 'Could not lock month',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    try {
      const response = await api.get(`/payroll/${year}/${month}/export`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${year}-${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      await appAlert({
        title: 'Export failed',
        message: err.response?.data?.error || 'Could not export payroll',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function openFormulas() {
    setShowFormulas(true);
    setFormulaBusy(true);
    try {
      const { data } = await api.get('/payroll/formulas');
      setFormulaVersions(data.versions || []);
      const current = {
        ...(data.defaults || {}),
        ...(data.current?.formulas || {}),
      };
      setFormulaDraft({ ...current });
      setFormulaLabel(`Version ${(data.current?.version_number || 0) + 1}`);
    } catch (err) {
      await appAlert({
        title: 'Could not load formulas',
        message: err.response?.data?.error || 'Unable to load formula versions',
        tone: 'danger',
      });
      setShowFormulas(false);
    } finally {
      setFormulaBusy(false);
    }
  }

  async function saveNewFormulaVersion() {
    const ok = await appConfirm({
      title: 'Save new formula version?',
      message:
        'A new version will apply to future / regenerated draft months only. Locked months keep their original formulas and amounts.',
      confirmLabel: 'Save version',
    });
    if (!ok) return;
    setFormulaBusy(true);
    try {
      await api.post('/payroll/formulas', {
        label: formulaLabel || undefined,
        formulas: formulaDraft,
      });
      await appAlert({
        title: 'Formula version saved',
        message: 'New version created. Generate or open a new draft month to use it.',
        tone: 'success',
      });
      setShowFormulas(false);
    } catch (err) {
      await appAlert({
        title: 'Save failed',
        message: err.response?.data?.error || 'Could not save formulas',
        tone: 'danger',
      });
    } finally {
      setFormulaBusy(false);
    }
  }

  const yearOptions = useMemo(() => {
    const y = currentYm().year;
    return [y - 1, y, y + 1];
  }, []);

  const formulaKeyList = useMemo(() => {
    const extra = Object.keys(formulaDraft || {}).filter((key) => !FORMULA_KEYS.includes(key));
    return [...FORMULA_KEYS, ...extra];
  }, [formulaDraft]);

  return (
    <ListPage
      eyebrow="People"
      title="Payroll"
      subtitle="Excel salary sheet from Basic through Net Paid. Edit any cell; formulas fill the rest."
      error={error}
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="mes-btn mes-btn-secondary" onClick={openFormulas} disabled={busy}>
            <Settings2 size={16} /> Formulas
          </button>
          <button type="button" className="mes-btn mes-btn-secondary" onClick={handleExport} disabled={busy}>
            <Download size={16} /> Export
          </button>
          {!locked ? (
            <button type="button" className="mes-btn mes-btn-secondary" onClick={handleLock} disabled={busy || !lines.length}>
              <Lock size={16} /> Lock month
            </button>
          ) : null}
          <button type="button" className="mes-btn mes-btn-primary" onClick={handleGenerate} disabled={busy || locked}>
            <RefreshCw size={16} /> {lines.length ? 'Refresh' : 'Generate'}
          </button>
        </div>
      }
      filters={
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={busy}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' })}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={busy}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      {locked ? (
        <AlertBanner tone="info">
          This month is locked. Historical amounts stay frozen even if formulas change later.
        </AlertBanner>
      ) : null}

      {loading ? <p className="muted">Loading payroll…</p> : null}

      {!loading && lines.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No payroll lines yet"
          description={`Generate payroll for ${monthLabel(year, month)} to pull days worked, paid leave, and salary from Basic through Net Paid.`}
        />
      ) : null}

      {!loading && lines.length > 0 ? (
        <div className="payroll-table-shell">
          <div className="payroll-table-totals">
            <span>
              Earned <strong>₹{formatInr(totals.earned)}</strong>
            </span>
            <span>
              Net <strong>₹{formatInr(totals.net)}</strong>
            </span>
          </div>
          <div
          ref={tableScrollRef}
          className="payroll-table-scroller"
          tabIndex={0}
          aria-label="Payroll table — drag to pan"
          onPointerDown={onTablePointerDown}
          onPointerMove={onTablePointerMove}
          onPointerUp={endTableDrag}
          onPointerCancel={endTableDrag}
          onPointerLeave={(e) => {
            if (dragRef.current.active) endTableDrag(e);
          }}
        >
          <table className="app-table payroll-table">
            <thead>
              <tr>
                <th className="payroll-col-sticky payroll-col-code" title="Employee code">Code</th>
                <th className="payroll-col-sticky payroll-col-name" title="Employee name">Name</th>
                <th title="Wage period (days in month)">Wage Period</th>
                <th title="Days worked">Days Worked</th>
                <th title="Paid leave">Paid Leave</th>
                <th title="Earned leave">Earned Leave</th>
                <th title="Total overtime hours from attendance">Total Overtime (hrs)</th>
                {SALARY_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    title={col.title}
                    className={col.key === 'allowance_plus_pa' ? 'payroll-col-wide' : undefined}
                  >
                    {col.label}
                  </th>
                ))}
                {!locked ? <th className="payroll-col-action" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const dirty = Boolean(drafts[line.id] && Object.keys(drafts[line.id]).length);
                const overrides = overrideList(line);
                const renderInput = (key, { money = false, net = false } = {}) => {
                  const overridden = overrides.includes(key);
                  if (locked) {
                    const text = money ? formatInr(line[key]) : formatNum(line[key]);
                    return (
                      <span className={net ? 'payroll-net' : undefined} title={overridden ? 'Manual override' : undefined}>
                        {text}
                      </span>
                    );
                  }
                  return (
                    <input
                      type="number"
                      step="any"
                      className={`payroll-input${money ? ' payroll-input-money' : ''}${overridden ? ' is-override' : ''}${net ? ' payroll-input-net' : ''}`}
                      value={cellValue(line, key)}
                      disabled={busy}
                      onChange={(e) => setDraftValue(line.id, key, e.target.value)}
                      aria-label={key}
                      title={overridden ? 'Manual override — save to keep this value' : undefined}
                    />
                  );
                };
                return (
                  <tr key={line.id} className={dirty ? 'is-dirty' : undefined}>
                    <td className="payroll-col-sticky payroll-col-code">{line.employee_code || '—'}</td>
                    <td className="payroll-col-sticky payroll-col-name" title={line.employee_name || ''}>
                      {line.employee_name || '—'}
                    </td>
                    <td className="payroll-num">{formatNum(line.wage_period)}</td>
                    <td className="payroll-num">{renderInput('days_worked')}</td>
                    <td className="payroll-num">{renderInput('paid_leave')}</td>
                    <td className="payroll-num">{renderInput('earned_leave')}</td>
                    <td className="payroll-num">{renderInput('overtime_hours')}</td>
                    {SALARY_COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`payroll-money${col.key === 'net_paid' ? ' payroll-net' : ''}`}
                      >
                        {renderInput(col.key, { money: true, net: col.key === 'net_paid' })}
                      </td>
                    ))}
                    {!locked ? (
                      <td className="payroll-col-action">
                        {dirty ? (
                          <button
                            type="button"
                            className="mes-btn mes-btn-primary payroll-save-btn"
                            disabled={busy}
                            onClick={() => saveLine(line)}
                          >
                            Save
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      ) : null}

      {showFormulas ? (
        <div
          className="mes-card"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => !formulaBusy && setShowFormulas(false)}
        >
          <div
            className="mes-card"
            style={{
              width: 'min(840px, 100%)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 20,
              background: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Salary formulas</h2>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Every salary formula from Basic Earned through Net Paid is listed here, including Overtime
                  Pay. Use overtime_hours from attendance in that formula (for example overtime_hours * basic /
                  wage_period / 8). Saving creates a new version. Locked months keep prior formulas. New keys
                  from the engine appear automatically.
                </p>
              </div>
              <button type="button" className="mes-btn mes-btn-secondary" onClick={() => setShowFormulas(false)}>
                Close
              </button>
            </div>

            {formulaVersions.length ? (
              <div style={{ marginBottom: 16 }}>
                <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Versions
                </p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {formulaVersions.slice(0, 8).map((v) => (
                    <li key={v.id} style={{ marginBottom: 4 }}>
                      v{v.version_number} — {v.label || 'Untitled'} ({v.effective_from})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <label style={{ display: 'block', marginBottom: 12 }}>
              New version label
              <input
                type="text"
                value={formulaLabel}
                onChange={(e) => setFormulaLabel(e.target.value)}
                disabled={formulaBusy}
              />
            </label>

            <div style={{ display: 'grid', gap: 10 }}>
              {formulaKeyList.map((key) => (
                <label key={key} style={{ display: 'block', margin: 0 }}>
                  {formulaFieldLabel(key)}
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                    {key}
                  </span>
                  <input
                    type="text"
                    value={formulaDraft[key] || ''}
                    onChange={(e) => setFormulaDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={formulaBusy}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                  />
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="mes-btn mes-btn-secondary" onClick={() => setShowFormulas(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                disabled={formulaBusy}
                onClick={saveNewFormulaVersion}
              >
                Save as new version
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ListPage>
  );
}
