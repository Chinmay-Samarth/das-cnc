import { useEffect, useState } from 'react';
import api from '../api/client';
import { formatScheduleLabel, formatDueLabel } from '../blanketPos/scheduleLabels';

/** Manager modal: preview auto WC assign + daily split, then release to floor */
export default function ReleaseToFloorModal({ schedule, open, onClose, onReleased }) {
  const [split, setSplit] = useState([]);
  const [assignPreview, setAssignPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !schedule) return;
    setError(null);
    setAssignPreview(null);

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

    api
      .post('/production/preview-assign', {
        delivery_schedule_id: schedule.id,
        work_date: new Date().toISOString().slice(0, 10),
      })
      .then(({ data }) => setAssignPreview(data))
      .catch(() => setAssignPreview(null));
  }, [open, schedule]);

  if (!open || !schedule) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/production/release', {
        delivery_schedule_id: schedule.id,
      });
      onReleased?.(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setBusy(false);
    }
  }

  const wcLabel = assignPreview?.work_center
    ? `${assignPreview.work_center.code} — ${assignPreview.work_center.name}`
    : null;
  const operatorLabel = assignPreview?.assignee
    ? `${assignPreview.assignee.full_name}${
        assignPreview.assignee.employee_code ? ` (${assignPreview.assignee.employee_code})` : ''
      }`
    : null;

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
          . Splits equally across Mon–Sat days and auto-assigns operators by work-center backlog.
        </p>

        {error ? <p className="error-message">{error}</p> : null}

        <form onSubmit={handleSubmit}>
          <div className="pc-assign-preview">
            <h3>First operation (auto-assign)</h3>
            {assignPreview?.node ? (
              <ul className="pc-assign-facts">
                <li>
                  <span>Operation</span>
                  <strong>{assignPreview.node.label}</strong>
                </li>
                <li>
                  <span>Work center</span>
                  <strong>{wcLabel || '—'}</strong>
                </li>
                <li>
                  <span>Operator (today)</span>
                  <strong>
                    {operatorLabel || (
                      <em className="pc-unassigned-hint">
                        Unassigned — no one present
                      </em>
                    )}
                  </strong>
                </li>
              </ul>
            ) : (
              <p className="muted">
                {assignPreview?.reason ||
                  'Resolving first machining/assembly work center…'}
              </p>
            )}
            {assignPreview?.reason && assignPreview?.node ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {assignPreview.reason}. Cards stay READY until someone punches in or you run
                Assign unassigned.
              </p>
            ) : null}
          </div>

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
