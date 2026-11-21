import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../api/client';
import { appAlert } from '../components/dialog';
import useDailyAttendance, { toDisplayTime, toISODateString } from './useDailyAttendance';
import { formatDisplayDate } from '../utils/dateFormat';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AttendanceGauge from '../components/shared/AttendanceGauge';
import StatTile from '../components/shared/StatTile';
import { Download, ChevronLeft, ChevronRight, RefreshCw, UserX, List } from 'lucide-react';
import { PageHeader, Skeleton, SkeletonList } from '../components/mes';
import { getVisiblePages } from '../utils/listHelpers';

function AttendancePageSkeleton() {
  return (
    <div className="attendance-skeleton fade-up" aria-busy="true" aria-label="Loading attendance">
      <div className="summary-metrics-grid">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="summary-metric">
            <div className="attendance-skeleton-stat">
              <Skeleton height={28} width="42%" />
              <Skeleton height={12} width="58%" />
            </div>
          </div>
        ))}
      </div>
      <div className="attendance-content-grid">
        <div className="attendance-main-column">
          <section className="card attendance-records-card">
            <div className="section-header attendance-records-header">
              <Skeleton height={22} width={220} />
              <Skeleton height={36} width={96} radius={10} />
            </div>
            <SkeletonList embedded showHeader={false} showFilters={false} rows={6} cols={5} />
          </section>
          <section className="card absentees-card">
            <div className="absentees-header">
              <Skeleton height={22} width={160} />
            </div>
            <div className="attendance-skeleton-people">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="attendance-skeleton-person">
                  <Skeleton circle height={36} width={36} />
                  <div className="attendance-skeleton-person-copy">
                    <Skeleton height={14} width="55%" />
                    <Skeleton height={11} width="35%" />
                  </div>
                  <Skeleton height={22} width={64} radius={999} />
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="attendance-side-column">
          <section className="card attendance-health-panel attendance-skeleton-gauge">
            <Skeleton circle height={220} width={220} />
            <Skeleton height={14} width="48%" />
            <Skeleton height={12} width="36%" />
          </section>
        </aside>
      </div>
    </div>
  );
}

const RECORDS_PAGE_SIZE = 10;
const ABSENTEES_PREVIEW = 4;
const ATTENDANCE_TARGET = 88;

function formatEmployeeCode(code) {
  if (!code) return '--';
  return code.startsWith('#') ? code : `#${code}`;
}

function formatRecordStatus(status, row = null) {
  if (row?.break_out && !row?.local_out) {
    return { label: 'LUNCH', className: 'late' };
  }
  switch (status) {
    case 'PRESENT':
      return { label: 'ON TIME', className: 'present' };
    case 'LATE':
      return { label: 'LATE', className: 'late' };
    case 'COMPLETED':
      return { label: 'COMPLETED', className: 'completed' };
    case 'LEAVE':
      return { label: 'LEAVE', className: 'leave' };
    case 'HALF_DAY':
      return { label: 'HALF DAY', className: 'half_day' };
    case 'ABSENT':
      return { label: 'ABSENT', className: 'absent' };
    default:
      return { label: status || '--', className: '' };
  }
}

function formatOutCell(row) {
  if (row.local_out) return toDisplayTime(row.local_out);
  if (row.break_out) {
    const back = row.break_in ? ` · back ${toDisplayTime(row.break_in)}` : '';
    return `Lunch ${toDisplayTime(row.break_out)}${back}`;
  }
  return '--';
}

function getCheckInClass(status) {
  return status === 'LATE' ? 'check-in-late' : 'check-in-ontime';
}

