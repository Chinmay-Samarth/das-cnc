import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

const initialFormData = {
  name: '',
  code: '',
  department_id: '',
  overhead_hourly_rate: '0',
  speed: '1',
  efficiency: '100',
  is_active: 'true',
};

export default function AddWorkCenterPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormData);
  const [departments, setDepartments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .get('/employees/departments')
      .then(({ data }) => {
        if (!mounted) return;
        setDepartments(data.departments || []);
      })
      .catch((err) => {
        console.error('Failed to load departments:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

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

      const { data } = await api.post('/work-centers', payload);
      navigate(`/work-centers/${data.work_center.id}`);
    } catch (err) {
      console.error('Failed to create work center:', err);
      setError(err.response?.data?.error || 'Unable to create work center. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell add-employee-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Production resources</p>
          <h1>Add Work Center</h1>
          <p className="muted">Create a new work center and assign machines on the detail page.</p>
        </div>
      </header>

      <section className="card form-card">
        {error ? <p className="error-message">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="name">
            Name <span style={{ color: '#b91c1c' }}>*</span>
            <input
              id="name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., Cutting Center"
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
              placeholder="e.g., CUT-01"
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
              {submitting ? 'Creating...' : 'Create Work Center'}
            </button>
            <button
              type="button"
              className="neutral-button"
              disabled={submitting}
              onClick={() => navigate('/work-centers')}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
