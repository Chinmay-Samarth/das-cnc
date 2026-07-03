import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../api/client';
import useDailyAttendance, { toDisplayTime } from './useDailyAttendance';
import { useNavigate } from 'react-router-dom';
import AttendanceGauge from '../components/shared/Attendancegauge';
import StatTile from '../components/shared/StatTile';
import { Download, ChevronLeft, ChevronRight, RefreshCw, UserX, List } from 'lucide-react';

const RECORDS_PAGE_SIZE = 10;
const ABSENTEES_PREVIEW = 4;
const ATTENDANCE_TARGET = 88;

function formatEmployeeCode(code) {
  if (!code) return '--';
  return code.startsWith('#') ? code : `#${code}`;
}

function formatRecordStatus(status) {
  switch (status) {
    case 'PRESENT':
      return { label: 'ON TIME', className: 'present' };
    case 'LATE':
      return { label: 'LATE', className: 'late' };
    case 'COMPLETED':
      return { label: 'COMPLETED', className: 'completed' };
    default:
      return { label: status || '--', className: '' };
  }
}

function getCheckInClass(status) {
  return status === 'LATE' ? 'check-in-late' : 'check-in-ontime';
}

function getVisiblePages(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < totalPages) pages.add(currentPage + 1);

  return [...pages].sort((a, b) => a - b);
}

