import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../api/client';
import { toDisplayTime, toISODateString } from '../attendance/useDailyAttendance';
import ImageLightbox from '../components/shared/ImageLightBox';
import AttendanceGauge from '../components/shared/Attendancegauge';
import StatTile from '../components/shared/StatTile'
import {ArrowLeft, ChevronLeft, ChevronRight, Pencil} from "lucide-react"


const PLACEHOLDER_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%23E5E7EB" width="100%25" height="100%25"/><text x="50%25" y="54%25" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23717A83" font-family="system-ui, sans-serif">?</text></svg>';

// ─── pure helpers (unchanged) ─────────────────────────────────────────────────

function countWorkingDaysInMonth(monthDate, cutoffDate = null, startDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let firstDayToCount = 0;
  if (startDate && startDate.getFullYear() === year && startDate.getMonth() === month) {
    firstDayToCount = startDate.getDate() + 1;
  }

  let lastDayToCount = daysInMonth;
  if (cutoffDate && cutoffDate.getFullYear() === year && cutoffDate.getMonth() === month) {
    lastDayToCount = Math.min(daysInMonth, cutoffDate.getDate());
  }

  let count = 0;
  for (let day = firstDayToCount; day <= lastDayToCount; day += 1) {
    if (new Date(year, month, day).getDay() !== 0) count += 1;
  }
  return count;
}

