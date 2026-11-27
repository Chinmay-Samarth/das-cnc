import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CirclePlay,
  ClipboardList,
  History,
  Info,
  Plus,
  Ruler,
  Trash2,
} from 'lucide-react';
import api from '../api/client';
import {
  AlertBanner,
  EmptyState,
  SkeletonForm,
  StatusBadge,
  SlidingPillBar,
} from '../components/mes';
import { formatDisplayDateTime } from '../utils/dateFormat';

const CHECK_TYPES = [
  { value: 'dimensional', label: 'Dimensional', hint: 'Numeric spec + tolerance' },
  { value: 'visual', label: 'Visual', hint: 'Appearance / surface check' },
  { value: 'functional', label: 'Functional', hint: 'Fit / operation check' },
  { value: 'document', label: 'Document', hint: 'Paperwork verification' },
];

const UNIT_OPTIONS = [
  { value: 'mm', label: 'mm' },
  { value: 'µm', label: 'µm' },
  { value: 'kgs', label: 'kgs' },
  { value: 'pcs', label: 'pcs' },
  { value: 'number', label: 'Number' },
];

const SAMPLING_TYPES = [
  { value: 'percentage', label: 'Percentage of lot' },
  { value: 'fixed_count', label: 'Fixed count' },
];

function emptyParameter(seq = 1) {
  return {
    id: null,
    sequence: seq,
    parameter_name: '',
    check_type: 'visual',
    nominal_value: '',
    tol_plus: '',
    tol_minus: '',
    unit: 'mm',
    instrument_required: '',
    is_mandatory: true,
  };
}

function emptyDocument() {
  return {
    id: null,
    document_type: '',
    is_mandatory: true,
  };
}

function checkTypeLabel(value) {
  return CHECK_TYPES.find((t) => t.value === value)?.label || value || '—';
}

function samplingSummary(type, value) {
  const n = Number(value);
  if (type === 'fixed_count') {
    return Number.isFinite(n) ? `${n} unit${n === 1 ? '' : 's'} per lot` : 'Fixed count';
  }
  return Number.isFinite(n) ? `${n}% of lot` : 'Percentage of lot';
}

function formatSpec(param) {
  if (param.check_type !== 'dimensional') return null;
  const unit = param.unit || '';
  const nom = param.nominal_value === '' || param.nominal_value == null ? '—' : param.nominal_value;
  const plus = param.tol_plus === '' || param.tol_plus == null ? '0' : param.tol_plus;
  const minus = param.tol_minus === '' || param.tol_minus == null ? '0' : param.tol_minus;
  return `${nom} ${unit} (+${plus}/−${minus})`.trim();
}

function PlanStatusBadge({ status, revision }) {
  if (!status) return null;
  return (
    <StatusBadge status={status}>
      {status} · rev {revision ?? '—'}
    </StatusBadge>
  );
}

