import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import api from '../api/client';
import AvailableMachineSelect from './AvailableMachineSelect';

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

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else {
      setTab('details');
    }
  }, [location.pathname]);

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

  const machines = workCenter?.machines || [];

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
        </div>
      </header>

      <section className="card employee-main">
        {loading ? (
          <p className="muted">Loading work center details...</p>
        ) : error && !workCenter ? (
          <p className="error-message">{error}</p>
        ) : !workCenter ? (
          <p className="muted">Work center not found.</p>
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
