import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../api/client';
import { toDisplayTime, toISODateString } from '../attendance/useDailyAttendance';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import ImageLightbox from '../components/shared/ImageLightBox';
import AttendanceGauge from '../components/shared/Attendancegauge';
import StatTile from '../components/shared/StatTile';
import { ArrowLeft, ChevronLeft, ChevronRight, Factory, Pencil, TrendingUp } from 'lucide-react';
import { EmptyState, MetricCard, StatusBadge, TruncatedText, AlertBanner, FilePicker, FormActions } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import EmployeeMinutesBarChart from './EmployeeMinutesBarChart';
import EmployeeEfficiencyLineChart from './EmployeeEfficiencyLineChart';

const JOB_DESCRIPTION_OPTIONS = [
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CURRENT', label: 'Current' },
];

const PLACEHOLDER_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%23E5E7EB" width="100%25" height="100%25"/><text x="50%25" y="54%25" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23717A83" font-family="system-ui, sans-serif">?</text></svg>';

const LOCAL_TABS = ['details', 'attendance', 'documents', 'address', 'commercials', 'efficiency', 'edit'];

function efficiencyTone(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return 'pending';
  const n = Number(pct);
  if (n >= 80) return 'completed';
  if (n >= 50) return 'ready';
  return 'overdue';
}

// ─── pure helpers (unchanged) ─────────────────────────────────────────────────

function getDaysInMonthRange(monthDate, cutoffDate = null, startDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let firstDayToCount = 1;
  if (startDate && startDate.getFullYear() === year && startDate.getMonth() === month) {
    firstDayToCount = startDate.getDate() + 1;
  }

  let lastDayToCount = daysInMonth;
  if (cutoffDate && cutoffDate.getFullYear() === year && cutoffDate.getMonth() === month) {
    lastDayToCount = Math.min(daysInMonth, cutoffDate.getDate());
  }

  const days = [];
  for (let day = firstDayToCount; day <= lastDayToCount; day += 1) {
    days.push(toISODateString(new Date(year, month, day)));
  }
  return days;
}