export default function AttendancePage() {
  const [isExporting, setIsExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [recordsPage, setRecordsPage] = useState(1);
  const [showAllAbsentees, setShowAllAbsentees] = useState(false);
  const { daily, loading, error, absentees, latestRecords, presentCount, absentCount, totalCount, setDate, refresh, lateArrivals } =
    useDailyAttendance();


  // local selectedDate mirrors the current query date shown in the date input
  const [selectedDate, setSelectedDate] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    // initialize selected date when daily payload arrives
    if (daily?.date) setSelectedDate(daily.date);
  }, [daily?.date]);

  useEffect(() => {
    setRecordsPage(1);
    setShowAllAbsentees(false);
  }, [selectedDate, daily?.date]);

  const recordsTotalPages = Math.max(1, Math.ceil(latestRecords.length / RECORDS_PAGE_SIZE));

  useEffect(() => {
    if (recordsPage > recordsTotalPages) {
      setRecordsPage(recordsTotalPages);
    }
  }, [recordsPage, recordsTotalPages]);

  const paginatedRecords = useMemo(() => {
    const start = (recordsPage - 1) * RECORDS_PAGE_SIZE;
    return latestRecords.slice(start, start + RECORDS_PAGE_SIZE);
  }, [latestRecords, recordsPage]);

  const visibleAbsentees = useMemo(() => {
    if (showAllAbsentees) return absentees;
    return absentees.slice(0, ABSENTEES_PREVIEW);
  }, [absentees, showAllAbsentees]);

  const score = totalCount > 0
    ? Math.min(100, Math.round((presentCount / totalCount) * 100))
    : 0;

  const recordsRangeStart = latestRecords.length === 0
    ? 0
    : (recordsPage - 1) * RECORDS_PAGE_SIZE + 1;
  const recordsRangeEnd = Math.min(recordsPage * RECORDS_PAGE_SIZE, latestRecords.length);
  const visiblePages = getVisiblePages(recordsPage, recordsTotalPages);

  function toISODateString(date) {
    return new Date(date).toLocaleDateString('en-CA');
  }

  function shiftDateStr(dateStr, delta) {
    const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
    base.setDate(base.getDate() + delta);
    return toISODateString(base);
  }

  function handleDateChange(newDate) {
    // empty string -> clear filter (uses server default)
    setSelectedDate(newDate || '');
    setDate(newDate || null);
  }

  function prevDay() {
    const anchor = selectedDate || daily?.date || toISODateString(new Date());
    handleDateChange(shiftDateStr(anchor, -1));
  }

  function nextDay() {
    const anchor = selectedDate || daily?.date || toISODateString(new Date());

    const nextDate = shiftDateStr(anchor, 1);
    const today = toISODateString(new Date());

    if(nextDate>today){
      return;
    }

    handleDateChange(nextDate);
  }

  function goToToday() {
    const today = toISODateString(new Date());
    handleDateChange(today);
  }

  async function downloadAttendanceExcel() {
    try {
      setIsExporting(true);
      const params = selectedDate ? { params: { date: selectedDate } } : {};
      const response = await api.get('/attendance/daily', params);
      const attendance = response.data;
      // mapping rows and data
      // can change the data in the excel field so (modifiable according to the need)
      const rows = attendance.records.map((record) => ({
        Employee: record.full_name,
        'Employee Code': record.employee_code,
        Role: record.role,
        Department: record.department,
        Shift: record.shift,
        Date: record.shift_date,
        Status: record.status,
        'Punched In': record.local_in,
        'Punched Out': record.local_out,
        'Minutes Worked': record.minutes_worked,
        'Overtime Minutes': record.overtime_minutes,
        Source: record.source,
        'Supervisor Note': record.supervisor_note,
      }));

      // creating an excel sheet and appending it to a workbook 

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Attendance');
      const excelBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      });

      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `daily-attendance-${attendance.date || selectedDate || 'today'}.xlsx`;

      // creating a link and making it a downlaodable file 
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Failed to download attendance Excel:', err);
      alert('Unable to generate attendance Excel. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSyncBiometric() {
    try {
      setSyncing(true);
      await api.post('/sync/biometric');
      await refresh();
      } catch (err) {
      console.error('Biometric sync failed:', err);
      alert('Failed to sync biometric attendance. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="app-shell ">
      <header className="app-header">
        <div className="attendance-header">
          <div className="header-title-block">
            <p className="eyebrow">DasCNC Workforce Console</p>
            <h1>Attendance Operations</h1>
            <p className="muted">Shift-wise monitoring for {daily?.date || 'today'}</p>
          </div>
          <div className="btn-corner">
            <div className="date-controls w-50" style={{marginTop:8, display:'flex', gap:0, alignItems:'center'}}>
              <button type="button" className="date-pickers" onClick={prevDay} aria-label="Previous day"><ChevronLeft size={16}/></button>
              <input
                type="date"
                value={selectedDate || ''}
                onChange={(e) => handleDateChange(e.target.value)}
                aria-label="Select date"
                className='datebar'
                max={toISODateString(new Date())}
                />
              <button type="button" className=" date-pickers" onClick={nextDay} aria-label="Next day"><ChevronRight size={16}/></button>
            </div>
            <button type="button" className="primary-button" onClick={goToToday} aria-label="Today">Today</button>
            <button
              type="button"
              className="neutral-button "
              onClick={downloadAttendanceExcel}
              disabled={loading || isExporting}
            >
              <Download size={16} style={{display: 'inline'}}/>
              <span style={{marginLeft: '4px'}}>{isExporting ? 'Preparing File...' : 'Export to XLS'}</span>
            </button>
          </div>
        </div>
      </header>
      {/* <div className="section-header" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        
        <button
          type="button"
          className="secondary-button"
          onClick={handleSyncBiometric}
          disabled={loading || syncing}
        >
          {syncing ? 'Syncing biometric...' : 'Refresh Attendance'}
        </button>
      </div> */}


      <div className="summary-metrics-grid ">
        <div className="summary-metric ">
          <StatTile value={totalCount} label="Total Employees" accent="#1b54cf" />
        </div>
        <div className="summary-metric">
          <StatTile value={presentCount} label="On Duty" accent="#059669" className="attendance-stat"/>
        </div>
        <div className="summary-metric">
          <StatTile value={absentCount} label="On Leave" accent="#dc2626" />
        </div>
        <div className="summary-metric">
          <StatTile value={lateArrivals} label="Late Arrivals" accent="#f5a114" />
        </div>
      </div>

      <div className="attendance-content-grid">
        <div className="attendance-main-column">
      <section className="card attendance-records-card">
        <div className="section-header attendance-records-header">
          <div className="attendance-records-title">
            <List size={20} className="attendance-records-icon" aria-hidden="true" />
            <h2>Latest Attendance Records</h2>
            <span className="count-chip">{latestRecords.length}</span>
          </div>

            <div className="last-btn" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="neutral-button"
                onClick={handleSyncBiometric}
                disabled={loading || syncing}
              >
                <RefreshCw size={16}  style={{display: 'inline', marginRight: 6}}/>
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
            </div>
        </div>
        {loading ? <p className="muted">Loading attendance data...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
        {!loading && !error && latestRecords.length === 0 ? (
          <p className="muted">No punch records available yet for today.</p>
        ) : null}
        {!loading && !error && latestRecords.length > 0 ? (
          <div className="attendance-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Check-In</th>
                  <th>Check-Out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRecords.map((row) => {
                  const statusMeta = formatRecordStatus(row.status);
                  return (
                  <tr key={`${row.employee_code}-${row.local_in}-${row.local_out}`} onClick={()=>{navigate(`/employees/${row.id}`)}}>
                    <td className='name-column'>
                      <div className="table-avatar">

                      {row?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                      </div>
                      <div className="">
                      <strong>{row.full_name}</strong>
                      <div className="table-subtext">{formatEmployeeCode(row.employee_code)}</div>
                      </div>
                    </td>
                    <td>{row.shift || '--'}</td>
                    <td className={getCheckInClass(row.status)}>{toDisplayTime(row.local_in)}</td>
                    <td className="check-out-time">{toDisplayTime(row.local_out)}</td>
                    <td>
                      <span className={`status-chip ${statusMeta.className}`}>{statusMeta.label}</span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && !error && latestRecords.length > 0 ? (
          <div className="attendance-pagination">
            <span className="attendance-page-summary">
              Showing {recordsRangeStart} to {recordsRangeEnd} of {latestRecords.length} records
            </span>
            {recordsTotalPages > 1 ? (
              <div className="attendance-page-controls">
                <button
                  type="button"
                  className="attendance-page-nav"
                  disabled={recordsPage === 1}
                  onClick={() => setRecordsPage((p) => p - 1)}
                >
                  Previous
                </button>
                {visiblePages.map((pageNumber, index) => {
                  const previousPage = visiblePages[index - 1];
                  const needsEllipsis = index > 0 && pageNumber - previousPage > 1;

                  return (
                    <span key={pageNumber} className="attendance-page-number-wrap">
                      {needsEllipsis ? <span className="attendance-page-ellipsis">...</span> : null}
                      <button
                        type="button"
                        className={`attendance-page-number${recordsPage === pageNumber ? ' active' : ''}`}
                        onClick={() => setRecordsPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="attendance-page-nav"
                  disabled={recordsPage === recordsTotalPages}
                  onClick={() => setRecordsPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card absentees-card">
        <div className="absentees-header">
          <div className="absentees-title-group">
            <UserX size={20} className="absentees-icon" aria-hidden="true" />
            <h2>Absentees List</h2>
            <span className="absentees-count-badge">{absentees.length}</span>
          </div>
          {absentees.length > ABSENTEES_PREVIEW ? (
            <button
              type="button"
              className="absentees-view-all"
              onClick={() => setShowAllAbsentees((prev) => !prev)}
            >
              {showAllAbsentees ? 'SHOW LESS' : 'VIEW ALL'}
            </button>
          ) : null}
        </div>
        {loading ? <p className="muted">Loading attendance data...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
        {!loading && !error && absentees.length === 0 ? (
          <p className="muted">No absentees today.</p>
        ) : null}
        {!loading && !error && absentees.length > 0 ? (
          <ul className="absentees-grid">
            {visibleAbsentees.map((row) => (
              <li
                key={row.employee_code}
                className="absentee-item"
                onClick={() => navigate(`/employees/${row.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/employees/${row.id}`);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="absentee-avatar">{row?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}</div>
                <div className="absentee-info">
                  <strong>{row.full_name}</strong>
                  <span>{row.shift || 'No shift'}</span>
                </div>
                <span className="absentee-status">ABSENT</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
        </div>

        <aside className="attendance-side-column">
          <section className="card attendance-health-panel">
            <AttendanceGauge
              score={score}
              target={ATTENDANCE_TARGET}
              size={260}
              variant="card"
            />
          </section>
        </aside>
      </div>
    </main>
  );
}
