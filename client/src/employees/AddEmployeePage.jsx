import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import { FilePicker, FormActions, FormPage } from '../components/mes';

const JOB_DESCRIPTION_OPTIONS = [
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

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
    job_description: 'OPERATOR',
    department_id: '',
    shift_id: '',
    password: '',
  });

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
        if (mounted) setLoading(false);
      }
    }

    loadDependencies();
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const setFieldValue = (name) => (value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const departmentOptions = departments.map((dept) => ({ value: dept.id, label: dept.name }));
  const shiftOptions = shifts.map((shift) => ({ value: shift.id, label: shift.name }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = new FormData();
      payload.append('employee_code', formData.employee_code.trim());
      payload.append('full_name', formData.full_name.trim());
      payload.append('job_description', formData.job_description);
      payload.append('department_id', formData.department_id || '');
      payload.append('shift_id', formData.shift_id || '');
      payload.append('password', formData.password || '');
      if (photo) payload.append('photo', photo);
      await api.post('/employees', payload);
      navigate('/employees');
    } catch (err) {
      console.error('Failed to create employee:', err);
      setError(err.response?.data?.error || 'Unable to create employee. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormPage
      eyebrow="Workforce"
      title="Add employee"
      subtitle="Create a new employee record."
      onBack={() => navigate('/employees')}
      backLabel="All employees"
      error={error}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-page-grid">
          <label htmlFor="employee_code">
            Employee code <span className="required-mark">*</span>
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
            Full name <span className="required-mark">*</span>
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

          <label htmlFor="job_description">
            Job description <span className="required-mark">*</span>
            <FormSearchSelect
              value={formData.job_description}
              onChange={setFieldValue('job_description')}
              options={JOB_DESCRIPTION_OPTIONS}
              placeholder="Select a role"
              disabled={submitting}
              clearable={false}
            />
          </label>

          <label htmlFor="department_id">
            Department
            <FormSearchSelect
              value={formData.department_id}
              onChange={setFieldValue('department_id')}
              options={departmentOptions}
              placeholder="Select a department"
              disabled={submitting || loading}
              searchable={departmentOptions.length > 6}
            />
          </label>

          <label htmlFor="shift_id">
            Shift
            <FormSearchSelect
              value={formData.shift_id}
              onChange={setFieldValue('shift_id')}
              options={shiftOptions}
              placeholder="Select a shift"
              disabled={submitting || loading}
              searchable={shiftOptions.length > 6}
            />
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

          <label htmlFor="photo" className="form-span-2">
            Photo
            <FilePicker
              id="photo"
              accept="image/*"
              disabled={submitting}
              fileName={photo?.name}
              label={photo ? 'Replace photo' : 'Choose photo'}
              onChange={setPhoto}
            />
          </label>
        </div>

        <FormActions
          saving={submitting}
          onCancel={() => navigate('/employees')}
          saveLabel={submitting ? 'Creating…' : 'Create employee'}
        />
      </form>
    </FormPage>
  );
}
