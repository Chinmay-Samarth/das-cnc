import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../api/client';
import { toDisplayTime, toISODateString } from '../attendance/useDailyAttendance';
import ImageLightbox from '../components/shared/ImageLightBox';
import AttendanceGauge from '../components/shared/Attendancegauge';

const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%23E5E7EB" width="100%25" height="100%25"/><text x="50%25" y="54%25" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23717A83" font-family="system-ui, sans-serif">?</text></svg>';

function countWorkingDaysInMonth(monthDate, cutoffDate = null, startDate){
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date (year, month +1, 0).getDate()


  let firstDayToCount = 0;

  if (
    startDate &&
    startDate.getFullYear() === year &&
    startDate.getMonth() === month
  ) {
    firstDayToCount = startDate.getDate() + 1;
  }

  let lastDayToCount = daysInMonth;
  if (cutoffDate && cutoffDate.getFullYear() === year && cutoffDate.getMonth() === month){
    lastDayToCount = Math.min(daysInMonth, cutoffDate.getDate())
  }

  let count = 0;
  for(let day = firstDayToCount; day<=lastDayToCount; day+=1){
    const isSunday = new Date(year,month,day).getDay() === 0;
    if(!isSunday) count+=1
  }

  return count
}

function summarizeMonth(record, totalWorkingDays){
  const summary = {
    present: 0,
    completed: 0,
    late: 0,
  }

  record.forEach(row => {
    const status = String(row.status || '').toUpperCase()
    if (status=== "PRESENT") summary.present +=1
    else if (status === "COMPLETED") summary.completed +=1
    else if (status === "LATE") summary.late +=1
  });

  const attendedDays = summary.present + summary.completed + summary.late;
  const absent = Math.max(totalWorkingDays - attendedDays,0) 

  const score  = totalWorkingDays > 0? Math.min(100, Math.round((attendedDays/totalWorkingDays)*100)): 0;

  return {...summary, attendedDays, absent, totalWorkingDays,score}
}

function startOfMonth(date){
  return new Date(date.getFullYear(), date.getMonth(),1)

}