export default function AttendancePage() {
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const highlightEmployeeId = searchParams.get('highlightEmployee');

  const [isExporting, setIsExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [recordsPage, setRecordsPage] = useState(1);
  const [showAllAbsentees, setShowAllAbsentees] = useState(false);
  const [highlightId, setHighlightId] = useState(highlightEmployeeId);
  const highlightRowRef = useRef(null);
  const skipPageResetRef = useRef(false);
  const {
    daily,
    loading,
    error,
    absentees,
    onLeave,
    latestRecords,
    presentCount,
    absentCount,
    onLeaveCount,
    totalCount,
    setDate,
    refresh,
    lateArrivals,
  } = useDailyAttendance(dateParam);


  // local selectedDate mirrors the current query date shown in the date input
  const [selectedDate, setSelectedDate] = useState(dateParam || '');

  const navigate = useNavigate();

  useEffect(() => {
    if (dateParam) {
      setDate(dateParam);
      setSelectedDate(dateParam);
    }
  }, [dateParam, setDate]);

  useEffect(() => {
    setHighlightId(highlightEmployeeId);
  }, [highlightEmployeeId]);

  useEffect(() => {
    // initialize selected date when daily payload arrives
    if (daily?.date) setSelectedDate(daily.date);
  }, [daily?.date]);

  useEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      setShowAllAbsentees(false);
      return;
    }
    setRecordsPage(1);
    setShowAllAbsentees(false);
  }, [selectedDate, daily?.date]);

  const displayRecords = useMemo(() => {
    if (!highlightId) return latestRecords;
    const idx = latestRecords.findIndex((row) => String(row.id) === String(highlightId));
    if (idx <= 0) return latestRecords;
    const pinned = latestRecords[idx];
    return [pinned, ...latestRecords.slice(0, idx), ...latestRecords.slice(idx + 1)];
  }, [latestRecords, highlightId]);

  useEffect(() => {
    if (!highlightId || !displayRecords.length) return;
    const idx = displayRecords.findIndex((row) => String(row.id) === String(highlightId));
    if (idx < 0) return;
    skipPageResetRef.current = true;
    setRecordsPage(1);
  }, [highlightId, displayRecords]);

  const recordsTotalPages = Math.max(1, Math.ceil(displayRecords.length / RECORDS_PAGE_SIZE));

  useEffect(() => {
    if (recordsPage > recordsTotalPages) {
      setRecordsPage(recordsTotalPages);
    }
  }, [recordsPage, recordsTotalPages]);

  const paginatedRecords = useMemo(() => {
    const start = (recordsPage - 1) * RECORDS_PAGE_SIZE;
    return displayRecords.slice(start, start + RECORDS_PAGE_SIZE);
  }, [displayRecords, recordsPage]);

  useEffect(() => {
    if (!highlightId || !highlightRowRef.current) return;
    highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, recordsPage, paginatedRecords]);

  const visibleAbsentees = useMemo(() => {
    if (showAllAbsentees) return absentees;
    return absentees.slice(0, ABSENTEES_PREVIEW);
  }, [absentees, showAllAbsentees]);

  const score = totalCount > 0
    ? Math.min(100, Math.round((presentCount / totalCount) * 100))
    : 0;

  const recordsRangeStart = displayRecords.length === 0
    ? 0
    : (recordsPage - 1) * RECORDS_PAGE_SIZE + 1;
  const recordsRangeEnd = Math.min(recordsPage * RECORDS_PAGE_SIZE, displayRecords.length);
  const visiblePages = getVisiblePages(recordsPage, recordsTotalPages);

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
        Date: formatDisplayDate(record.shift_date, ''),
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
      await appAlert({
        title: 'Export failed',
        message: 'Unable to generate attendance Excel. Please try again.',
        tone: 'danger',
      });
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
      await appAlert({
        title: 'Sync failed',
        message: 'Failed to sync biometric attendance. Please try again.',
        tone: 'danger',
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="DasCNC Workforce Console"
        title="Attendance Operations"
        subtitle={`Shift-wise monitoring for ${daily?.date ? formatDisplayDate(daily.date) : 'today'}`}
        actions={
          <div className="btn-corner">
            <div className="date-controls">
              <button type="button" className="date-pickers" onClick={prevDay} aria-label="Previous day"><ChevronLeft size={16} /></button>
              <input
                type="date"
                value={selectedDate || ''}
                onChange={(e) => handleDateChange(e.target.value)}
                aria-label="Select date"
                className="datebar"
                max={toISODateString(new Date())}
              />
              <button type="button" className="date-pickers" onClick={nextDay} aria-label="Next day"><ChevronRight size={16} /></button>
            </div>
            <button type="button" className="primary-button" onClick={goToToday} aria-label="Today">Today</button>
            <button
              type="button"
              className="neutral-button"
              onClick={downloadAttendanceExcel}
              disabled={loading || isExporting}
            >
              <Download size={15} />
              {isExporting ? 'Exporting…' : 'Export to XLS'}
            </button>
          </div>
        }
      />
      {/* <div className="section-header" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        
        <button
          type="button"
          className="neutral-button"
          onClick={handleSyncBiometric}
          disabled={loading || syncing}
        >
          {syncing ? 'Syncing biometric...' : 'Refresh Attendance'}
        </button>
      </div> */}


      {loading ? <AttendancePageSkeleton /> : null}

      {!loading ? (
      <div className="summary-metrics-grid ">
        <div className="summary-metric ">
          <StatTile value={totalCount} label="Total Employees" accent="#1b54cf" />
        </div>
        <div className="summary-metric">
          <StatTile value={presentCount} label="On Duty" accent="#059669" className="attendance-stat"/>
        </div>
        <div className="summary-metric">
          <StatTile value={absentCount} label="Absent" accent="#dc2626" />
        </div>
        <div className="summary-metric">
          <StatTile value={onLeaveCount} label="On Leave" accent="#ea580c" />
        </div>
        <div className="summary-metric">
          <StatTile value={lateArrivals} label="Late Arrivals" accent="#f5a114" />
        </div>
      </div>
      ) : null}

      {!loading ? (
      <div className="attendance-content-grid">
        <div className="attendance-main-column">
          <section className="card attendance-records-card">
            <div className="section-header attendance-records-header">
              <div className="attendance-records-title">
                <List size={20} className="attendance-records-icon" aria-hidden="true" />
                <h2>Latest Attendance Records</h2>
                <span className="count-chip">{displayRecords.length}</span>
              </div>

                <div className="last-btn" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="mes-btn mes-btn-secondary"
                    onClick={handleSyncBiometric}
                    disabled={syncing}
                  >
                    <RefreshCw size={15} />
                    {syncing ? 'Syncing…' : 'Sync'}
                  </button>
                </div>
            </div>
            {error ? <p className="error-message">{error}</p> : null}
            {!error && displayRecords.length === 0 ? (
              <p className="muted">No punch records available yet for today.</p>
            ) : null}
            {!error && displayRecords.length > 0 ? (
              <div className="attendance-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th className="col-sno">#</th>
                      <th>Employee</th>
                      <th>Shift</th>
                      <th>Check-In</th>
                      <th>Check-Out</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRecords.map((row, index) => {
                      const statusMeta = formatRecordStatus(row.status, row);
                      const isHighlighted = highlightId && String(row.id) === String(highlightId);
                      return (
                      <tr
                        key={`${row.employee_code}-${row.local_in}-${row.local_out}-${row.id}`}
                        ref={isHighlighted ? highlightRowRef : undefined}
                        className={isHighlighted ? 'is-punch-highlight' : undefined}
                        onClick={() => navigate(`/employees/${row.id}`)}
                      >
                        <td className="col-sno">{(recordsPage - 1) * RECORDS_PAGE_SIZE + index + 1}</td>
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
                        <td className="check-out-time">{formatOutCell(row)}</td>
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
            {!error && displayRecords.length > 0 ? (
              <div className="attendance-pagination">
                <span className="attendance-page-summary">
                  Showing {recordsRangeStart} to {recordsRangeEnd} of {displayRecords.length} records
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
                  className=""
                  onClick={() => setShowAllAbsentees((prev) => !prev)}
                >
                  {showAllAbsentees ? 'SHOW LESS' : 'VIEW ALL'}
                </button>
              ) : null}
            </div>
            {error ? <p className="error-message">{error}</p> : null}
            {!error && absentees.length === 0 ? (
              <p className="muted">No absentees today.</p>
            ) : null}
            {!error && absentees.length > 0 ? (
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

          <section className="card absentees-card" style={{ marginTop: 16 }}>
            <div className="absentees-header">
              <div className="absentees-title-group">
                <h2>On leave</h2>
                <span className="absentees-count-badge" style={{ background: '#ffedd5', color: '#c2410c' }}>
                  {onLeave.length}
                </span>
              </div>
            </div>
            {!error && onLeave.length === 0 ? (
              <p className="muted">No approved leave today.</p>
            ) : null}
            {!error && onLeave.length > 0 ? (
              <ul className="absentees-grid">
                {onLeave.map((row) => (
                  <li
                    key={`leave-${row.employee_code || row.id}`}
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
                    <div className="absentee-avatar">
                      {row?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div className="absentee-info">
                      <strong>{row.full_name}</strong>
                      <span>{row.shift || 'No shift'}</span>
                    </div>
                    <span className="absentee-status leave-status">LEAVE</span>
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
      ) : null}
    </main>
  );
}
