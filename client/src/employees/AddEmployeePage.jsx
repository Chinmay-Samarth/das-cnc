import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    employee_code: '',
    full_name: '',
    role: 'OPERATOR',
    department_id: '',
    shift_id: '',
    password: '',
  });

  // Fetch departments and shifts on mount
  useEffect(() => {
    let mounted = true;

    async function loadDependencies() {
      try {
        setLoading(true);
        const [deptRes, shiftsRes] = await Promise.all([
          api.get('/employees/departments'),
          api.get('/employees/shifts'),
        ]);

        if (!mounted) return;
        setDepartments(deptRes.data.departments || []);
        setShifts(shiftsRes.data.shifts || []);
      } catch (err) {
        console.error('Failed to load departments/shifts:', err);
        if (!mounted) return;
        setError('Unable to load departments and shifts.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadDependencies();
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFileChange = (e) => {
    setPhoto(e.target.files[0] || null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = new FormData();
      payload.append('employee_code', formData.employee_code.trim());
      payload.append('full_name', formData.full_name.trim());
      payload.append('role', formData.role);
      payload.append('department_id', formData.department_id || '');
      payload.append('shift_id', formData.shift_id || '');
      payload.append('password', formData.password || '');
      if (photo) {
        payload.append('photo', photo);
      }

      await api.post('/employees', payload);

      // Navigate back to employees page on success
      navigate('/employees');
    } catch (err) {
      console.error('Failed to create employee:', err);
      setError(err.response?.data?.error || 'Unable to create employee. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell add-employee-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Workforce management</p>
          <h1>Add New Employee</h1>
          <p className="muted">Create a new employee record in the system.</p>
        </div>
      </header>

      <section className="card form-card">
        {error ? <p className="error-message">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <label htmlFor="employee_code">
            Employee Code <span style={{ color: '#b91c1c' }}>*</span>
            <input
              id="employee_code"
              type="text"
              name="employee_code"
              value={formData.employee_code}
              onChange={handleChange}
              placeholder="e.g., DAS001"
              required
              disabled={submitting}
            />
          </label>

          <label htmlFor="full_name">
            Full Name <span style={{ color: '#b91c1c' }}>*</span>
            <input
              id="full_name"
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              placeholder="e.g., John Doe"
              required
              disabled={submitting}
            />
          </label>

          <label htmlFor="role">
            Role <span style={{ color: '#b91c1c' }}>*</span>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              required
              disabled={submitting}
            >
              <option value="OPERATOR">Operator</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>

          <label htmlFor="department_id">
            Department
            <select
              id="department_id"
              name="department_id"
              value={formData.department_id}
              onChange={handleChange}
              disabled={submitting || loading}
            >
              <option value="">Select a department</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="photo">
            Photo
            <input
              id="photo"
              type="file"
              accept="image/*"
              name="photo"
              onChange={handleFileChange}
              disabled={submitting}
            />
          </label>

          <label htmlFor="shift_id">
            Shift
            <select
              id="shift_id"
              name="shift_id"
              value={formData.shift_id}
              onChange={handleChange}
              disabled={submitting || loading}
            >
              <option value="">Select a shift</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="password">
            Password
            <input
              id="password"
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Leave blank to auto-generate"
              disabled={submitting}
            />
          </label>

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button
              type="submit"
              className="primary-button"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Employee'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/employees')}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