function shiftMonth(date,delta){
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

function isSameMonth(a,b){
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}


function formatMonthLabel(date) {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function StatTile({label,value,accent}){
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderTop: `3px solid ${accent}`,
        borderRadius: '10px',
        padding: '14px 16px',
        background: '#fafafa',
      }}
    >
      <p className="text-xs uppercase font-medium" style={{ margin: 0, letterSpacing: '0.06em', color: '#6b7280' }}>
        {label}
      </p>
      <p
        className="font-bold"
        style={{
          margin: '4px 0 0',
          fontSize: '26px',
          lineHeight: 1,
          color: '#111827',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {value}
      </p>
    </div>
  );
}


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
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [photo, setPhoto] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState(null);
  const [tab, setTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [lightBox, setLightBox] = useState(null)

  const getStatusChipClass = (status) => {
    const normalized = String(status || '').toUpperCase();
    switch (normalized) {
      case 'ABSENT':
        return 'absent';
      case 'LATE':
        return 'late';
      case 'PRESENT':
        return 'present';
      case 'COMPLETED':
        return 'completed';
      default:
        return '';
    }
  };

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

  useEffect(() => {
    let mounted = true;

    async function loadMonthlyttendance() {
      try {
        setAttendanceLoading(true);
        setAttendanceError(null);

        const { data } = await api.get(`/attendance/employee/${id}/monthly`, {
          params :{
            month: selectedMonth.getMonth() +1,
            year: selectedMonth.getFullYear()
          }
        });
        if (!mounted) return;

        setAttendanceRecords(data.records || [])
      } catch (err) {
        console.error('Failed to load attendance snapshots:', err);
        if (!mounted) return;
        setAttendanceError(err.response?.data?.error || 'Unable to load attendance snapshots.');
      } finally {
        if (!mounted) return;
        setAttendanceLoading(false);
      }
    }

    if (id) {
      loadMonthlyttendance();
    } else {
      setAttendanceRecords([]);
      setAttendanceLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [id, selectedMonth]);

  const employeeJoinDate = employee?.created_at
  ? new Date(employee.created_at)
  : null;

  const totalWorkingDays = useMemo(()=> countWorkingDaysInMonth(selectedMonth, new Date(), employeeJoinDate), [selectedMonth, employeeJoinDate]);
   
  const attendanceSummary = useMemo(
    ()=> summarizeMonth(attendanceRecords, totalWorkingDays),
    [attendanceRecords, totalWorkingDays]
  )

  const employeeJoinMonth = employee?.created_at ? startOfMonth(new Date(employee.created_at)): null;
  const isPrevMonthDisabled = employeeJoinMonth ? selectedMonth <= employeeJoinMonth : false;
  const isNextMonthDisabled = isSameMonth(selectedMonth, new Date())


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
    <main className="app-shell employee-details-page masters-page component-details-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Workforce management</p>
          <h1>Employee details</h1>
          {/* <p className="muted">Review the selected employee’s full profile and make changes when necessary.</p> */}
        </div>
      </header>

      <section className="card form-card">
        <div className="tab-row" style={{ display: 'flex', gap: '12px', marginBottom: '24px' }} >
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
                <img
                  src={employee.img_url || PLACEHOLDER_AVATAR}
                  alt={employee.img_url ? `${employee.full_name} photo` : 'No photo available'}
                  style={{ width: '160px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb',cursor: "pointer" }}
                  onClick={()=>{setLightBox({ src: employee.img_url, alt: employee.full_name })}}
                />

                {lightBox && (
                  <ImageLightbox
                  src={lightBox.src}
                  alt={lightBox.alt}
                  onClose={() => setLightBox(null)}
                />
                )}

              </div>
              <div className=" employee-detail-grid">

                <div className=" ">
                  <p className="text-xl font-medium">Full Name</p>
                  <p className="font-bold ">{employee.full_name}</p>
                </div>

                <div className="">
                  <p className="text-xl font-medium">Employee Code</p>
                  <p className="font-bold ">{employee.employee_code}</p>
                </div>

                <div>
                  <p className="text-xl font-medium">Role</p>
                  <p className="font-bold ">{employee.role}</p>
                </div>
                <div>
                  <p className="text-xl font-medium">Status</p>
                  <p className="font-bold ">{employee.status}</p>
                </div>
                <div>
                  <p className="text-xl font-medium">Department</p>
                  <p className="font-bold ">{employee.department || "Not assigned"}</p>
                </div>
                <div>
                  <p className="text-xl font-medium">Shift</p>
                  <p className="font-bold ">{employee.shift || "Not assigned"}</p>
                </div>
                {employee.created_at ? (
                  <div>
                    <p className="text-xl font-medium">Created At</p>
                  <p className="font-bold ">{new Date(employee.created_at).toLocaleString()}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <section className="card employee-details-attendance">
              <div className="section-header "
              style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px"}}>
                <h2>Attendance &amp; report</h2>
                <span className="count-chip">{attendanceRecords.length}</span>
                <p className="text-sm" style={{ margin: '2px 0 0', color: '#6b7280' }}>
                    {attendanceLoading
                      ? 'Loading...'
                      : `${attendanceSummary.totalWorkingDays} working days ${
                          isNextMonthDisabled ? 'so far this month' : 'this month'
                        } (Mon\u2013Sat)`}
                  </p>
              </div>

              <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedMonth((prev) => shiftMonth(prev, -1))}
                    disabled={isPrevMonthDisabled}
                    aria-label="Previous month"
                  >
                    &lsaquo;
                  </button>
                  <span className="font-semibold" style={{ minWidth: '150px', textAlign: 'center', display: 'inline-block' }}>
                    {formatMonthLabel(selectedMonth)}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedMonth((prev) => shiftMonth(prev, 1))}
                    disabled={isNextMonthDisabled}
                    aria-label="Next month"
                  >
                    &rsaquo;
                  </button>
                </div>

              {attendanceLoading ? (
                <p className="muted">Loading attendance for {formatMonthLabel(selectedMonth)}...</p>
              ) : attendanceError ? (
                <p className="error-message">{attendanceError}</p>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '28px',
                      borderBottom: '1px solid #e5e7eb',
                      paddingBottom: '24px',
                      marginBottom: '24px',
                    }}
                  >
                    <AttendanceGauge score={attendanceSummary.score} size={220} />

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '12px',
                        flex: '1 1 320px',
                      }}
                    >
                      <StatTile label="Present" value={attendanceSummary.present + attendanceSummary.completed} accent="#059669" />
                      <StatTile label="Late" value={attendanceSummary.late} accent="#d97706" />
                      <StatTile label="Absent" value={attendanceSummary.absent} accent="#dc2626" />
                    </div>
                  </div>

                  {attendanceRecords.length === 0 ? (
                    <p className="muted">No attendance records found for {formatMonthLabel(selectedMonth)}.</p>
                  ) : (
                    <div className="attendance-table-wrap">
                      <table className="attendance-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Shift</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Status</th>
                            <th>Minutes</th>
                            <th>OT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attendanceRecords.map((row) => (
                            <tr key={`${row.shift_date}-${row.punched_in_at || ''}-${row.punched_out_at || ''}`}>
                              <td>{toISODateString(row.shift_date)}</td>
                              <td>{row.shift || '--'}</td>
                              <td>{toDisplayTime(row.punched_in_at)}</td>
                              <td>{toDisplayTime(row.punched_out_at)}</td>
                              <td>
                                <span className={`status-chip ${getStatusChipClass(row.status)}`}>
                                  {row.status || '--'}
                                </span>
                              </td>
                              <td>{row.minutes_worked ?? '--'}</td>
                              <td>{row.overtime_minutes ?? '--'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error ? <p className="error-message">{error}</p> : null}

            <div className="flex flex-col md:flex-row gap-8 items-start">

            {employee.img_url ? (
              <div style={{ marginBottom: '16px' }}>
                <p className="text-xl font-medium mb-3">Current photo</p>
                <img
                  src={employee.img_url}
                  alt={`${employee.full_name} current photo`}
                  style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db' }}
                  className='w-36 h-36 object-cover rounded-xl border border-gray-300'
                  />
              </div>
            ) : null}

            <label htmlFor="photo" className=''>
              <p className="text-xl font-medium mb-3">Photo</p>
              <input
                id="photo"
                type="file"
                accept="image/*"
                name="photo"
                onChange={handleFileChange}
                disabled={submitting}
                className='w-10'
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
                className=''
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