function summarizeMonth(record, totalWorkingDays) {
  const summary = { present: 0, completed: 0, late: 0, half_day: 0 };
  record.forEach((row) => {
    const status = String(row.status || '').toUpperCase();
    if (status === 'PRESENT') summary.present += 1;
    else if (status === 'COMPLETED') summary.completed += 1;
    else if (status === 'LATE') summary.late += 1;
    else if (status === 'HALF_DAY') summary.half_day += 1;
  });
  const attendedDays = summary.present + summary.completed + summary.late + summary.half_day;
  const absent = Math.max(totalWorkingDays - attendedDays, 0);
  const score = totalWorkingDays > 0 ? Math.min(100, Math.round((attendedDays / totalWorkingDays) * 100)) : 0;
  return { ...summary, attendedDays, absent, totalWorkingDays, score };
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
  const [tab, setTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [lightBox, setLightBox] = useState(null);

  // ── URL → tab sync (kept as-is for details/edit routing) ─────────────────

  useEffect(() => {
    if (location.pathname.endsWith('/edit')) {
      setTab('edit');
    } else if (!['details', 'attendance', 'documents', 'address', 'commercials', 'edit'].includes(tab)) {
      // only reset to details if we're not on one of the local tabs
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

  // ── derived values ────────────────────────────────────────────────────────

  const employeeJoinDate = employee?.created_at ? new Date(employee.created_at) : null;
  const totalWorkingDays = useMemo(
    () => countWorkingDaysInMonth(selectedMonth, new Date(), employeeJoinDate),
    [selectedMonth, employeeJoinDate]
  );
  const attendanceSummary = useMemo(
    () => summarizeMonth(attendanceRecords, totalWorkingDays),
    [attendanceRecords, totalWorkingDays]
  );
  const employeeJoinMonth = employeeJoinDate ? startOfMonth(employeeJoinDate) : null;
  const isPrevMonthDisabled = employeeJoinMonth ? selectedMonth <= employeeJoinMonth : false;
  const isNextMonthDisabled = isSameMonth(selectedMonth, new Date());

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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

  const getStatusChipClass = (status) => {
    switch (String(status || '').toUpperCase()) {
      case 'ABSENT':   return 'absent';
      case 'LATE':     return 'late';
      case 'PRESENT':  return 'present';
      case 'HALF_DAY': return 'half_day';
      case 'COMPLETED':return 'completed';
      default:         return '';
    }
  };

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
            <div className="" style={{display: 'flex', gap: '25px'}}>
              <p className='muted'>{employee?.job_description}</p>
              <p className='muted'>ID: {employee?.employee_code}</p>
            </div>
          </div>
          <div className="employee-top-bar">
            <button
            type="button"
            onClick={() => setTab('edit')}
            className="neutral-button"
            aria-selected = {tab === 'edit'}
            role = 'tab'
          >
            <Pencil size={16} style={{display: 'inline', marginRight: 4}}/>Edit
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
          
          {/* <button
            type="button"
            onClick={() => navigate(`/employees/${id}/edit`)}
            className={`pill-tab ${tab === 'documents' ? 'pill-tab-active' : ''}`}
            aria-selected = {tab === 'documents'}
            role = 'tab'
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
          </button> */}
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
                    <div><p className="employee-detail-label">Status</p><p className="employee-detail-value">{employee.status}</p></div>
                    <div><p className="employee-detail-label">Department</p><p className="employee-detail-value">{employee.department || 'Not assigned'}</p></div>
                    <div><p className="employee-detail-label">Shift</p><p className="employee-detail-value">{employee.shift || 'Not assigned'}</p></div>
                    <div><p className="employee-detail-label">ESI Number</p><p className="employee-detail-value">{employee.ESI_no || 'Not assigned'}</p></div>
                    {employee.created_at && (
                      <div>
                        <p className="employee-detail-label">Created At</p>
                        <p className="employee-detail-value">{new Date(employee.created_at).toLocaleString()}</p>
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
                        : `${attendanceSummary.totalWorkingDays} working days ${isNextMonthDisabled ? 'so far this month' : 'this month'} (Mon–Sat)`}
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
                          <StatTile label="Present" value={attendanceSummary.present + attendanceSummary.completed} accent="#059669" />
                          <StatTile label="Late" value={attendanceSummary.late} accent="#d97706" />
                          <StatTile label="Half Days" value={attendanceSummary.half_day} accent="#eab308" />
                          <StatTile label="Absent" value={attendanceSummary.absent} accent="#dc2626" />
                        </div>
                      </div>

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
                                  <td>{toISODateString(row.shift_date)}</td>
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

            {/* ── EDIT tab ──────────────────────────────────────────────── */}
            {tab === 'edit' && (
              <form onSubmit={handleSubmit}>
                {error && <p className="error-message">{error}</p>}

                {/* Photo */}
                <div className="flex flex-col md:flex-row gap-8 items-start">
                  {employee.img_url && (
                    <div style={{ marginBottom: '16px' }}>
                      <p className="text-xl font-medium mb-3">Current photo</p>
                      <img src={employee.img_url} alt={`${employee.full_name} current photo`} style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db' }} />
                    </div>
                  )}
                  <label htmlFor="photo">
                    <p className="text-xl font-medium mb-3">Photo</p>
                    <input id="photo" type="file" accept="image/*" name="photo" onChange={handleFileChange} disabled={submitting} />
                  </label>
                </div>

                {/* Core fields */}
                <label htmlFor="employee_code">
                  <div className="flex item-center gap-1"><span>Employee Code</span><span style={{ color: '#b91c1c' }}>*</span></div>
                  <input id="employee_code" type="text" name="employee_code" value={formData.employee_code} onChange={handleChange} required disabled={submitting} />
                </label>

                <label htmlFor="full_name">
                  <div className="flex item-center gap-1"><span>Full Name</span><span style={{ color: '#b91c1c' }}>*</span></div>
                  <input id="full_name" type="text" name="full_name" value={formData.full_name} onChange={handleChange} required disabled={submitting} />
                </label>

                {/* FIX: was name="role" reading value={formData.job_description} — now correctly bound */}
                <label htmlFor="job_description">
                  <div className="flex item-center gap-1"><span>Job Description</span><span style={{ color: '#b91c1c' }}>*</span></div>
                  <select id="job_description" name="job_description" value={formData.job_description} onChange={handleChange} required disabled={submitting}>
                    <option value="">Select a role</option>
                    <option value="OPERATOR">Operator</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="MANAGER">Manager</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </label>

                <label htmlFor="is_active">
                  Status
                  <select id="is_active" name="is_active" value={formData.is_active} onChange={handleChange} disabled={submitting}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>

                <label htmlFor="department_id">
                  Department
                  <select id="department_id" name="department_id" value={formData.department_id} onChange={handleChange} disabled={submitting}>
                    <option value="">Select a department</option>
                    {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
                  </select>
                </label>

                <label htmlFor="shift_id">
                  Shift
                  <select id="shift_id" name="shift_id" value={formData.shift_id} onChange={handleChange} disabled={submitting}>
                    <option value="">Select a shift</option>
                    {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
                  </select>
                </label>

                <label htmlFor="password">
                  Password
                  <input id="password" type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Leave blank to keep current password" disabled={submitting} />
                </label>

                {/* Documents */}
                <p className="text-xl font-medium" style={{ margin: '24px 0 8px' }}>Documents</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {[
                    { label: 'Aadhar card',     urlKey: 'aadhar_url',         setter: setAadharFile },
                    { label: 'Marks card',       urlKey: 'marks_card_url',     setter: setMarksCardFile },
                    { label: 'Work experience',  urlKey: 'work_experience_url',setter: setWorkExperienceFile },
                    { label: 'Thumb impression', urlKey: 'thumb_impression_url',setter: setThumbFile },
                  ].map(({ label, urlKey, setter }) => (
                    <div key={urlKey} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px' }}>
                      <p className="text-xl font-medium" style={{ marginBottom: '8px' }}>{label}</p>
                      {employee[urlKey] && (
                        <div style={{ marginBottom: '8px' }}>
                          <DocPreview url={employee[urlKey]} label={label} onImageClick={(src, alt) => setLightBox({ src, alt })} />
                        </div>
                      )}
                      <input type="file" accept="image/*,application/pdf" onChange={(e) => setter(e.target.files[0] || null)} disabled={submitting} />
                    </div>
                  ))}
                </div>
                {lightBox && <ImageLightbox src={lightBox.src} alt={lightBox.alt} onClose={() => setLightBox(null)} />}

                {/* Address */}
                <p className="text-xl font-medium" style={{ margin: '24px 0 8px' }}>Address</p>
                <label htmlFor="temporary_address">
                  Temporary address
                  <textarea id="temporary_address" name="temporary_address" value={formData.temporary_address} onChange={handleChange} disabled={submitting} rows={3} />
                </label>
                <label htmlFor="permanent_address">
                  Permanent address
                  <textarea id="permanent_address" name="permanent_address" value={formData.permanent_address} onChange={handleChange} disabled={submitting} rows={3} />
                </label>

                {/* Bank details */}
                <p className="text-xl font-medium" style={{ margin: '24px 0 8px' }}>Bank details</p>
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
                  <select id="account_type" name="account_type" value={formData.account_type} onChange={handleChange} disabled={submitting}>
                    <option value="SAVINGS">Savings</option>
                    <option value="CURRENT">Current</option>
                  </select>
                </label>
                <label htmlFor="ifsc">
                  IFSC code
                  <input id="ifsc" type="text" name="ifsc" value={formData.ifsc} onChange={handleChange} disabled={submitting} />
                </label>
                <label htmlFor="esi_no">
                  ESI Number
                  <input id="esi_no" type="text" name="ESI_no" value={formData.ESI_no} onChange={handleChange} disabled={submitting} />
                </label>

                {/* Compensation */}
                <p className="text-xl font-medium" style={{ margin: '24px 0 8px' }}>Compensation</p>
                <label htmlFor="basic_salary">Basic salary (₹/mo)<input id="basic_salary" type="number" name="basic_salary" value={formData.basic_salary} onChange={handleChange} disabled={submitting} /></label>
                <label htmlFor="allowance">Allowance (₹/mo)<input id="allowance" type="number" name="allowance" value={formData.allowance} onChange={handleChange} disabled={submitting} /></label>
                <label htmlFor="PA">PA — personal allowance (₹/mo)<input id="PA" type="number" name="PA" value={formData.PA} onChange={handleChange} disabled={submitting} /></label>
                <label htmlFor="OT">OT rate (₹/hr)<input id="OT" type="number" name="OT" value={formData.OT} onChange={handleChange} disabled={submitting} /></label>
                <label htmlFor="PT">PT — professional tax (₹/mo)<input id="PT" type="number" name="PT" value={formData.PT} onChange={handleChange} disabled={submitting} /></label>

                <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                  <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Saving...' : 'Save changes'}</button>
                  <button type="button" className="cancel-button" onClick={() => navigate(`/employees/${id}`)} disabled={submitting}>Cancel</button>
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}