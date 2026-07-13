import useDailyAttendance, { toDisplayTime } from '../attendance/useDailyAttendance';
import { useNavigate } from 'react-router-dom';
import AttendanceGauge from '../components/shared/Attendancegauge';
import StatTile from '../components/shared/StatTile';
import { formatDisplayDate } from '../utils/dateFormat';



export default function HomePage() {
  const {
    daily,
    loading,
    error,
    latestRecords,
    presentCount,
    absentCount,
    totalCount,
  } = useDailyAttendance();

  const score = Math.min(100, Math.round((presentCount / totalCount) * 100)) 

  const navigate = useNavigate();
  return (
    <main className="app-shell attendance-page">
      <header className="app-header">
        <div className="header-title-block">
          {/* <p className="eyebrow">Operations Home Board</p> */}
          <h1>Home</h1>
          <button onClick={()=> navigate('/masters/config/new')}>Add Master</button>
        </div>
      </header>

      <section className="card summary-single-card">
        <div className="">
          <h2>Daily Attendance Summary</h2>
          <span className="count-chip">{daily?.date ? formatDisplayDate(daily.date) : 'Today'}</span>
        </div>
        <div className="summary-metrics-grid">
          <div className="summary-metric">
            <AttendanceGauge score={score} size={220}/>
          </div>

          <div className="summary-metric">
            <StatTile label="Present" value={presentCount} accent="#059669"/>
          </div>

          <div className="summary-metric">
            <StatTile label="Absent" value={absentCount} accent="#dc2626"/>
          </div>

          <div className="summary-metric">
            <StatTile label="Total Workforce" value={totalCount} accent="#1b54cf"/>
          </div>
        </div>
          {/* <p className="muted">Live from daily attendance register ({daily?.date || 'Today'})</p> */}


        <div className="section-header">
          <h2>Latest Punch Snapshot</h2>
          
        </div>
        {loading ? <p className="muted">Loading attendance data...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}
        {!loading && !error && latestRecords.length === 0 ? (
          <p className="muted">No punch records yet for today.</p>
        ) : null}
        {!loading && !error && latestRecords.length > 0 ? (
          <div className="attendance-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {latestRecords.slice(0, 6).map((row) => (
                  <tr key={`${row.employee_code}-${row.local_in}-${row.local_out}`} onClick={()=>{navigate(`/employees/${row.id}`)}}>
                    <td>
                      <strong>{row.full_name}</strong>
                      <div className="table-subtext">{row.employee_code}</div>
                    </td>
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
