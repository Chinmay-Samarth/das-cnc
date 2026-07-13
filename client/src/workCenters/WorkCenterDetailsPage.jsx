import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Users,
  Search,
  Check,
  UserMinus,
  Star,
  Save,
} from 'lucide-react';
import api from '../api/client';
import AvailableMachineSelect from './AvailableMachineSelect';
import {
  StatusBadge,
  EmptyState,
  MetricCard,
  TruncatedText,
} from '../components/mes';

function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const emptyFormData = {
  name: '',
  code: '',
  department_id: '',
  overhead_hourly_rate: '0',
  speed: '1',
  efficiency: '100',
  is_active: 'true',
};

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="employee-detail-label">{label}</p>
      <p className="employee-detail-value">{value ?? '—'}</p>
    </div>
  );
}

export default function WorkCenterDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [workCenter, setWorkCenter] = useState(null);
  const [tab, setTab] = useState('details');
  const [formData, setFormData] = useState(emptyFormData);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [machineError, setMachineError] = useState(null);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [addingMachine, setAddingMachine] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [operators, setOperators] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState([]);
  const [savingOperators, setSavingOperators] = useState(false);
  const [operatorError, setOperatorError] = useState(null);
  const [operatorSearch, setOperatorSearch] = useState('');

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else if (location.hash === '#operators') {
      setTab('operators');
    } else {
      setTab('details');
    }
  }, [location.pathname, location.hash]);

  useEffect(() => {
    let mounted = true;
    api
      .get('/employees/departments')
      .then(({ data }) => {
        if (!mounted) return;
        setDepartments(data.departments || []);
      })
      .catch((err) => console.error('Failed to load departments:', err));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .get('/employees')
      .then(({ data }) => {
        if (!mounted) return;
        const list = (data.employees || data || []).filter((e) => e.is_active !== false);
        setAllEmployees(list);
      })
      .catch(() => setAllEmployees([]));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadOperators() {
      if (!id) return;
      try {
        const { data } = await api.get(`/work-centers/${id}/operators`);
        if (!mounted) return;
        const ops = data.operators || [];
        setOperators(ops);
        setSelectedOperatorIds(ops.map((o) => o.employee_id));
      } catch (err) {
        if (!mounted) return;
        setOperatorError(err.response?.data?.error || 'Unable to load operators.');
      }
    }

    loadOperators();
    return () => {
      mounted = false;
    };
  }, [id, reloadKey]);

  useEffect(() => {
    let mounted = true;

    async function loadWorkCenter() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get(`/work-centers/${id}`);
        if (!mounted) return;
        const wc = data.work_center || null;
        setWorkCenter(wc);
        if (wc) {
          setFormData({
            name: wc.name || '',
            code: wc.code || '',
            department_id: wc.department_id || '',
            overhead_hourly_rate: String(wc.overhead_hourly_rate ?? 0),
            speed: String(wc.speed ?? 1),
            efficiency: String(wc.efficiency ?? 100),
            is_active: wc.is_active ? 'true' : 'false',
          });
        }
      } catch (err) {
        console.error('Failed to load work center:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load work center details.');
        setWorkCenter(null);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    if (id) loadWorkCenter();
    return () => {
      mounted = false;
    };
  }, [id, reloadKey]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        department_id: formData.department_id || null,
        overhead_hourly_rate: Number(formData.overhead_hourly_rate),
        speed: Number(formData.speed),
        efficiency: Number(formData.efficiency),
        is_active: formData.is_active === 'true',
      };

      const { data } = await api.patch(`/work-centers/${id}`, payload);
      setWorkCenter(data.work_center);
      navigate(`/work-centers/${id}`);
    } catch (err) {
      console.error('Failed to update work center:', err);
      setError(err.response?.data?.error || 'Unable to update work center.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm('Deactivate this work center? It will be marked inactive.')) return;
    try {
      await api.delete(`/work-centers/${id}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to deactivate work center.');
    }
  };

  const handleAddMachine = async () => {
    if (!selectedMachine?.machine_record_id) {
      setMachineError('Select a machine to add.');
      return;
    }
    setAddingMachine(true);
    setMachineError(null);
    try {
      await api.post(`/work-centers/${id}/machines`, {
        machine_record_id: selectedMachine.machine_record_id,
      });
      setSelectedMachine(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to add machine:', err);
      setMachineError(err.response?.data?.error || 'Unable to add machine.');
    } finally {
      setAddingMachine(false);
    }
  };

  const handleRemoveMachine = async (machineRecordId) => {
    if (!window.confirm('Remove this machine from the work center?')) return;
    setRemovingId(machineRecordId);
    setMachineError(null);
    try {
      await api.delete(`/work-centers/${id}/machines/${machineRecordId}`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to remove machine:', err);
      setMachineError(err.response?.data?.error || 'Unable to remove machine.');
    } finally {
      setRemovingId(null);
    }
  };

  const toggleOperator = (employeeId) => {
    setSelectedOperatorIds((ids) =>
      ids.includes(employeeId) ? ids.filter((x) => x !== employeeId) : [...ids, employeeId]
    );
  };

  const handleSaveOperators = async () => {
    setSavingOperators(true);
    setOperatorError(null);
    try {
      const { data } = await api.put(`/work-centers/${id}/operators`, {
        employee_ids: selectedOperatorIds,
      });
      setOperators(data.operators || []);
      setSelectedOperatorIds((data.operators || []).map((o) => o.employee_id));
    } catch (err) {
      setOperatorError(err.response?.data?.error || 'Unable to save operators.');
    } finally {
      setSavingOperators(false);
    }
  };

  const machines = workCenter?.machines || [];

  const savedIdSet = useMemo(
    () => new Set(operators.map((o) => o.employee_id)),
    [operators]
  );

  const isDirty = useMemo(() => {
    if (selectedOperatorIds.length !== operators.length) return true;
    return selectedOperatorIds.some((eid) => !savedIdSet.has(eid));
  }, [selectedOperatorIds, operators.length, savedIdSet]);

  const selectedMembers = useMemo(() => {
    const byId = Object.fromEntries(allEmployees.map((e) => [e.id, e]));
    return selectedOperatorIds.map((eid, idx) => {
      const fromSaved = operators.find((o) => o.employee_id === eid);
      const emp = byId[eid];
      return {
        employee_id: eid,
        full_name: fromSaved?.full_name || emp?.full_name || 'Unknown',
        employee_code: fromSaved?.employee_code || emp?.employee_code || null,
        is_primary: idx === 0,
        is_saved: savedIdSet.has(eid),
      };
    });
  }, [selectedOperatorIds, allEmployees, operators, savedIdSet]);

  const filteredEmployees = useMemo(() => {
    const q = operatorSearch.trim().toLowerCase();
    return allEmployees
      .filter((e) => {
        if (!q) return true;
        return (
          String(e.full_name || '')
            .toLowerCase()
            .includes(q) ||
          String(e.employee_code || '')
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => {
        const aSel = selectedOperatorIds.includes(a.id) ? 0 : 1;
        const bSel = selectedOperatorIds.includes(b.id) ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''));
      });
  }, [allEmployees, operatorSearch, selectedOperatorIds]);

  const resetOperators = () => {
    setSelectedOperatorIds(operators.map((o) => o.employee_id));
    setOperatorError(null);
  };

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <p onClick={() => navigate('/work-centers')} style={{ cursor: 'pointer' }}>
          <ArrowLeft size={16} style={{ marginRight: 4, display: 'inline' }} />
          Back to work centers
        </p>
        <div className="employee-title-block">
          <div>
            <h1>{workCenter?.name || 'Work Center'}</h1>
            <p className="muted">{workCenter?.code}</p>
          </div>
          <div className="employee-top-bar" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="neutral-button"
              onClick={() => navigate(`/work-centers/${id}/edit`)}
            >
              <Pencil size={16} style={{ marginRight: 4, display: 'inline' }} />
              Edit
            </button>
            {workCenter?.is_active ? (
              <button type="button" className="neutral-button" onClick={handleDeactivate}>
                Deactivate
              </button>
            ) : null}
          </div>
        </div>

        <div className="pill-tabs">
          <button
            type="button"
            className={`pill-tab ${tab === 'details' ? 'pill-tab-active' : ''}`}
            onClick={() => {
              setTab('details');
              navigate(`/work-centers/${id}`);
            }}
            aria-selected={tab === 'details'}
            role="tab"
          >
            Details
          </button>
          <button
            type="button"
            className={`pill-tab ${tab === 'operators' ? 'pill-tab-active' : ''}`}
            onClick={() => {
              setTab('operators');
              navigate(`/work-centers/${id}#operators`);
            }}
            aria-selected={tab === 'operators'}
            role="tab"
          >
            Operators
            {operators.length ? (
              <span style={{ marginLeft: 6, opacity: 0.75 }}>({operators.length})</span>
            ) : null}
          </button>
        </div>
      </header>

      <section className="card employee-main">
        {loading ? (
          <p className="muted">Loading work center details...</p>
        ) : error && !workCenter ? (
          <p className="error-message">{error}</p>
        ) : !workCenter ? (
          <p className="muted">Work center not found.</p>
        ) : tab === 'operators' ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Operators</h2>
              <p className="muted" style={{ margin: 0, maxWidth: '56ch' }}>
                People eligible for auto-assignment at this work center when they are present.
                First selected member is treated as primary.
              </p>
            </div>

            <div className="mes-metric-grid" style={{ marginBottom: 16 }}>
              <MetricCard
                label="Linked"
                value={selectedOperatorIds.length}
                hint={isDirty ? 'Unsaved changes' : 'Saved roster'}
                icon={Users}
                tone={isDirty ? 'amber' : 'info'}
              />
              <MetricCard
                label="Primary"
                value={selectedMembers[0]?.full_name?.split(' ')[0] || '—'}
                hint={selectedMembers[0]?.employee_code || 'Set by first in list'}
                icon={Star}
              />
              <MetricCard
                label="Directory"
                value={allEmployees.length}
                hint="Active employees"
                icon={Search}
              />
            </div>

            {operatorError ? <p className="error-message">{operatorError}</p> : null}

            <div className="wc-ops-layout">
              <div className="wc-ops-panel">
                <div className="wc-ops-panel-head">
                  <div>
                    <h3>Current roster</h3>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Remove anyone who should no longer receive cards here.
                    </p>
                  </div>
                  <StatusBadge status={isDirty ? 'pending' : 'assigned'}>
                    {isDirty ? 'Unsaved' : 'Saved'}
                  </StatusBadge>
                </div>

                {!selectedMembers.length ? (
                  <EmptyState
                    icon={Users}
                    title="No operators linked"
                    description="Pick people from the directory on the right. They become eligible for equalized backlog assignment when present."
                  />
                ) : (
                  <div className="wc-ops-roster">
                    {selectedMembers.map((m) => (
                      <div
                        key={m.employee_id}
                        className={`wc-ops-member${m.is_primary ? ' is-primary' : ''}`}
                      >
                        <span className="mes-avatar" title={m.full_name}>
                          {initials(m.full_name)}
                        </span>
                        <div className="wc-ops-member-info">
                          <strong>
                            <TruncatedText>{m.full_name}</TruncatedText>
                          </strong>
                          <span>
                            {m.employee_code || 'No code'}
                            {m.is_primary ? ' · Primary' : ''}
                            {!m.is_saved ? ' · New' : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          style={{ padding: '8px 10px' }}
                          disabled={savingOperators}
                          onClick={() => toggleOperator(m.employee_id)}
                          title="Remove from roster"
                          aria-label={`Remove ${m.full_name}`}
                        >
                          <UserMinus size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="wc-ops-panel">
                <div className="wc-ops-panel-head">
                  <div>
                    <h3>Add from directory</h3>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Search and toggle employees onto this work center.
                    </p>
                  </div>
                </div>

                <label style={{ display: 'block', marginBottom: 0 }}>
                  <span className="mes-detail-label">Search</span>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={15}
                      style={{
                        position: 'absolute',
                        left: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-secondary)',
                        pointerEvents: 'none',
                      }}
                    />
                    <input
                      type="search"
                      value={operatorSearch}
                      onChange={(e) => setOperatorSearch(e.target.value)}
                      placeholder="Name or employee code…"
                      disabled={savingOperators}
                      style={{ paddingLeft: 36, width: '100%' }}
                    />
                  </div>
                </label>

                <div className="wc-ops-directory">
                  {filteredEmployees.map((emp) => {
                    const selected = selectedOperatorIds.includes(emp.id);
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        className={`wc-ops-dir-row${selected ? ' is-selected' : ''}`}
                        disabled={savingOperators}
                        onClick={() => toggleOperator(emp.id)}
                        aria-pressed={selected}
                      >
                        <span className="wc-ops-check" aria-hidden>
                          <Check size={12} strokeWidth={3} />
                        </span>
                        <span className="mes-avatar">{initials(emp.full_name)}</span>
                        <div className="wc-ops-member-info">
                          <strong>
                            <TruncatedText>{emp.full_name}</TruncatedText>
                          </strong>
                          <span>{emp.employee_code || 'No code'}</span>
                        </div>
                      </button>
                    );
                  })}
                  {!filteredEmployees.length ? (
                    <p className="muted" style={{ padding: 12, margin: 0 }}>
                      No employees match “{operatorSearch}”.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="wc-ops-footer">
              <div>
                {isDirty ? (
                  <span className="wc-ops-dirty">You have unsaved roster changes</span>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>
                    Roster matches what is saved
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mes-btn mes-btn-secondary"
                  disabled={savingOperators || !isDirty}
                  onClick={resetOperators}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="mes-btn mes-btn-primary"
                  disabled={savingOperators || !isDirty}
                  onClick={handleSaveOperators}
                >
                  <Save size={15} />
                  {savingOperators ? 'Saving…' : 'Save roster'}
                </button>
              </div>
            </div>
          </>
        ) : tab === 'details' ? (
          <>
            <div className="employee-details-grid">
              <div className="employee-detail-grid">
                <DetailItem label="Name" value={workCenter.name} />
                <DetailItem label="Code" value={workCenter.code} />
                <DetailItem label="Department" value={workCenter.department} />
                <DetailItem
                  label="Overhead hourly rate"
                  value={workCenter.overhead_hourly_rate}
                />
                <DetailItem label="Speed" value={workCenter.speed} />
                <DetailItem label="Efficiency" value={`${workCenter.efficiency}%`} />
                <DetailItem
                  label="Status"
                  value={workCenter.is_active ? 'Active' : 'Inactive'}
                />
                <DetailItem
                  label="Operators"
                  value={
                    operators.length
                      ? operators.map((o) => o.full_name).join(', ')
                      : 'None linked'
                  }
                />
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <div
                className="section-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <h2>Machines</h2>
                  <p className="muted">
                    Machines assigned to this work center. Each machine can belong to only one center.
                  </p>
                </div>
              </div>

              {machineError ? <p className="error-message">{machineError}</p> : null}

              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginBottom: 16,
                }}
              >
                <AvailableMachineSelect
                  value={selectedMachine?.machine_record_id}
                  label={selectedMachine?.label || ''}
                  onChange={setSelectedMachine}
                  disabled={addingMachine}
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleAddMachine}
                  disabled={addingMachine || !selectedMachine?.machine_record_id}
                >
                  {addingMachine ? 'Adding...' : 'Add Machine'}
                </button>
              </div>

              <div className="employees-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Machine</th>
                      <th style={{ width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machines.map((m) => (
                      <tr key={m.id}>
                        <td>{m.sequence}</td>
                        <td>
                          <strong>{m.label}</strong>
                          <div className="table-subtext">{m.machine_record_id.slice(0, 8)}…</div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="cancel-button"
                            disabled={removingId === m.machine_record_id}
                            onClick={() => handleRemoveMachine(m.machine_record_id)}
                            title="Remove machine"
                            style={{ padding: '6px 10px' }}
                          >
                            <Trash2 size={14} style={{ display: 'inline' }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {machines.length === 0 ? (
                      <tr>
                        <td colSpan="3" className="muted">
                          No machines assigned yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error ? <p className="error-message">{error}</p> : null}

            <label htmlFor="name">
              Name <span style={{ color: '#b91c1c' }}>*</span>
              <input
                id="name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="code">
              Code <span style={{ color: '#b91c1c' }}>*</span>
              <input
                id="code"
                type="text"
                name="code"
                value={formData.code}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="department_id">
              Department
              <select
                id="department_id"
                name="department_id"
                value={formData.department_id}
                onChange={handleChange}
                disabled={submitting}
              >
                <option value="">Select a department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="overhead_hourly_rate">
              Overhead hourly rate
              <input
                id="overhead_hourly_rate"
                type="number"
                name="overhead_hourly_rate"
                value={formData.overhead_hourly_rate}
                onChange={handleChange}
                min="0"
                step="0.01"
                disabled={submitting}
              />
            </label>

            <label htmlFor="speed">
              Speed
              <input
                id="speed"
                type="number"
                name="speed"
                value={formData.speed}
                onChange={handleChange}
                min="0.0001"
                step="0.01"
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="efficiency">
              Efficiency (%)
              <input
                id="efficiency"
                type="number"
                name="efficiency"
                value={formData.efficiency}
                onChange={handleChange}
                min="0.01"
                max="100"
                step="0.01"
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="is_active">
              Status
              <select
                id="is_active"
                name="is_active"
                value={formData.is_active}
                onChange={handleChange}
                disabled={submitting}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>

            <div className="form-actions" style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="neutral-button"
                disabled={submitting}
                onClick={() => navigate(`/work-centers/${id}`)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