function ParameterCard({ param, index, onChange, onRemove, canRemove }) {
  const isDimensional = param.check_type === 'dimensional';

  return (
    <article className="insp-param-card">
      <div className="insp-param-head">
        <div className="insp-field insp-field-side">
          <span className="insp-field-label" aria-hidden>
            &nbsp;
          </span>
          <span className="insp-param-index">{index + 1}</span>
        </div>
        <label className="insp-field insp-param-name">
          <span className="insp-field-label">Parameter name</span>
          <input
            type="text"
            value={param.parameter_name}
            placeholder="e.g. Outer diameter"
            onChange={(e) => onChange('parameter_name', e.target.value)}
          />
        </label>
        <div className="insp-field insp-field-side">
          <span className="insp-field-label" aria-hidden>
            &nbsp;
          </span>
          <button
            type="button"
            className="insp-icon-btn insp-icon-btn-danger"
            onClick={onRemove}
            disabled={!canRemove}
            title="Remove parameter"
            aria-label="Remove parameter"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="insp-param-grid">
        <label className="insp-field">
          <span className="insp-field-label">Check type</span>
          <select
            value={param.check_type}
            onChange={(e) => onChange('check_type', e.target.value)}
          >
            {CHECK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="insp-field">
          <span className="insp-field-label">Instrument</span>
          <input
            type="text"
            value={param.instrument_required}
            placeholder="Optional"
            onChange={(e) => onChange('instrument_required', e.target.value)}
          />
        </label>

        <label className="insp-toggle">
          <input
            type="checkbox"
            checked={param.is_mandatory}
            onChange={(e) => onChange('is_mandatory', e.target.checked)}
          />
          <span>
            <strong>Mandatory</strong>
            <small>Required during inspection</small>
          </span>
        </label>
      </div>

      {isDimensional ? (
        <div className="insp-dim-block">
          <div className="insp-dim-head">
            <Ruler size={14} strokeWidth={1.75} />
            <span>Dimensional specification</span>
            {formatSpec(param) ? (
              <span className="insp-dim-preview">{formatSpec(param)}</span>
            ) : null}
          </div>
          <div className="insp-dim-grid">
            <label className="insp-field">
              <span className="insp-field-label">Nominal</span>
              <input
                type="number"
                value={param.nominal_value}
                onChange={(e) => onChange('nominal_value', e.target.value)}
              />
            </label>
            <label className="insp-field">
              <span className="insp-field-label">+ Tolerance</span>
              <input
                type="number"
                value={param.tol_plus}
                onChange={(e) => onChange('tol_plus', e.target.value)}
              />
            </label>
            <label className="insp-field">
              <span className="insp-field-label">− Tolerance</span>
              <input
                type="number"
                value={param.tol_minus}
                onChange={(e) => onChange('tol_minus', e.target.value)}
              />
            </label>
            <label className="insp-field">
              <span className="insp-field-label">Unit</span>
              <select
                value={param.unit || 'mm'}
                onChange={(e) => onChange('unit', e.target.value)}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
                {param.unit && !UNIT_OPTIONS.some((u) => u.value === param.unit) ? (
                  <option value={param.unit}>{param.unit}</option>
                ) : null}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DocumentCard({ doc, index, onChange, onRemove }) {
  return (
    <article className="insp-doc-card">
      <div className="insp-field insp-field-side">
        <span className="insp-field-label" aria-hidden>
          &nbsp;
        </span>
        <span className="insp-param-index">{index + 1}</span>
      </div>
      <label className="insp-field insp-doc-name">
        <span className="insp-field-label">Document type</span>
        <input
          type="text"
          placeholder="e.g. Grade Certificate"
          value={doc.document_type}
          onChange={(e) => onChange('document_type', e.target.value)}
        />
      </label>
      <div className="insp-field insp-field-side">
        <span className="insp-field-label" aria-hidden>
          &nbsp;
        </span>
        <label className="insp-toggle insp-toggle-compact">
          <input
            type="checkbox"
            checked={doc.is_mandatory}
            onChange={(e) => onChange('is_mandatory', e.target.checked)}
          />
          <span>
            <strong>Mandatory</strong>
          </span>
        </label>
      </div>
      <div className="insp-field insp-field-side">
        <span className="insp-field-label" aria-hidden>
          &nbsp;
        </span>
        <button
          type="button"
          className="insp-icon-btn insp-icon-btn-danger"
          onClick={onRemove}
          title="Remove document"
          aria-label="Remove document"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

export default function InspectionPlanBuilder({ slug, recordId }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [viewTab, setViewTab] = useState('plan');

  const [planCode, setPlanCode] = useState('');
  const [samplingRuleType, setSamplingRuleType] = useState('percentage');
  const [samplingRuleValue, setSamplingRuleValue] = useState('100');
  const [parameters, setParameters] = useState([emptyParameter()]);
  const [documents, setDocuments] = useState([]);
  const [planMeta, setPlanMeta] = useState(null);
  const [isActive, setIsActive] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/masters/${slug}/records/${recordId}/inspection-plan`);
      const plan = data.plan;
      if (!plan) {
        setPlanCode(`${slug.toUpperCase().replace(/-/g, '_')}-${recordId.slice(0, 8)}`);
        setParameters([emptyParameter()]);
        setDocuments([]);
        setPlanMeta(null);
        setIsActive(false);
        return;
      }

      setPlanCode(plan.plan_code || '');
      setSamplingRuleType(plan.sampling_rule_type || 'percentage');
      setSamplingRuleValue(String(plan.sampling_rule_value ?? 100));
      setParameters(
        plan.parameters?.length
          ? plan.parameters.map((p) => ({
              ...p,
              nominal_value: p.nominal_value ?? '',
              tol_plus: p.tol_plus ?? '',
              tol_minus: p.tol_minus ?? '',
              unit: p.unit || (p.check_type === 'dimensional' ? 'mm' : 'number'),
            }))
          : [emptyParameter()]
      );
      setDocuments(plan.documents || []);
      setPlanMeta({ id: plan.id, status: plan.status, revision: plan.revision });
      setIsActive(data.is_active === true);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load inspection plan.');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { data } = await api.get(`/masters/${slug}/records/${recordId}/inspection-plan/history`);
      setHistory(data.history || []);
    } catch (err) {
      setHistoryError(err.response?.data?.error || 'Unable to load plan history.');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadPlan();
  }, [slug, recordId]);

  useEffect(() => {
    if (viewTab === 'history') loadHistory();
  }, [viewTab, slug, recordId]);

  function updateParameter(idx, field, value) {
    setParameters((prev) => {
      const next = [...prev];
      const updated = { ...next[idx], [field]: value };
      if (field === 'check_type' && value !== 'dimensional') {
        updated.nominal_value = '';
        updated.tol_plus = '';
        updated.tol_minus = '';
        updated.unit = 'number';
      }
      if (field === 'check_type' && value === 'dimensional' && !updated.unit) {
        updated.unit = 'mm';
      }
      next[idx] = updated;
      return next;
    });
  }

  function addParameter() {
    setParameters((prev) => [...prev, emptyParameter(prev.length + 1)]);
  }

  function removeParameter(idx) {
    setParameters((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, sequence: i + 1 }));
    });
  }

  function updateDocument(idx, field, value) {
    setDocuments((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addDocument() {
    setDocuments((prev) => [...prev, emptyDocument()]);
  }

  function removeDocument(idx) {
    setDocuments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        plan_code: planCode,
        sampling_rule_type: samplingRuleType,
        sampling_rule_value: parseFloat(samplingRuleValue) || 100,
        parameters: parameters.map((p, idx) => ({
          ...p,
          id: p.id || undefined,
          sequence: idx + 1,
          nominal_value: p.nominal_value === '' ? null : parseFloat(p.nominal_value),
          tol_plus: p.tol_plus === '' ? null : parseFloat(p.tol_plus),
          tol_minus: p.tol_minus === '' ? null : parseFloat(p.tol_minus),
          unit: p.check_type === 'dimensional' ? (p.unit || 'mm') : null,
        })),
        documents: documents.filter((d) => d.document_type.trim()),
      };

      const { data } = await api.put(`/masters/${slug}/records/${recordId}/inspection-plan`, payload);
      setMessage(data.message || 'Plan saved');
      await loadPlan();
      if (viewTab === 'history') await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save plan.');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post(`/masters/${slug}/records/${recordId}/inspection-plan/activate`, {
        plan_id: planMeta?.id,
      });
      setMessage(data.message || 'Plan activated');
      await loadPlan();
      if (viewTab === 'history') await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to activate plan.');
    } finally {
      setActivating(false);
    }
  }

  const namedParams = useMemo(
    () => parameters.filter((p) => String(p.parameter_name || '').trim()),
    [parameters]
  );
  const mandatoryCount = namedParams.filter((p) => p.is_mandatory).length;
  const docCount = documents.filter((d) => String(d.document_type || '').trim()).length;
  const samplingLabel = samplingSummary(samplingRuleType, samplingRuleValue);
  const canEdit = !isActive || planMeta?.status === 'draft';
  const checkTypeSummary = useMemo(() => {
    const counts = {};
    for (const p of namedParams) {
      const label = checkTypeLabel(p.check_type);
      counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts);
  }, [namedParams]);

  if (loading) {
    return <SkeletonForm embedded showHeader={false} />;
  }

  return (
    <div className="insp-plan">
      <div className="insp-plan-toolbar">
        <div className="insp-plan-toolbar-copy">
          <div className="insp-plan-title-row">
            <h2 className="insp-plan-title">Inspection Plan</h2>
            {planMeta ? (
              <PlanStatusBadge status={planMeta.status} revision={planMeta.revision} />
            ) : (
              <span className="insp-plan-empty-chip">No plan yet</span>
            )}
          </div>
        </div>

        <div className="insp-plan-toolbar-actions">
          <SlidingPillBar className="mes-view-toggle" role="group" aria-label="Inspection plan view">
            <button
              type="button"
              className={`mes-view-toggle-btn${viewTab === 'plan' ? ' is-active' : ''}`}
              onClick={() => setViewTab('plan')}
            >
              Plan
            </button>
            <button
              type="button"
              className={`mes-view-toggle-btn${viewTab === 'history' ? ' is-active' : ''}`}
              onClick={() => setViewTab('history')}
            >
              History
            </button>
          </SlidingPillBar>

          {viewTab === 'plan' ? (
            <div className="insp-plan-action-btns">
              {planMeta?.status === 'draft' ? (
                <button
                  type="button"
                  className="neutral-button"
                  disabled={activating || saving}
                  onClick={handleActivate}
                >
                  <CirclePlay size={16} />
                  {activating ? 'Activating…' : 'Activate'}
                </button>
              ) : null}
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={handleSave}
              >
                {saving
                  ? 'Saving…'
                  : isActive && planMeta?.status === 'active'
                    ? 'Save new revision'
                    : 'Save plan'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      {message ? (
        <AlertBanner tone="success" icon={CheckCircle2}>
          {message}
        </AlertBanner>
      ) : null}
      {isActive && planMeta?.status === 'active' && viewTab === 'plan' ? (
        <AlertBanner tone="amber" icon={Info}>
          Saving creates a new draft revision. Activate it when ready.
        </AlertBanner>
      ) : null}

      {viewTab === 'plan' ? (
        <div className="insp-plan-layout">
          <div className="insp-plan-main">
            <section className="insp-section">
              <div className="insp-settings-grid">
                <label className="insp-field">
                  <span className="insp-field-label">Plan code</span>
                  <input
                    type="text"
                    value={planCode}
                    onChange={(e) => setPlanCode(e.target.value)}
                    disabled={!canEdit && isActive}
                  />
                </label>
                <label className="insp-field">
                  <span className="insp-field-label">Sampling</span>
                  <select
                    value={samplingRuleType}
                    onChange={(e) => setSamplingRuleType(e.target.value)}
                  >
                    {SAMPLING_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="insp-field">
                  <span className="insp-field-label">
                    {samplingRuleType === 'percentage' ? 'Sample %' : 'Sample count'}
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={samplingRuleValue}
                    onChange={(e) => setSamplingRuleValue(e.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="insp-section">
              <div className="insp-section-head">
                <h3>Parameters</h3>
                <button type="button" className="neutral-button" onClick={addParameter}>
                  <Plus size={16} />
                  Add
                </button>
              </div>

              {parameters.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No parameters yet"
                  description="Add the checks inspectors should perform."
                  actionLabel="Add parameter"
                  onAction={addParameter}
                />
              ) : (
                <div className="insp-param-list">
                  {parameters.map((param, idx) => (
                    <ParameterCard
                      key={param.id || `param-${idx}`}
                      param={param}
                      index={idx}
                      onChange={(field, value) => updateParameter(idx, field, value)}
                      onRemove={() => removeParameter(idx)}
                      canRemove={parameters.length > 1}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="insp-section">
              <div className="insp-section-head">
                <h3>Documents</h3>
                <button type="button" className="neutral-button" onClick={addDocument}>
                  <Plus size={16} />
                  Add
                </button>
              </div>

              {documents.length === 0 ? (
                <p className="insp-empty-inline">No required documents.</p>
              ) : (
                <div className="insp-doc-list">
                  {documents.map((doc, idx) => (
                    <DocumentCard
                      key={doc.id || `doc-${idx}`}
                      doc={doc}
                      index={idx}
                      onChange={(field, value) => updateDocument(idx, field, value)}
                      onRemove={() => removeDocument(idx)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="insp-plan-rail">
            <div className="insp-glance">
              <div className="insp-glance-row">
                <span className="insp-glance-label">Status</span>
                <span className="insp-glance-value">
                  {planMeta ? (
                    <PlanStatusBadge status={planMeta.status} revision={planMeta.revision} />
                  ) : (
                    'Not saved'
                  )}
                </span>
              </div>
              <div className="insp-glance-row">
                <span className="insp-glance-label">Code</span>
                <span className="insp-glance-value insp-glance-mono">{planCode || '—'}</span>
              </div>
              <div className="insp-glance-row">
                <span className="insp-glance-label">Sampling</span>
                <span className="insp-glance-value">{samplingLabel}</span>
              </div>
              <div className="insp-glance-row">
                <span className="insp-glance-label">Checks</span>
                <span className="insp-glance-value">
                  {namedParams.length}
                  {mandatoryCount ? (
                    <span className="insp-glance-muted"> · {mandatoryCount} mandatory</span>
                  ) : null}
                </span>
              </div>
              {checkTypeSummary.length ? (
                <div className="insp-glance-types">
                  {checkTypeSummary.map(([label, count]) => (
                    <span key={label} className="insp-glance-chip">
                      {label} {count}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="insp-glance-row">
                <span className="insp-glance-label">Documents</span>
                <span className="insp-glance-value">{docCount || 'None'}</span>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <section className="insp-history">
          {historyError ? (
            <AlertBanner tone="danger">{historyError}</AlertBanner>
          ) : null}
          {historyLoading ? (
            <SkeletonForm embedded showHeader={false} />
          ) : history.length === 0 ? (
            <EmptyState
              icon={History}
              title="No revisions yet"
              description="Save a plan to start revision history for this record."
            />
          ) : (
            <div className="insp-history-list">
              {history.map((row) => (
                <article
                  key={row.id}
                  className={`insp-history-row${row.id === planMeta?.id ? ' is-current' : ''}`}
                >
                  <div className="insp-history-main">
                    <div className="insp-history-title-row">
                      <strong>{row.plan_code || 'Untitled plan'}</strong>
                      <PlanStatusBadge status={row.status} revision={row.revision} />
                      {row.id === planMeta?.id ? (
                        <span className="insp-history-current">Current</span>
                      ) : null}
                    </div>
                    <p className="insp-history-meta">
                      {samplingSummary(row.sampling_rule_type, row.sampling_rule_value)}
                      {row.effective_from
                        ? ` · Effective ${formatDisplayDateTime(row.effective_from)}`
                        : ''}
                      {row.created_at ? ` · Created ${formatDisplayDateTime(row.created_at)}` : ''}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
