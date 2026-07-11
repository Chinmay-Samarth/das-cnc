import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatScheduleLabel, formatDueLabel } from '../blanketPos/scheduleLabels';

/** Manager modal: assign employee + preview daily split, then release to floor */
export default function ReleaseToFloorModal({ schedule, open, onClose, onReleased }) {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [split, setSplit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEmployeeId('');
    api
      .get('/employees')
      .then(({ data }) => setEmployees(data.employees || data || []))
      .catch(() => setEmployees([]));
  }, [open]);

  useEffect(() => {
    if (!open || !schedule) return;
    api
      .post('/production/preview-split', {
        quantity: schedule.quantity,
        due_date: schedule.due_date,
      })
      .then(({ data }) => setSplit(data.split || []))
      .catch((err) => {
        setSplit([]);
        setError(err.response?.data?.error || 'Unable to preview daily split');
      });
  }, [open, schedule]);

  if (!open || !schedule) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!employeeId) {
      setError('Select an employee');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/production/release', {
        delivery_schedule_id: schedule.id,
        assigned_employee_id: employeeId,
      });
      onReleased?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-release-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="pc-release-title">Release to shop floor</h2>
        <p className="muted" style={{ marginBottom: 4 }}>
          {formatScheduleLabel(schedule)}
        </p>
        <p className="muted">
          Delivery due{' '}
          <strong>{formatDueLabel(schedule.due_date, schedule.due_weekday_label)}</strong>
          {schedule.rule_weekday_label
            ? ` · weekly ${schedule.rule_weekday_label} rule`
            : schedule.rule_month_day != null
              ? ` · monthly day ${schedule.rule_month_day} rule`
              : ''}
          . Splits equally across Mon–Sat days through the due date and assigns one employee.
        </p>

        {error ? <p className="error-message">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <label>
            Assign employee <span className="req">*</span>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              disabled={busy}
            >
              <option value="">Select employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                  {emp.employee_code ? ` (${emp.employee_code})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="pc-split-preview">
            <h3>Daily plan preview</h3>
            {split.length ? (
              <ul>
                {split.map((row) => (
                  <li key={row.work_date}>
                    <span>{formatDueLabel(row.work_date)}</span>
                    <strong>{row.target_quantity}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No working days in range.</p>
            )}
          </div>

          <div className="pc-modal-actions">
            <button type="button" className="neutral-button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy || !split.length}>
              {busy ? 'Releasing…' : 'Release & create daily cards'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
