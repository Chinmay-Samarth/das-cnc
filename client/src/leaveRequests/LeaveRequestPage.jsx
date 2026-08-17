import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { CalendarOff } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { useSocket } from '../socket/socketContext';
import { PageHeader, EmptyState, StatusBadge, TruncatedText } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .split('-')
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function statusTone(status) {
  if (status === 'approved') return 'COMPLETED';
  if (status === 'denied') return 'overdue';
  return 'READY';
}

function ApplicantLeaveView() {
  const { user } = useAuth();
  const { subscribe } = useSocket();
  const [startDate, setStartDate] = useState(todayYmd());
  const [days, setDays] = useState('1');
  const [reason, setReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const endDate = useMemo(() => {
    const n = Math.floor(Number(days));
    if (!(n >= 1) || !startDate) return null;
    return addDaysYmd(startDate, n - 1);
  }, [startDate, days]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { data } = await api.get('/leave-requests/mine');
      setRequests(data.requests || []);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.error || 'Unable to load leave requests');
        setRequests([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('leave-requests:updated', (payload) => {
      if (payload?.employeeId && user?.id && payload.employeeId !== user.id) return;
      load({ silent: true });
    });
  }, [subscribe, load, user?.id]);

  async function handleApply(e) {
    e.preventDefault();
    const dayCount = Math.floor(Number(days));
    if (!startDate || !(dayCount >= 1) || !String(reason).trim()) {
      await appAlert({
        title: 'Missing details',
        message: 'Enter start date, days, and reason.',
        tone: 'danger',
      });
      return;
    }
    setSaving(true);
    try {
      await api.post('/leave-requests', {
        start_date: startDate,
        days: dayCount,
        reason: String(reason).trim(),
      });
      setReason('');
      setDays('1');
      await appAlert({ title: 'Leave requested', tone: 'success' });
      await load();
    } catch (err) {
      await appAlert({
        title: 'Could not apply',
        message: err.response?.data?.error || 'Leave request failed',
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="mes-card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleApply}>
        <h3 className="mes-section-title" style={{ marginTop: 0, fontSize: 15 }}>
          Apply leave
        </h3>
        <div className="mes-filters" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <label>
            Date of leave
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label>
            No. of days
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
              disabled={saving}
              style={{ width: 96 }}
            />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
            Reason
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Brief reason"
              required
              disabled={saving}
            />
          </label>
          <button type="submit" className="mes-btn primary-button" style={{marginTop: 16}} disabled={saving}>
            {saving ? 'Applying…' : 'Apply'}
          </button>
        </div>
        {endDate ? (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
            Leave period: {formatDisplayDate(startDate)} → {formatDisplayDate(endDate)}
          </p>
        ) : null}
      </form>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading requests…</p> : null}

      {!loading && requests.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No leave requests yet"
          description="Apply above. Approved or denied status will show here after admin review."
        />
      ) : null}

      {!loading && requests.length > 0 ? (
        <div className="mes-card" style={{ padding: 12 }}>
          <p
            className="muted"
            style={{
              margin: '4px 8px 12px',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Your requests
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {requests.map((row) => (
              <li key={row.id} className="mes-list-item" style={{ cursor: 'default' }}>
                <div className="mes-list-item-top">
                  <span className="mes-list-item-title">
                    {formatDisplayDate(row.start_date)} → {formatDisplayDate(row.end_date)}
                    <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                      ({row.days} day{Number(row.days) === 1 ? '' : 's'})
                    </span>
                  </span>
                  <StatusBadge status={statusTone(row.status)}>{row.status}</StatusBadge>
                </div>
                <p className="mes-list-item-sub">
                  <TruncatedText>{row.reason}</TruncatedText>
                </p>
                {row.review_note ? (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    Note: {row.review_note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function AdminLeaveView({ initialStatus = 'pending' }) {
  const { subscribe } = useSocket();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { data } = await api.get('/leave-requests', {
        params: { status: statusFilter },
      });
      setRequests(data.requests || []);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.error || 'Unable to load leave requests');
        setRequests([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('leave-requests:updated', () => {
      load({ silent: true });
    });
  }, [subscribe, load]);

  async function handleApprove(row) {
    const ok = await appConfirm({
      title: 'Approve leave?',
      message: `${row.employee_name || 'Employee'}: ${formatDisplayDate(row.start_date)} → ${formatDisplayDate(row.end_date)} (${row.days} day(s)). Present days will not be overwritten.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      const { data } = await api.post(`/leave-requests/${row.id}/approve`);
      const skipped = Number(data.skipped_present_days || 0);
      const written = Number(data.leave_days_written || 0);
      await appAlert({
        title: 'Leave approved',
        message:
          skipped > 0
            ? `Marked ${written} day(s) as leave. Skipped ${skipped} present day(s).`
            : `Marked ${written} day(s) as leave.`,
        tone: 'success',
      });
      await load();
    } catch (err) {
      await appAlert({
        title: 'Approve failed',
        message: err.response?.data?.error || 'Could not approve',
        tone: 'danger',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeny(row) {
    const ok = await appConfirm({
      title: 'Deny leave?',
      message: `${row.employee_name || 'Employee'}: ${formatDisplayDate(row.start_date)} → ${formatDisplayDate(row.end_date)}.`,
      confirmLabel: 'Deny',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.post(`/leave-requests/${row.id}/deny`);
      await load();
    } catch (err) {
      await appAlert({
        title: 'Deny failed',
        message: err.response?.data?.error || 'Could not deny',
        tone: 'danger',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mes-view-toggle" role="group" aria-label="Status filter" style={{ marginBottom: 16 }}>
        {['pending', 'approved', 'denied', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            className={`mes-view-toggle-btn${statusFilter === s ? ' is-active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading requests…</p> : null}

      {!loading && requests.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No leave requests"
          description={
            statusFilter === 'pending'
              ? 'New operator and manager requests will appear here.'
              : 'Nothing in this filter.'
          }
        />
      ) : null}

      {!loading && requests.length > 0 ? (
        <div className="data-table-wrap mes-card" style={{ padding: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Period</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Requested</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.employee_name || '—'}</div>
                    {row.employee_code ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {row.employee_code}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {formatDisplayDate(row.start_date)} → {formatDisplayDate(row.end_date)}
                  </td>
                  <td>{row.days}</td>
                  <td style={{ maxWidth: 220 }}>
                    <TruncatedText>{row.reason}</TruncatedText>
                  </td>
                  <td>{formatDisplayDateTime(row.created_at)}</td>
                  <td>
                    <StatusBadge status={statusTone(row.status)}>{row.status}</StatusBadge>
                  </td>
                  <td>
                    {row.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="mes-btn mes-btn-primary"
                          disabled={busyId === row.id}
                          onClick={() => handleApprove(row)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="mes-btn mes-btn-secondary"
                          disabled={busyId === row.id}
                          onClick={() => handleDeny(row)}
                        >
                          Deny
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

export default function LeaveRequestPage() {
  const { user, isFloorOnly, defaultHomePath } = useAuth();
  const [searchParams] = useSearchParams();
  const isReviewer =
    user?.accessLevel === 'ADMIN' || user?.accessLevel === 'SUPERVISOR';
  const canApply =
    user?.accessLevel === 'OPERATOR' || user?.accessLevel === 'MANAGER';

  if (!canApply && !isReviewer) {
    return <Navigate to={defaultHomePath()} replace />;
  }

  const initialStatus = searchParams.get('status') || 'pending';

  return (
    <main className="mes-shell">
      <PageHeader eyebrow="People" title="Leave Request" />
      {isReviewer ? (
        <AdminLeaveView initialStatus={initialStatus} />
      ) : (
        <ApplicantLeaveView />
      )}
    </main>
  );
}
