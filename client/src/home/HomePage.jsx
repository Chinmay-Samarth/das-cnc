import useDailyAttendance, { toDisplayTime } from '../attendance/useDailyAttendance';

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

  return (
    <main className="app-shell attendance-page">
      <header className="app-header">
        <div className="header-title-block">
          {/* <p className="eyebrow">Operations Home Board</p> */}
          <h1>Home</h1>
          
        </div>
      </header>

      <section className="card summary-single-card">
        <div className="">
          <h2>Daily Attendance Summary</h2>
          <span className="count-chip">{daily?.date || 'Today'}</span>
        </div>
          {/* <p className="muted">Live from daily attendance register ({daily?.date || 'Today'})</p> */}
        <div className="summary-metrics-grid">
          <div className="summary-metric">
            <p className="kpi-label">Present</p>
            <h2>{presentCount}</h2>
          </div>
          <div className="summary-metric">
            <p className="kpi-label">Absent</p>
            <h2>{absentCount}</h2>
          </div>
          <div className="summary-metric">
            <p className="kpi-label">Total Workforce</p>
            <h2>{totalCount}</h2>
          </div>
        </div>

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
            <table className="attendance-table">
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
                  <tr key={`${row.employee_code}-${row.local_in}-${row.local_out}`}>
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
