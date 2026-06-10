import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../api/client';
import useDailyAttendance, { toDisplayTime } from './useDailyAttendance';

export default function AttendancePage() {
  const [isExporting, setIsExporting] = useState(false);
  const { daily, loading, error, absentees, latestRecords, presentCount, absentCount, totalCount, setDate } =
    useDailyAttendance();

  // local selectedDate mirrors the current query date shown in the date input
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    // initialize selected date when daily payload arrives
    if (daily?.date) setSelectedDate(daily.date);
  }, [daily?.date]);

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

  return (
    <main className="app-shell attendance-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">DasCNC Workforce Console</p>
          <h1>Attendance Operations</h1>
          <p className="muted">Shift-wise monitoring for {daily?.date || 'today'}</p>
          <div className="date-controls w-50" style={{marginTop:8, display:'flex', gap:5, alignItems:'center'}}>
            <button type="button" className="secondary-button" onClick={prevDay} aria-label="Previous day">‹</button>
            <input
              type="date"
              value={selectedDate || ''}
              onChange={(e) => handleDateChange(e.target.value)}
              aria-label="Select date"
              style={{ width: 140 }}
              max={toISODateString(new Date())}
            />
            <button type="button" className="secondary-button" onClick={nextDay} aria-label="Next day">›</button>
            <button type="button" className="primary-button" onClick={goToToday} aria-label="Today">Today</button>
          </div>
        </div>
      </header>
      <div className="section-header">
        {/* Attendance download button */}
        <button
        type="button"
        className="primary-button"
        onClick={downloadAttendanceExcel}
        disabled={loading || isExporting}
        >
        {isExporting ? 'Preparing Excel...' : 'Download Attendance Excel'}
        </button>
      </div>

      <section className="attendance-grid">
        <article className="card kpi-card headcount-combined-card">
          <p className="kpi-label">Overview</p>
          <div className="headcount-combined-grid">
            <div>
              <p className="muted">Present</p>
              <h2>{presentCount}</h2>
            </div>
            <div>
              <p className="muted">Absent</p>
              <h2>{absentCount}</h2>
            </div>
            <div>
              <p className="muted">Total Workforce</p>
              <h2>{totalCount}</h2>
            </div>
          </div>
          <p className="status-pill">{daily?.date || 'Today'}</p>
        </article>

        <article className="card kpi-card">
          <p className="kpi-label">Present</p>
          <h2>{presentCount}</h2>
          <p className="muted">On-site and marked present today</p>
        </article>

        <article className="card kpi-card">
          <p className="kpi-label">Absent</p>
          <h2>{absentCount}</h2>
          <p className="muted">Employees missing attendance today</p>
        </article>

        <article className="card kpi-card">
          <p className="kpi-label">Total Workforce</p>
          <h2>{totalCount}</h2>
          <p className="status-pill">{daily?.date || 'Today'}</p>
        </article>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Absentees List</h2>
          <span className="count-chip">{absentees.length}</span>
        </div>
        {loading ? <p className="muted">Loading attendance data...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
        {!loading && !error && absentees.length === 0 ? (
          <p className="muted">No absentees today.</p>
        ) : null}
        {!loading && !error && absentees.length > 0 ? (
          <ul className="dashboard-list">
            {absentees.map((row) => (
              <li key={row.employee_code} className="dashboard-row">
                <div>
                  <strong>{row.full_name}</strong>
                  <span>{row.employee_code}</span>
                </div>
                <div className="row-meta">
                  <span>{row.department || 'No department'}</span>
                  <span>{row.shift || 'No shift'}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card">
        <div className="section-header">
        
            <h2>Latest Attendance Records</h2>
            <span className="count-chip">{latestRecords.length}</span>
        </div>
        {!loading && !error && latestRecords.length === 0 ? (
          <p className="muted">No punch records available yet for today.</p>
        ) : null}
        {!loading && !error && latestRecords.length > 0 ? (
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {latestRecords.map((row) => (
                  <tr key={`${row.employee_code}-${row.local_in}-${row.local_out}`}>
                    <td>
                      <strong>{row.full_name}</strong>
                      <div className="table-subtext">{row.employee_code}</div>
                    </td>
                    <td>{row.shift || '--'}</td>
                    <td className="in-time">In: {toDisplayTime(row.local_in)}</td>
                    <td className="out-time">Out: {toDisplayTime(row.local_out)}</td>
                    <td>
                      <span className="status-chip">{row.status || '--'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