function summarizeMonth(records, daysInRange) {
  const summary = { present: 0, completed: 0, late: 0, half_day: 0 };
  const attendedDates = new Set();
  const leaveDates = new Set();

  records.forEach((row) => {
    const status = String(row.status || '').toUpperCase();
    const date = toISODateString(row.shift_date);
    if (status === 'PRESENT') {
      summary.present += 1;
      attendedDates.add(date);
    } else if (status === 'COMPLETED') {
      summary.completed += 1;
      attendedDates.add(date);
    } else if (status === 'LATE') {
      summary.late += 1;
      attendedDates.add(date);
    } else if (status === 'HALF_DAY') {
      summary.half_day += 1;
      attendedDates.add(date);
    } else if (status === 'LEAVE') {
      leaveDates.add(date);
    }
  });

  // Late and half days count as present for attendance score / present total
  const presentDays = summary.present + summary.completed + summary.late + summary.half_day;
  const totalDays = daysInRange.length;
  const absentDates = daysInRange.filter((date) => !attendedDates.has(date) && !leaveDates.has(date));
  const absent = absentDates.length;
  const score = totalDays > 0 ? Math.min(100, Math.round((presentDays / totalDays) * 100)) : 0;

  return {
    ...summary,
    presentDays,
    attendedDays: presentDays,
    absent,
    absentDates,
    leaveDates: [...leaveDates].sort(),
    leaveDays: leaveDates.size,
    totalWorkingDays: totalDays,
    score,
  };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// FIX: was ignoring delta and always going forward
function shiftMonth(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function formatMonthLabel(date) {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ─── sub-components ───────────────────────────────────────────────────────────



// Shows an uploaded file: image → lightbox, PDF → new tab
function DocPreview({ url, label, onImageClick }) {
  if (!url) return <p className="font-bold">--</p>;
  const isPdf = url.toLowerCase().includes('.pdf');
  if (isPdf) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        <div style={{ width: '120px', height: '120px', borderRadius: '10px', border: '1px solid #d1d5db', backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <text x="6" y="19" fontSize="5" fill="#ef4444" stroke="none" fontWeight="bold" fontFamily="sans-serif">PDF</text>
          </svg>
          <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '0 6px' }}>{label}<br />Click to open</span>
        </div>
      </a>
    );
  }
  return (
    <img
      src={url}
      alt={label}
      style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb', cursor: 'pointer' }}
      onClick={() => onImageClick(url, label)}
    />
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function EmployeeDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [employee, setEmployee] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);

  // FIX: formData initial state now includes ALL fields so they're never undefined
  const [formData, setFormData] = useState({
    employee_code: '',
    full_name: '',
    job_description: '',
    department_id: '',
    shift_id: '',
    password: '',
    is_active: 'true',
    // address
    temporary_address: '',
    permanent_address: '',
    // bank
    bank_name: '',
    bank_account_number: '',
    account_type: 'SAVINGS',
    ifsc: '',
    // compensation
    PT: '',
    basic_salary: '',
    OT: '',
    PA: '',
    allowance: '',
  });

  const [photo, setPhoto] = useState(null);
  const [aadharFile, setAadharFile] = useState(null);
  const [marksCardFile, setMarksCardFile] = useState(null);
  const [workExperienceFile, setWorkExperienceFile] = useState(null);
  const [thumbFile, setThumbFile] = useState(null);

  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState(null);
  const [efficiencyData, setEfficiencyData] = useState(null);
  const [efficiencyLoading, setEfficiencyLoading] = useState(false);
  const [efficiencyError, setEfficiencyError] = useState(null);
  const [tab, setTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusToggling, setStatusToggling] = useState(false);
  const [error, setError] = useState(null);
  const [lightBox, setLightBox] = useState(null);

  // ── URL → tab sync (kept as-is for details/edit routing) ─────────────────

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else if (!LOCAL_TABS.includes(tab)) {
      setTab('details');
    }
  }, [location.pathname, tab]);

  // ── load employee ─────────────────────────────────────────────────────────

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

        const emp = employeeRes.data.employee || null;  // FIX: was called loadedEmployee vs loadEmployee
        setEmployee(emp);
        setDepartments(departmentsRes.data.departments || []);
        setShifts(shiftsRes.data.shifts || []);

        if (emp) {
          setFormData({
            employee_code:       emp.employee_code || '',
            full_name:           emp.full_name || '',
            job_description:     emp.job_description || '',   // FIX: default was 'OPERATOR'
            department_id:       emp.department_id || '',
            shift_id:            emp.shift_id || '',
            password:            '',
            is_active:           emp.is_active ? 'true' : 'false',
            // FIX: all lines below were reading from `loadEmployee` (the function) instead of `emp`
            temporary_address:   emp.temporary_address || '',
            permanent_address:   emp.permanent_address || '',
            bank_name:           emp.bank_name || '',
            bank_account_number: emp.bank_account_number || '',
            account_type:        emp.account_type || 'SAVINGS',
            ifsc:                emp.ifsc || '',
            PT:                  emp.PT ?? '',
            basic_salary:        emp.basic_salary ?? '',
            OT:                  emp.OT ?? '',
            PA:                  emp.PA ?? '',
            allowance:           emp.allowance ?? '',
            ESI_no:              emp.ESI_no
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
    return () => { mounted = false; };
  }, [id]);

  // ── load attendance ───────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    async function loadMonthlyAttendance() {
      try {
        setAttendanceLoading(true);
        setAttendanceError(null);
        const { data } = await api.get(`/attendance/employee/${id}/monthly`, {
          params: { month: selectedMonth.getMonth() + 1, year: selectedMonth.getFullYear() },
        });
        if (!mounted) return;
        setAttendanceRecords(data.records || []);
      } catch (err) {
        console.error('Failed to load attendance snapshots:', err);
        if (!mounted) return;
        setAttendanceError(err.response?.data?.error || 'Unable to load attendance snapshots.');
      } finally {
        if (!mounted) return;
        setAttendanceLoading(false);
      }
    }
    if (id) loadMonthlyAttendance();
    else { setAttendanceRecords([]); setAttendanceLoading(false); }
    return () => { mounted = false; };
  }, [id, selectedMonth]);

  // ── load efficiency (work centers + worker_efficiency_entries) ─────────────

  useEffect(() => {
    let mounted = true;
    async function loadEfficiency() {
      try {
        setEfficiencyLoading(true);
        setEfficiencyError(null);
        const { data } = await api.get(`/employees/${id}/efficiency`);
        if (!mounted) return;
        setEfficiencyData(data || null);
      } catch (err) {
        console.error('Failed to load employee efficiency:', err);
        if (!mounted) return;
        setEfficiencyError(err.response?.data?.error || 'Unable to load efficiency.');
        setEfficiencyData(null);
      } finally {
        if (!mounted) return;
        setEfficiencyLoading(false);
      }
    }
    if (id && tab === 'efficiency') loadEfficiency();
    return () => { mounted = false; };
  }, [id, tab]);

  // ── derived values ────────────────────────────────────────────────────────

  const employeeJoinDate = employee?.created_at ? new Date(employee.created_at) : null;
  const daysInRange = useMemo(
    () => getDaysInMonthRange(selectedMonth, new Date(), employeeJoinDate),
    [selectedMonth, employeeJoinDate]
  );
  const attendanceSummary = useMemo(
    () => summarizeMonth(attendanceRecords, daysInRange),
    [attendanceRecords, daysInRange]
  );
  const employeeJoinMonth = employeeJoinDate ? startOfMonth(employeeJoinDate) : null;
  const isPrevMonthDisabled = employeeJoinMonth ? selectedMonth <= employeeJoinMonth : false;
  const isNextMonthDisabled = isSameMonth(selectedMonth, new Date());

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const setFieldValue = (name) => (value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const departmentOptions = departments.map((dept) => ({
    value: dept.id,
    label: dept.name,
  }));

  const shiftOptions = shifts.map((shift) => ({
    value: shift.id,
    label: shift.name,
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = new FormData();
      payload.append('employee_code',       formData.employee_code.trim());
      payload.append('full_name',           formData.full_name.trim());
      payload.append('job_description',     formData.job_description);
      payload.append('department_id',       formData.department_id || '');
      payload.append('shift_id',            formData.shift_id || '');
      payload.append('password',            formData.password || '');
      payload.append('is_active',           formData.is_active);
      payload.append('temporary_address',   formData.temporary_address || '');
      payload.append('permanent_address',   formData.permanent_address || '');
      payload.append('bank_name',           formData.bank_name || '');
      payload.append('bank_account_number', formData.bank_account_number || '');
      payload.append('account_type',        formData.account_type || '');
      payload.append('ifsc',                formData.ifsc || '');
      payload.append('PT',                  formData.PT || '');
      payload.append('basic_salary',        formData.basic_salary || '');
      payload.append('OT',                  formData.OT || '');
      payload.append('PA',                  formData.PA || '');
      payload.append('allowance',           formData.allowance || '');
      payload.append('ESI_no',              formData.ESI_no || '')
      if (photo)              payload.append('photo',            photo);
      if (aadharFile)         payload.append('aadhar',           aadharFile);
      if (marksCardFile)      payload.append('marks_card',       marksCardFile);
      if (workExperienceFile) payload.append('work_experience',  workExperienceFile);
      if (thumbFile)          payload.append('thumb_impression', thumbFile);

      await api.put(`/employees/${id}`, payload);
      const { data } = await api.get(`/employees/${id}`);
      setEmployee(data.employee || null);
      setTab('details');
      setPhoto(null);
      setAadharFile(null);
      setMarksCardFile(null);
      setWorkExperienceFile(null);
      setThumbFile(null);
      setFormData((prev) => ({ ...prev, password: '' }));
    } catch (err) {
      console.error('Failed to update employee:', err);
      setError(err.response?.data?.error || 'Unable to update employee. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async () => {
    if (!employee || statusToggling) return;
    const nextActive = !employee.is_active;
    if (!nextActive) {
      const ok = await appConfirm({
        title: 'Mark employee inactive?',
        message: `${employee.full_name} will be treated as inactive (e.g. resigned). They can still log in, but will not appear in attendance or total workforce until reactivated.`,
        confirmLabel: 'Mark inactive',
      });
      if (!ok) return;
    }

    setStatusToggling(true);
    setError(null);
    try {
      const payload = new FormData();
      payload.append('is_active', nextActive ? 'true' : 'false');
      await api.put(`/employees/${id}`, payload);
      const { data } = await api.get(`/employees/${id}`);
      const emp = data.employee || null;
      setEmployee(emp);
      if (emp) {
        setFormData((prev) => ({ ...prev, is_active: emp.is_active ? 'true' : 'false' }));
      }
      await appAlert({
        title: nextActive ? 'Employee activated' : 'Employee deactivated',
        message: nextActive
          ? `${employee.full_name} is active again.`
          : `${employee.full_name} is now inactive.`,
        tone: 'success',
      });
    } catch (err) {
      console.error('Failed to toggle employee status:', err);
      setError(err.response?.data?.error || 'Unable to update employee status.');
    } finally {
      setStatusToggling(false);
    }
  };

  const getStatusChipClass = (status) => {
    switch (String(status || '').toUpperCase()) {
      case 'ABSENT':   return 'absent';
      case 'LATE':     return 'late';
      case 'PRESENT':  return 'present';
      case 'HALF_DAY': return 'half_day';
      case 'COMPLETED':return 'completed';
      case 'LEAVE':    return 'leave';
      default:         return '';
    }
  };

  const attendanceHeatmap = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay(); // 0 Sun
    const presentSet = new Set();
    const leaveSet = new Set(attendanceSummary.leaveDates || []);
    const absentSet = new Set(attendanceSummary.absentDates || []);

    for (const row of attendanceRecords || []) {
      const status = String(row.status || '').toUpperCase();
      const date = toISODateString(row.shift_date);
      if (['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY'].includes(status)) {
        presentSet.add(date);
      }
    }

    const cells = [];
    for (let i = 0; i < firstDow; i += 1) {
      cells.push({ key: `pad-${i}`, empty: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const ymd = toISODateString(new Date(year, month, day));
      let tone = 'muted';
      if (presentSet.has(ymd)) tone = 'present';
      else if (leaveSet.has(ymd)) tone = 'leave';
      else if (absentSet.has(ymd)) tone = 'absent';
      cells.push({ key: ymd, day, tone, ymd });
    }
    return cells;
  }, [selectedMonth, attendanceRecords, attendanceSummary.leaveDates, attendanceSummary.absentDates]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <p onClick={()=> navigate('/employees')} style={{cursor: 'pointer'}}><ArrowLeft size={16} style={{marginRight: 4, display: 'inline'}}/>Back to Employees</p>
        <div className="employee-title-block">
          <div style={{ gridColumn: 'span 2' }}>
            <img
              src={employee?.img_url || PLACEHOLDER_AVATAR}
              alt={employee?.img_url ? `${employee.full_name} photo` : 'No photo available'}
              style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb', cursor: 'pointer' }}
              onClick={() => employee.img_url && setLightBox({ src: employee.img_url, alt: employee.full_name })}
            />
            {lightBox && (
              <ImageLightbox src={lightBox.src} alt={lightBox.alt} onClose={() => setLightBox(null)} />
            )}
          </div>
          <div className="">
            <h1>{employee?.full_name}</h1>
            <div className="" style={{display: 'flex', gap: '25px', alignItems: 'center', flexWrap: 'wrap'}}>
              <p className='muted'>{employee?.job_description}</p>
              <p className='muted'>ID: {employee?.employee_code}</p>
              {employee ? (
                <StatusBadge status={employee.is_active ? 'active' : 'inactive'}>
                  {employee.is_active ? 'Active' : 'Inactive'}
                </StatusBadge>
              ) : null}
            </div>
          </div>
          <div className="employee-top-bar">
            {employee ? (
              <label className="emp-active-toggle" title={employee.is_active ? 'Mark inactive (resigned)' : 'Mark active'}>
                <span className="emp-active-toggle-label">
                  {employee.is_active ? 'Active' : 'Inactive'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!employee.is_active}
                  className={`emp-switch${employee.is_active ? ' is-on' : ''}`}
                  disabled={statusToggling || submitting}
                  onClick={handleToggleActive}
                >
                  <span className="emp-switch-thumb" />
                </button>
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => setTab('edit')}
              className="neutral-button"
              aria-selected={tab === 'edit'}
              role="tab"
            >
              <Pencil size={16} style={{ display: 'inline', marginRight: 4 }} />
              Edit
            </button>
          </div>
        </div>
        <div className="pill-tabs" >
          <button
            type="button"
            className={`pill-tab ${tab === 'details' ? 'pill-tab-active' : ''}`}
            onClick={() => {setTab('details')}}
            aria-selected = {tab === 'details'}
            role = 'tab'
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setTab('attendance')}
            className={`pill-tab ${tab === 'attendance' ? 'pill-tab-active' : ''}`}
            aria-selected = {tab === 'attendance'}
            role = 'tab'
          >
            Attendance
          </button>
          <button
            type="button"
            onClick={() => setTab('documents')}
            className={`pill-tab ${tab === 'documents' ? 'pill-tab-active' : ''}`}
            aria-selected = {tab === 'documents'}
            role = 'tab'
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setTab('address')}
            className={`pill-tab ${tab === 'address' ? 'pill-tab-active' : ''}`}
            aria-selected = {tab === 'address'}
            role = 'tab'
          >
            Address
          </button>
          <button
            type="button"
            onClick={() => setTab('commercials')}
            className={`pill-tab ${tab === 'commercials' ? 'pill-tab-active' : ''}`}
            aria-selected = {tab === 'commercials'}
            role = 'tab'
          >
            Commercials
          </button>
          <button
            type="button"
            onClick={() => setTab('efficiency')}
            className={`pill-tab ${tab === 'efficiency' ? 'pill-tab-active' : ''}`}
            aria-selected={tab === 'efficiency'}
            role="tab"
          >
            Efficiency
          </button>
        </div>
      </header>

      <section className="card employee-main">

        {/* Tab row */}
  

        {/* Loading / error guards */}
        {loading ? (
          <p className="muted">Loading employee details...</p>
        ) : error && tab !== 'edit' ? (
          <p className="error-message">{error}</p>
        ) : !employee ? (
          <p className="muted">Employee not found.</p>
        ) : (
          <>
            {/* ── DETAILS tab ───────────────────────────────────────────── */}
            {tab === 'details' && (
              <>
                <div className="employee-detail-card">
                  <h2>Employee Details</h2>
                  <div className="employee-detail-grid">
                    <div><p className="employee-detail-label">Full Name</p><p className="employee-detail-value">{employee.full_name}</p></div>
                    <div><p className="employee-detail-label">Employee Code</p><p className="employee-detail-value">{employee.employee_code}</p></div>
                    <div><p className="employee-detail-label">Job Description</p><p className="employee-detail-value">{employee.job_description || '--'}</p></div>
                    <div><p className="employee-detail-label">Status</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                        <StatusBadge status={employee.is_active ? 'active' : 'inactive'}>
                          {employee.is_active ? 'Active' : 'Inactive'}
                        </StatusBadge>
                        <button
                          type="button"
                          className="neutral-button"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          disabled={statusToggling || submitting}
                          onClick={handleToggleActive}
                        >
                          {statusToggling
                            ? 'Updating…'
                            : employee.is_active
                              ? 'Mark inactive'
                              : 'Mark active'}
                        </button>
                      </div>
          
                    </div>
                    <div><p className="employee-detail-label">Department</p><p className="employee-detail-value">{employee.department || 'Not assigned'}</p></div>
                    <div><p className="employee-detail-label">Shift</p><p className="employee-detail-value">{employee.shift || 'Not assigned'}</p></div>
                    <div><p className="employee-detail-label">ESI Number</p><p className="employee-detail-value">{employee.ESI_no || 'Not assigned'}</p></div>
                    {employee.created_at && (
                      <div>
                        <p className="employee-detail-label">Created At</p>
                        <p className="employee-detail-value">{formatDisplayDateTime(employee.created_at)}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* {Attendance Tab} */}
            {tab === 'attendance' && (
              <>
                {/* Attendance section — untouched */}
                <section className="employee-details-attendance">
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <h2>Attendance &amp; report</h2>
                    <p className="text-sm" style={{ margin: '2px 0 0', color: '#6b7280' }}>
                      {attendanceLoading
                        ? 'Loading...'
                        : `${attendanceSummary.totalWorkingDays} days ${isNextMonthDisabled ? 'so far this month' : 'this month'} (including Sundays)`}
                    </p>
                  </div>

                  <div className='' style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button type="button" className="date-pickers" onClick={() => setSelectedMonth((prev) => shiftMonth(prev, -1))} disabled={isPrevMonthDisabled} aria-label="Previous month"><ChevronLeft size={16} /></button>
                    <span className="datebar font-semibold" style={{ minWidth: '150px', textAlign: 'center', display: 'inline-block' }}>{formatMonthLabel(selectedMonth)}</span>
                    <button type="button" className="date-pickers" onClick={() => setSelectedMonth((prev) => shiftMonth(prev, 1))} disabled={isNextMonthDisabled} aria-label="Next month"><ChevronRight size={16}/></button>
                  </div>

                  {attendanceLoading ? (
                    <p className="muted">Loading attendance for {formatMonthLabel(selectedMonth)}...</p>
                  ) : attendanceError ? (
                    <p className="error-message">{attendanceError}</p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '28px', borderBottom: '1px solid #e5e7eb', paddingBottom: '24px', marginBottom: '24px' }}>
                        <AttendanceGauge score={attendanceSummary.score} size={220} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', flex: '1 1 320px' }}>
                          <StatTile label="Present" value={attendanceSummary.presentDays} accent="#059669" />
                          <StatTile label="Late" value={attendanceSummary.late} accent="#d97706" />
                          <StatTile label="Half Days" value={attendanceSummary.half_day} accent="#eab308" />
                          <StatTile label="On Leave" value={attendanceSummary.leaveDays || 0} accent="#ea580c" />
                          <StatTile label="Absent" value={attendanceSummary.absent} accent="#dc2626" />
                        </div>
                      </div>

                      <div className="emp-att-heatmap" aria-label="Attendance calendar">
                        <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Month calendar</h3>
                        <div className="emp-att-heatmap-grid">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                            <div key={d} className="emp-att-heatmap-dow">
                              {d}
                            </div>
                          ))}
                          {attendanceHeatmap.map((cell) =>
                            cell.empty ? (
                              <div key={cell.key} className="emp-att-heatmap-cell is-empty" />
                            ) : (
                              <div
                                key={cell.key}
                                className={`emp-att-heatmap-cell is-${cell.tone}`}
                                title={`${cell.ymd} · ${cell.tone}`}
                              >
                                {cell.day}
                              </div>
                            )
                          )}
                        </div>
                        <div className="emp-att-heatmap-legend">
                          <span>
                            <i className="emp-att-heatmap-swatch is-present" style={{ background: '#dcfce7', borderColor: '#86efac' }} />
                            Present
                          </span>
                          <span>
                            <i className="emp-att-heatmap-swatch" style={{ background: '#ffedd5', borderColor: '#fdba74' }} />
                            Leave
                          </span>
                          <span>
                            <i className="emp-att-heatmap-swatch" style={{ background: '#fee2e2', borderColor: '#fca5a5' }} />
                            Absent
                          </span>
                          <span>
                            <i className="emp-att-heatmap-swatch" style={{ background: '#f3f4f6', borderColor: '#e5e7eb' }} />
                            Future / other
                          </span>
                        </div>
                      </div>

                      <section className="mes-card emp-chart-card" style={{ padding: 16, marginBottom: 20 }} aria-label="Minutes worked">
                        <h3 className="mes-section-title" style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>
                          Minutes worked
                        </h3>
                        {attendanceRecords.length === 0 ? (
                          <EmptyState
                            icon={TrendingUp}
                            title="No minutes recorded"
                            description={`No attendance punches for ${formatMonthLabel(selectedMonth)}.`}
                          />
                        ) : (
                          <EmployeeMinutesBarChart records={attendanceRecords} monthDate={selectedMonth} />
                        )}
                      </section>

                      {attendanceRecords.length === 0 ? (
                        <p className="muted">No attendance records found for {formatMonthLabel(selectedMonth)}.</p>
                      ) : (
                        <div className="attendance-table-wrap">
                          <table className="app-table">
                            <thead>
                              <tr><th>Date</th><th>Shift</th><th>In</th><th>Out</th><th>Status</th><th>Minutes</th><th>OT</th></tr>
                            </thead>
                            <tbody>
                              {attendanceRecords.map((row) => (
                                <tr key={`${row.shift_date}-${row.punched_in_at || ''}-${row.punched_out_at || ''}`}>
                                  <td>{formatDisplayDate(row.shift_date)}</td>
                                  <td>{row.shift || '--'}</td>
                                  <td>{toDisplayTime(row.punched_in_at)}</td>
                                  <td>{toDisplayTime(row.punched_out_at)}</td>
                                  <td><span className={`status-chip ${getStatusChipClass(row.status)}`}>{row.status || '--'}</span></td>
                                  <td>{row.minutes_worked ?? '--'}</td>
                                  <td>{row.overtime_minutes ?? '--'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div style={{ marginTop: '24px' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>On leave</h3>
                        {(attendanceSummary.leaveDates || []).length === 0 ? (
                          <p className="muted" style={{ margin: 0 }}>No approved leave this month.</p>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {attendanceSummary.leaveDates.map((date) => (
                              <li
                                key={`leave-${date}`}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: '8px',
                                  background: '#ffedd5',
                                  color: '#c2410c',
                                  fontSize: '0.875rem',
                                  border: '1px solid #fdba74',
                                }}
                              >
                                {new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}, {formatDisplayDate(date)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div style={{ marginTop: '24px' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Absent days</h3>
                        {attendanceSummary.absentDates.length === 0 ? (
                          <p className="muted" style={{ margin: 0 }}>No absences this month.</p>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {attendanceSummary.absentDates.map((date) => (
                              <li
                                key={date}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: '8px',
                                  background: '#fef2f2',
                                  color: '#b91c1c',
                                  fontSize: '0.875rem',
                                  border: '1px solid #fecaca',
                                }}
                              >
                                {new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}, {formatDisplayDate(date)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </section> 
              </>
            )}

            {/* ── DOCUMENTS tab ─────────────────────────────────────────── */}
            {tab === 'documents' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  {[
                    { label: 'Aadhar card',      urlKey: 'aadhar_url' },
                    { label: 'Marks card',        urlKey: 'marks_card_url' },
                    { label: 'Work experience',   urlKey: 'work_experience_url' },
                    { label: 'Thumb impression',  urlKey: 'thumb_impression_url' },
                  ].map(({ label, urlKey }) => (
                    <div key={urlKey} style={{  borderRadius: '6px', padding: '16px' }}>
                      <p className="employee-detail-label" style={{ marginBottom: '10px' }}>{label}</p>
                      <DocPreview
                        url={employee[urlKey]}
                        label={label}
                        onImageClick={(src, alt) => setLightBox({ src, alt })}
                      />
                    </div>
                  ))}
                </div>
                {lightBox && (
                  <ImageLightbox src={lightBox.src} alt={lightBox.alt} onClose={() => setLightBox(null)} />
                )}
              </>
            )}

            {/* ── ADDRESS tab ───────────────────────────────────────────── */}
            {tab === 'address' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {[
                  { label: 'Temporary address', key: 'temporary_address' },
                  { label: 'Permanent address', key: 'permanent_address' },
                ].map(({ label, key }) => (
                  <div key={key} style={{ borderRadius: '12px', padding: '16px' }}>
                    <p className="employee-detail-label" style={{ marginBottom: '8px' }}>{label}</p>
                    <p className="employee-detail-value" style={{ whiteSpace: 'pre-line' }}>{employee[key] || '--'}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── COMMERCIALS tab ───────────────────────────────────────── */}
            {tab === 'commercials' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className='employee-detail-card' style={{borderRadius: '12px', padding: '16px' }}>
                  <h2  style={{ marginBottom: '16px' }}>Bank details</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {[
                      { label: 'Bank name',       key: 'bank_name' },
                      { label: 'Account type',    key: 'account_type' },
                      { label: 'Account number',  key: 'bank_account_number' },
                      { label: 'IFSC code',       key: 'ifsc' },
                    ].map(({ label, key }) => (
                      <div key={key}>
                        <p className="employee-detail-label">{label}</p>
                        <p className="employee-detail-value">{employee[key] || '--'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ borderRadius: '12px', padding: '16px' }}>
                  {/* <p className="text-xl font-medium" style={{ marginBottom: '16px' }}>Compensation</p> */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    {[
                      { label: 'Basic salary (₹/mo)', key: 'basic_salary', accent: '#059669' },
                      { label: 'Allowance (₹/mo)',    key: 'allowance',    accent: '#6b7280' },
                      { label: 'PA (₹/mo)',           key: 'PA',           accent: '#6b7280' },
                      { label: 'OT rate (₹/hr)',      key: 'OT',           accent: '#d97706' },
                      { label: 'PT (₹/mo)',           key: 'PT',           accent: '#6b7280' },
                    ].map(({ label, key, accent }) => (
                      <StatTile
                        key={key}
                        label={label}
                        accent={accent}
                        value={employee[key] != null ? `₹${Number(employee[key]).toLocaleString('en-IN')}` : '--'}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── EFFICIENCY tab ────────────────────────────────────────── */}
            {tab === 'efficiency' && (
              <div className="emp-efficiency" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {efficiencyLoading ? (
                  <p className="muted">Loading efficiency…</p>
                ) : efficiencyError ? (
                  <p className="error-message">{efficiencyError}</p>
                ) : (
                  <>
                    <div className="mes-metric-grid" style={{ marginBottom: 0 }}>
                      <MetricCard
                        label="Average"
                        value={
                          efficiencyData?.summary?.average_pct != null
                            ? `${efficiencyData.summary.average_pct}%`
                            : '—'
                        }
                        hint="Across recorded entries"
                        icon={TrendingUp}
                        tone={
                          efficiencyData?.summary?.average_pct == null
                            ? 'neutral'
                            : efficiencyData.summary.average_pct >= 80
                              ? 'success'
                              : efficiencyData.summary.average_pct < 50
                                ? 'danger'
                                : 'amber'
                        }
                      />
                      <MetricCard
                        label="Latest"
                        value={
                          efficiencyData?.summary?.latest_pct != null
                            ? `${efficiencyData.summary.latest_pct}%`
                            : '—'
                        }
                        hint={
                          efficiencyData?.summary?.latest_date
                            ? formatDisplayDate(efficiencyData.summary.latest_date)
                            : 'No entries yet'
                        }
                        icon={TrendingUp}
                      />
                      <MetricCard
                        label="Entries"
                        value={String(efficiencyData?.summary?.entry_count ?? 0)}
                        hint="Last 120 records"
                      />
                      <MetricCard
                        label="Work centers"
                        value={String(efficiencyData?.summary?.work_center_count ?? 0)}
                        hint="Assigned + managed"
                        icon={Factory}
                      />
                    </div>

                    <section className="mes-card emp-chart-card" style={{ padding: 16 }} aria-label="Efficiency trend">
                      <h3 className="mes-section-title" style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>
                        Efficiency trend
                      </h3>
                      {!efficiencyData?.entries?.length ? (
                        <EmptyState
                          icon={TrendingUp}
                          title="No efficiency recorded"
                          description="Entries appear here after the work-center manager saves team efficiency on My Today."
                        />
                      ) : (
                        <EmployeeEfficiencyLineChart entries={efficiencyData.entries} />
                      )}
                    </section>

                    <section className="mes-card" style={{ padding: 16 }} aria-label="Work centers">
                      <h3 className="mes-section-title" style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>
                        Work centers
                      </h3>
                      {!efficiencyData?.work_centers?.length ? (
                        <EmptyState
                          icon={Factory}
                          title="No work center assigned"
                          description="This employee is not linked to a work center yet."
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[...(efficiencyData.work_centers || [])]
                            .sort((a, b) => {
                              if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
                              if (a.is_manager !== b.is_manager) return a.is_manager ? -1 : 1;
                              return String(a.name || '').localeCompare(String(b.name || ''));
                            })
                            .map((wc) => (
                              <div key={wc.id} className="mes-list-item" style={{ cursor: 'default' }}>
                                <div className="mes-list-item-top">
                                  <p className="mes-list-item-title">
                                    <TruncatedText>{wc.name || 'Work center'}</TruncatedText>
                                  </p>
                                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    {wc.is_primary ? <StatusBadge status="active">Primary</StatusBadge> : null}
                                    {wc.is_manager ? <StatusBadge status="assigned">Manager</StatusBadge> : null}
                                    {!wc.is_primary && !wc.is_manager ? (
                                      <StatusBadge status="assigned">Member</StatusBadge>
                                    ) : null}
                                  </div>
                                </div>
                                <p className="mes-list-item-meta" style={{ marginBottom: 0 }}>
                                  {wc.code || '—'}
                                </p>
                              </div>
                            ))}
                        </div>
                      )}
                    </section>

                    <section className="mes-card" style={{ padding: 16 }} aria-label="Efficiency history">
                      <h3 className="mes-section-title" style={{ marginTop: 0, marginBottom: 12, fontSize: 15 }}>
                        Efficiency history
                      </h3>
                      {!efficiencyData?.entries?.length ? (
                        <EmptyState
                          icon={TrendingUp}
                          title="No efficiency recorded"
                          description="Entries appear here after the work-center manager saves team efficiency on My Today."
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {efficiencyData.entries.map((row) => (
                            <div key={row.id} className="mes-list-item" style={{ cursor: 'default' }}>
                              <div className="mes-list-item-top">
                                <span className="mes-list-item-title" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {formatDisplayDate(row.work_date)}
                                </span>
                                <StatusBadge status={efficiencyTone(row.efficiency_pct)}>
                                  {row.efficiency_pct != null ? `${row.efficiency_pct}%` : '—'}
                                </StatusBadge>
                              </div>
                              <p className="mes-list-item-sub" style={{ marginBottom: 0 }}>
                                <TruncatedText>
                                  {[row.work_center_name, row.work_center_code]
                                    .filter(Boolean)
                                    .join(' · ') || 'Work center'}
                                </TruncatedText>
                              </p>
                              {row.notes ? (
                                <p className="mes-list-item-meta" style={{ marginTop: 6, marginBottom: 0 }}>
                                  <TruncatedText>{row.notes}</TruncatedText>
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {/* ── EDIT tab ──────────────────────────────────────────────── */}
            {tab === 'edit' && (
              <form onSubmit={handleSubmit}>
                {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

                <div className="form-page-grid">
                  <div className="form-span-2" style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
                    {employee.img_url ? (
                      <img src={employee.img_url} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                    ) : null}
                    <label htmlFor="photo" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
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

                  <label htmlFor="employee_code">
                    Employee code <span className="required-mark">*</span>
                    <input id="employee_code" type="text" name="employee_code" value={formData.employee_code} onChange={handleChange} required disabled={submitting} />
                  </label>
                  <label htmlFor="full_name">
                    Full name <span className="required-mark">*</span>
                    <input id="full_name" type="text" name="full_name" value={formData.full_name} onChange={handleChange} required disabled={submitting} />
                  </label>
                  <label htmlFor="job_description">
                    Job description <span className="required-mark">*</span>
                    <FormSearchSelect
                      value={formData.job_description}
                      onChange={setFieldValue('job_description')}
                      options={JOB_DESCRIPTION_OPTIONS}
                      placeholder="Select a role"
                      disabled={submitting}
                    />
                  </label>
                  <label htmlFor="is_active">
                    Status
                    <FormSearchSelect
                      value={formData.is_active}
                      onChange={setFieldValue('is_active')}
                      options={STATUS_OPTIONS}
                      placeholder="Select status"
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
                      disabled={submitting}
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
                      disabled={submitting}
                      searchable={shiftOptions.length > 6}
                    />
                  </label>
                  <label htmlFor="password" className="form-span-2">
                    Password
                    <input id="password" type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Leave blank to keep current password" disabled={submitting} />
                  </label>

                  <p className="form-page-section-title form-span-2">Documents</p>
                  {[
                    { label: 'Aadhar card', urlKey: 'aadhar_url', setter: setAadharFile, file: aadharFile },
                    { label: 'Marks card', urlKey: 'marks_card_url', setter: setMarksCardFile, file: marksCardFile },
                    { label: 'Work experience', urlKey: 'work_experience_url', setter: setWorkExperienceFile, file: workExperienceFile },
                    { label: 'Thumb impression', urlKey: 'thumb_impression_url', setter: setThumbFile, file: thumbFile },
                  ].map(({ label, urlKey, setter, file }) => (
                    <label key={urlKey}>
                      {label}
                      {employee[urlKey] ? (
                        <div style={{ marginBottom: 8 }}>
                          <DocPreview url={employee[urlKey]} label={label} onImageClick={(src, alt) => setLightBox({ src, alt })} />
                        </div>
                      ) : null}
                      <FilePicker
                        accept="image/*,application/pdf"
                        disabled={submitting}
                        fileName={file?.name}
                        label={file ? 'Replace file' : 'Choose file'}
                        onChange={setter}
                      />
                    </label>
                  ))}
                  {lightBox && <ImageLightbox src={lightBox.src} alt={lightBox.alt} onClose={() => setLightBox(null)} />}

                  <p className="form-page-section-title form-span-2">Address</p>
                  <label htmlFor="temporary_address">
                    Temporary address
                    <textarea id="temporary_address" name="temporary_address" value={formData.temporary_address} onChange={handleChange} disabled={submitting} rows={3} />
                  </label>
                  <label htmlFor="permanent_address">
                    Permanent address
                    <textarea id="permanent_address" name="permanent_address" value={formData.permanent_address} onChange={handleChange} disabled={submitting} rows={3} />
                  </label>

                  <p className="form-page-section-title form-span-2">Bank details</p>
                  <label htmlFor="bank_name">
                    Bank name
                    <input id="bank_name" type="text" name="bank_name" value={formData.bank_name} onChange={handleChange} disabled={submitting} />
                  </label>
                  <label htmlFor="bank_account_number">
                    Account number
                    <input id="bank_account_number" type="text" name="bank_account_number" value={formData.bank_account_number} onChange={handleChange} disabled={submitting} />
                  </label>
                  <label htmlFor="account_type">
                    Account type
                    <FormSearchSelect
                      value={formData.account_type}
                      onChange={setFieldValue('account_type')}
                      options={ACCOUNT_TYPE_OPTIONS}
                      placeholder="Select account type"
                      disabled={submitting}
                      clearable={false}
                    />
                  </label>
                  <label htmlFor="ifsc">
                    IFSC code
                    <input id="ifsc" type="text" name="ifsc" value={formData.ifsc} onChange={handleChange} disabled={submitting} />
                  </label>
                  <label htmlFor="esi_no">
                    ESI number
                    <input id="esi_no" type="text" name="ESI_no" value={formData.ESI_no} onChange={handleChange} disabled={submitting} />
                  </label>

                  <p className="form-page-section-title form-span-2">Compensation</p>
                  <label htmlFor="basic_salary">Basic salary (₹/mo)<input id="basic_salary" type="number" name="basic_salary" value={formData.basic_salary} onChange={handleChange} disabled={submitting} /></label>
                  <label htmlFor="allowance">Allowance (₹/mo)<input id="allowance" type="number" name="allowance" value={formData.allowance} onChange={handleChange} disabled={submitting} /></label>
                  <label htmlFor="PA">PA — personal allowance (₹/mo)<input id="PA" type="number" name="PA" value={formData.PA} onChange={handleChange} disabled={submitting} /></label>
                  <label htmlFor="OT">OT rate (₹/hr)<input id="OT" type="number" name="OT" value={formData.OT} onChange={handleChange} disabled={submitting} /></label>
                  <label htmlFor="PT">PT — professional tax (₹/mo)<input id="PT" type="number" name="PT" value={formData.PT} onChange={handleChange} disabled={submitting} /></label>
                </div>

                <FormActions
                  saving={submitting}
                  onCancel={() => navigate(`/employees/${id}`)}
                  saveLabel={submitting ? 'Saving…' : 'Save changes'}
                />
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}