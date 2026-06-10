import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../api/client';

const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%23E5E7EB" width="100%25" height="100%25"/><text x="50%25" y="54%25" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23717A83" font-family="system-ui, sans-serif">?</text></svg>';

export default function EmployeeDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [formData, setFormData] = useState({
    employee_code: '',
    full_name: '',
    role: 'OPERATOR',
    department_id: '',
    shift_id: '',
    password: '',
    is_active: 'true',
  });
  const [photo, setPhoto] = useState(null);
  const [tab, setTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else {
      setTab('details');
    }
  }, [location.pathname]);

  useEffect(() => {
    let mounted = true;

    async function loadEmployee() {
      try {
        setLoading(true);
        setError(null);
        const [employeeRes, departmentsRes, shiftsRes] = await Promise.all([
          api.get(`/employees/${id}`),
          api.get('/employees/departments'),
          api.get('/employees/shifts'),
        ]);

        if (!mounted) return;
        const loadedEmployee = employeeRes.data.employee || null;
        setEmployee(loadedEmployee);
        setDepartments(departmentsRes.data.departments || []);
        setShifts(shiftsRes.data.shifts || []);

        if (loadedEmployee) {
          setFormData({
            employee_code: loadedEmployee.employee_code || '',
            full_name: loadedEmployee.full_name || '',
            role: loadedEmployee.role || 'OPERATOR',
            department_id: loadedEmployee.department_id || '',
            shift_id: loadedEmployee.shift_id || '',
            password: '',
            is_active: loadedEmployee.is_active ? 'true' : 'false',
          });
        }
      } catch (err) {
        console.error('Failed to load employee details:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load employee details.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadEmployee();
    return () => {
      mounted = false;
    };
  }, [id]);

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
      payload.append('is_active', formData.is_active);
      if (photo) {
        payload.append('photo', photo);
      }

      await api.put(`/employees/${id}`, payload);
      const { data } = await api.get(`/employees/${id}`);
      setEmployee(data.employee || null);
      setTab('details');
      setPhoto(null);
      setFormData((prev) => ({ ...prev, password: '' }));
    } catch (err) {
      console.error('Failed to update employee:', err);
      setError(err.response?.data?.error || 'Unable to update employee. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="app-shell employee-details-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Workforce management</p>
          <h1>Employee details</h1>
          <p className="muted">Review the selected employee’s full profile and make changes when necessary.</p>
        </div>
      </header>

      <section className="card form-card">
        <div className="tab-row" style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <button
            type="button"
            className={tab === 'details' ? 'primary-button' : 'secondary-button'}
            onClick={() => navigate(`/employees/${id}`)}
          >
            Details
          </button>
          <button
            type="button"
            className={tab === 'edit' ? 'primary-button' : 'secondary-button'}
            onClick={() => navigate(`/employees/${id}/edit`)}
          >
            Edit
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/employees')}
            disabled={submitting}
              >
            Back to employees
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading employee details...</p>
        ) : error ? (
          <p className="error-message">{error}</p>
        ) : !employee ? (
          <p className="muted">Employee not found.</p>
        ) : tab === 'details' ? (
          <>
            <div className="employee-details-grid">
              <div style={{ gridColumn: 'span 2' }}>
                <p className='text-xl font-medium'>Photo</p>
                <img
                  src={employee.img_url || PLACEHOLDER_AVATAR}
                  alt={employee.img_url ? `${employee.full_name} photo` : 'No photo available'}
                  style={{ width: '160px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb' }}
                />
              </div>
              <div className="space-y-10">

                <div className=" ">
                  <p class="text-xl font-medium">Full Name</p>
                  <p class="font-medium ">{employee.full_name}</p>
                </div>

                <div class="">
                  <p class="text-xl font-medium">Employee Code</p>
                  <p class="font-medium ">{employee.employee_code}</p>
                </div>

                <div>
                  <p class="text-xl font-medium">Role</p>
                  <p class="font-medium ">{employee.role}</p>
                </div>
                <div>
                  <p class="text-xl font-medium">Status</p>
                  <p class="font-medium ">{employee.status}</p>
                </div>
                <div>
                  <p class="text-xl font-medium">Department</p>
                  <p class="font-medium ">{employee.department || "Not assigned"}</p>
                </div>
                <div>
                  <p class="text-xl font-medium">Shift</p>
                  <p class="font-medium ">{employee.shift || "Not assigned"}</p>
                </div>
                {employee.created_at ? (
                  <div>
                    <p class="text-xl font-medium">Created At</p>
                  <p class="font-medium ">{new Date(employee.created_at).toLocaleString()}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error ? <p class="error-message">{error}</p> : null}

            <div class="flex flex-col md:flex-row gap-8 items-start">

            {employee.img_url ? (
              <div style={{ marginBottom: '16px' }}>
                <p class="text-xl font-medium mb-3">Current photo</p>
                <img
                  src={employee.img_url}
                  alt={`${employee.full_name} current photo`}
                  style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db' }}
                  class='w-36 h-36 object-cover rounded-xl border border-gray-300'
                  />
              </div>
            ) : null}

            <label htmlFor="photo" className=''>
              <p class="text-xl font-medium mb-3">Photo</p>
              <input
                id="photo"
                type="file"
                accept="image/*"
                name="photo"
                onChange={handleFileChange}
                disabled={submitting}
                class='w-10'
                />
            </label>

            </div>

            <label htmlFor="employee_code">
              <div className="flex item-center gap-1">
                <span>Employee Code  </span>
                <span style={{ color: '#b91c1c', display:"inline" }}>*</span>
              </div>
              <input
                id="employee_code"
                type="text"
                name="employee_code"
                value={formData.employee_code}
                onChange={handleChange}
                required
                disabled={submitting}
                class=''
              />
            </label>

            <label htmlFor="full_name">
              <div className="flex item-center gap-1">  
                <span>Full Name</span>
                <span style={{ color: '#b91c1c' }}>*</span>
              </div>
              <input
                id="full_name"
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </label>

            <label htmlFor="role">
              <div className="flex item-center gap-1">
                <span>Role</span>
                <span style={{ color: '#b91c1c' }}>*</span>
              </div>
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

            <label htmlFor="shift_id">
              Shift
              <select
                id="shift_id"
                name="shift_id"
                value={formData.shift_id}
                onChange={handleChange}
                disabled={submitting}
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
                placeholder="Leave blank to keep current password"
                disabled={submitting}
              />
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/employees/${id}`)}
                disabled={submitting}
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
