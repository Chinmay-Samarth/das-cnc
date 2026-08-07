import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  CalendarX2,
  LogOut,
  Percent,
  RefreshCw,
  Settings,
  UserX,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import {
  PageHeader,
  EmptyState,
  StatusBadge,
  TruncatedText,
} from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDateTime } from '../utils/dateFormat';

const TYPE_META = {
  open_punch_out: { icon: LogOut, label: 'Punch-out' },
  low_attendance: { icon: Percent, label: 'Attendance %' },
  consecutive_absent: { icon: CalendarX2, label: 'Absence streak' },
};

function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDisplayDateTime(iso);
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { hasAccess } = useAuth();
  const isAdmin = hasAccess('ADMIN');
  console.log(isAdmin)

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('unread');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!isAdmin) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = { category: 'attendance' };
      if (statusFilter === 'unread') params.status = 'unread';
      const { data } = await api.get('/notifications', { params });
      setItems(data.notifications || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load notifications');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, statusFilter]);

  const loadSettings = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get('/notifications/settings');
      setThreshold(Number(data.settings?.attendance_pct_threshold) || 80);
    } catch {
      /* ignore */
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const unreadCount = useMemo(
    () => items.filter((n) => n.status === 'unread').length,
    [items]
  );

  async function handleMarkAllRead() {
    if (!isAdmin) return;
    const ok = await appConfirm({
      title: 'Mark all as read?',
      message: 'All unread attendance alerts will be marked read.',
      confirmLabel: 'Mark all read',
    });
    if (!ok) return;
    try {
      await api.post('/notifications/read-all');
      await load();
    } catch (err) {
      await appAlert({
        title: 'Could not update',
        message: err.response?.data?.error || 'Mark all read failed',
        tone: 'danger',
      });
    }
  }

  async function handleOpen(n) {
    if (busyId) return;
    setBusyId(n.id);
    try {
      if (n.status === 'unread') {
        await api.post(`/notifications/${n.id}/read`);
      }
      if (n.employee_id) {
        navigate(`/employees/${n.employee_id}`);
      } else {
        await load();
      }
    } catch {
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(e, n) {
    e.stopPropagation();
    setBusyId(n.id);
    try {
      await api.post(`/notifications/${n.id}/dismiss`);
      setItems((prev) => prev.filter((x) => x.id !== n.id));
    } catch (err) {
      await appAlert({
        title: 'Could not dismiss',
        message: err.response?.data?.error || 'Dismiss failed',
        tone: 'danger',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    const value = Number(threshold);
    if (!(value >= 0 && value <= 100)) {
      await appAlert({
        title: 'Invalid threshold',
        message: 'Enter a percentage between 0 and 100.',
        tone: 'danger',
      });
      return;
    }
    setSettingsBusy(true);
    try {
      const { data } = await api.put('/notifications/settings', {
        attendance_pct_threshold: value,
      });
      setThreshold(Number(data.settings?.attendance_pct_threshold) || value);
      setSettingsOpen(false);
      await appAlert({
        title: 'Settings saved',
        message: `Low attendance alerts will use ${value}%.`,
        tone: 'success',
      });
      await load();
    } catch (err) {
      await appAlert({
        title: 'Could not save',
        message: err.response?.data?.error || 'Settings update failed',
        tone: 'danger',
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="mes-shell">
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        actions={
          <>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={load} disabled={loading}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings size={15} />
              Settings
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-secondary"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={15} />
              Mark all read
            </button>
          </>
        }
      />

      {settingsOpen ? (
        <form className="mes-card notif-settings" onSubmit={handleSaveSettings}>
          <h3 className="mes-section-title" style={{ marginTop: 0, fontSize: 15 }}>
            Attendance threshold
          </h3>
          {/* <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
            Alert when an active employee’s month-to-date attendance falls below this percentage.
          </p> */}
          <div style={{display: 'flex', alignItems: "center", gap: '24px', flexDirection: 'row', }}>
          <label className="notif-settings-field">
            Threshold %
          </label >
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={threshold}
              style={{width: '50%'}}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={settingsBusy}
              />
            </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="primary-button" disabled={settingsBusy}>
              {settingsBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="cancel-button"
              onClick={() => setSettingsOpen(false)}
              disabled={settingsBusy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="mes-view-toggle" role="group" aria-label="Status filter" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`mes-view-toggle-btn${statusFilter === 'unread' ? ' is-active' : ''}`}
          onClick={() => setStatusFilter('unread')}
        >
          Unread
        </button>
        <button
          type="button"
          className={`mes-view-toggle-btn${statusFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All
        </button>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading notifications…</p> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="No attendance alerts right now. Missed punch-outs (flagged next day), low attendance, and absence streaks will appear here."
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="mes-card notif-list" style={{ padding: 12 }}>
          <p className="muted" style={{ margin: '4px 8px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Attendance
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((n) => {
              const meta = TYPE_META[n.type] || { icon: UserX, label: n.type };
              const Icon = meta.icon;
              const unread = n.status === 'unread';
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`mes-list-item notif-row${unread ? ' is-unread' : ''}`}
                  onClick={() => handleOpen(n)}
                  disabled={busyId === n.id}
                >
                  <div className="notif-row-main">
                    <span className={`notif-type-icon notif-sev-${n.severity || 'warning'}`} aria-hidden>
                      <Icon size={16} />
                    </span>
                    <div className="notif-row-copy">
                      <div className="mes-list-item-top">
                        <span className="mes-list-item-title">
                          <TruncatedText>{n.title}</TruncatedText>
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          {unread ? <StatusBadge status="ready">Unread</StatusBadge> : null}
                          <StatusBadge status={n.severity === 'critical' ? 'overdue' : 'ready'}>
                            {meta.label}
                          </StatusBadge>
                        </div>
                      </div>
                      <p className="mes-list-item-sub" style={{ marginBottom: 0 }}>
                        <TruncatedText>{n.body}</TruncatedText>
                      </p>
                      <p className="mes-list-item-meta" style={{ marginBottom: 0, marginTop: 4 }}>
                        {relativeTime(n.created_at)}
                        {n.payload?.employee_code ? ` · ${n.payload.employee_code}` : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    className="notif-dismiss"
                    onClick={(e) => handleDismiss(e, n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleDismiss(e, n);
                      }
                    }}
                  >
                    Dismiss
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
