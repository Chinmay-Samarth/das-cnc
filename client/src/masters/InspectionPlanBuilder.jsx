import { useEffect, useState, Fragment } from 'react';
import api from '../api/client'
import {Plus, X} from 'lucide-react';

const CHECK_TYPES = ['dimensional', 'visual', 'functional', 'document'];
const UNIT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'kgs', label: 'kgs' },
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
    unit: 'number',
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

function StatusBadge({ status, revision }) {
  const styles = {
    draft: { background: '#f3f4f6', color: '#374151' },
    active: { background: '#dcfce7', color: '#166534' },
    retired: { background: '#fee2e2', color: '#991b1b' },
  };
  const style = styles[status] || styles.draft;
  return (
    <span style={{ ...style, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
      {status} · rev {revision}
    </span>
  );
}

export default function InspectionPlanBuilder({ slug, recordId }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [planCode, setPlanCode] = useState('');
  const [samplingRuleType, setSamplingRuleType] = useState('percentage');
  const [samplingRuleValue, setSamplingRuleValue] = useState('100');
  const [parameters, setParameters] = useState([emptyParameter()]);
  const [documents, setDocuments] = useState([]);
  const [planMeta, setPlanMeta] = useState(null);
  const [isActive, setIsActive] = useState(false);

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

  useEffect(() => {
    loadPlan();
  }, [slug, recordId]);

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
        updated.unit = 'number';
      }
      next[idx] = updated;
      return next;
    });
  }

  function addParameter() {
    setParameters((prev) => [...prev, emptyParameter(prev.length + 1)]);
  }

  function removeParameter(idx) {
    setParameters((prev) =>
      prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, sequence: i + 1 }))
    );
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
          unit: p.check_type === 'dimensional' ? (p.unit || 'number') : null,
        })),
        documents: documents.filter((d) => d.document_type.trim()),
      };

      const { data } = await api.put(`/masters/${slug}/records/${recordId}/inspection-plan`, payload);
      setMessage(data.message || 'Plan saved');
      await loadPlan();
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
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to activate plan.');
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading inspection plan...</p>;
  }

  const canEdit = !isActive || planMeta?.status === 'draft';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Inspection Plan</h2>
          {planMeta ? <StatusBadge status={planMeta.status} revision={planMeta.revision} /> : (
            <span className="muted" style={{ fontSize: 13 }}>No plan yet — create one below</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {planMeta?.status === 'draft' ? (
            <button type="button" className="secondary-button" disabled={activating || saving} onClick={handleActivate}>
              {activating ? 'Activating...' : 'Activate Plan'}
            </button>
          ) : null}
          <button type="button" className="primary-button" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : isActive && planMeta?.status === 'active' ? 'Save (creates new revision)' : 'Save Plan'}
          </button>
        </div>
      </div>

      {error ? <p className="error-message" style={{ marginBottom: 12 }}>{error}</p> : null}
      {message ? <p style={{ color: '#166534', marginBottom: 12 }}>{message}</p> : null}
      {isActive && planMeta?.status === 'active' ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          This plan is active. Saving will create a new draft revision — activate it when ready.
        </p>
      ) : null}

      <div className="inspection-plan-grid" style={{ marginBottom: 20 }}>
        <label>
          <span className="employee-detail-label">Plan Code</span>
          <input type="text" value={planCode} onChange={(e) => setPlanCode(e.target.value)} disabled={!canEdit && isActive} />
        </label>
        <label>
          <span className="employee-detail-label">Sampling Rule</span>
          <select value={samplingRuleType} onChange={(e) => setSamplingRuleType(e.target.value)}>
            {SAMPLING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="employee-detail-label">
            {samplingRuleType === 'percentage' ? 'Sample %' : 'Sample Count'}
          </span>
          <input
            type="number"
            min="1"
            value={samplingRuleValue}
            onChange={(e) => setSamplingRuleValue(e.target.value)}
          />
        </label>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Parameters</h3>
          <button type="button" className="neutral-button" onClick={addParameter}><Plus size={16} style={{display: 'inline', marginRight: 4}}/> Add Parameter</button>
        </div>
        <div className="attendance-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Instrument</th>
                <th>Mandatory</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((param, idx) => (
                <Fragment key={param.id || `param-${idx}`}>
                  <tr>
                    <td>{idx + 1}</td>
                    <td>
                      <input
                        type="text"
                        value={param.parameter_name}
                        onChange={(e) => updateParameter(idx, 'parameter_name', e.target.value)}
                        style={{ width: '100%', minWidth: 120 }}
                      />
                    </td>
                    <td>
                      <select
                        value={param.check_type}
                        onChange={(e) => updateParameter(idx, 'check_type', e.target.value)}
                      >
                        {CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={param.instrument_required}
                        onChange={(e) => updateParameter(idx, 'instrument_required', e.target.value)}
                        style={{ width: 100 }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={param.is_mandatory}
                        onChange={(e) => updateParameter(idx, 'is_mandatory', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button type="button" className="cancel-button" onClick={() => removeParameter(idx)}><X size={16} style={{}}/></button>
                    </td>
                  </tr>
                  {param.check_type === 'dimensional' ? (
                    <tr>
                      <td></td>
                      <td colSpan={5}>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '8px 0' }}>
                          <label>
                            <span className="component-detail-label">Nominal</span>
                            <input
                              type="number"
                              value={param.nominal_value}
                              onChange={(e) => updateParameter(idx, 'nominal_value', e.target.value)}
                              style={{ width: 88 }}
                            />
                          </label>
                          <label>
                            <span className="component-detail-label">+Tol</span>
                            <input
                              type="number"
                              value={param.tol_plus}
                              onChange={(e) => updateParameter(idx, 'tol_plus', e.target.value)}
                              style={{ width: 72 }}
                            />
                          </label>
                          <label>
                            <span className="component-detail-label">-Tol</span>
                            <input
                              type="number"
                              value={param.tol_minus}
                              onChange={(e) => updateParameter(idx, 'tol_minus', e.target.value)}
                              style={{ width: 72 }}
                            />
                          </label>
                          <label>
                            <span className="component-detail-label">Unit</span>
                            <select
                              value={param.unit || 'number'}
                              onChange={(e) => updateParameter(idx, 'unit', e.target.value)}
                            >
                              {UNIT_OPTIONS.map((u) => (
                                <option key={u.value} value={u.value}>{u.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Required Documents</h3>
          <button type="button" className="neutral-button" onClick={addDocument}><Plus size={16} style={{display: 'inline', marginRight:4 }}/> Add Document</button>
        </div>
        {documents.length === 0 ? (
          <p className="muted">No document requirements defined.</p>
        ) : (
          <div className="employees-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Document Type</th>
                  <th>Mandatory</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc, idx) => (
                  <tr>
                    <td>
                      <input
                        type="text"
                        placeholder="e.g. Grade Certificate"
                        value={doc.document_type}
                        onChange={(e) => updateDocument(idx, 'document_type', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={doc.is_mandatory}
                        onChange={(e) => updateDocument(idx, 'is_mandatory', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button type="button" className="cancel-button" onClick={() => removeDocument(idx)}><X size={16}/></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
