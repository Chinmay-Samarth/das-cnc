import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  CalendarX2,
  ClipboardCheck,
  Factory,
  FileText,
  LogOut,
  PackageX,
  Percent,
  RefreshCw,
  Settings,
  Timer,
  Truck,
  UserX,
  Waves,
  CalendarOff,
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
import { useSocket } from '../socket/socketContext';

const TYPE_META = {
  open_punch_out: { icon: LogOut, label: 'Punch-out', category: 'attendance' },
  low_attendance: { icon: Percent, label: 'Attendance %', category: 'attendance' },
  consecutive_absent: { icon: CalendarX2, label: 'Absence streak', category: 'attendance' },
  leave_request_pending: { icon: CalendarOff, label: 'Leave request', category: 'attendance' },
  insufficient_stock: { icon: PackageX, label: 'Stock short', category: 'inventory' },
  girn_pending_inspection: { icon: ClipboardCheck, label: 'GIRN inspection', category: 'inventory' },
  invoice_overdue: { icon: FileText, label: 'Invoice overdue', category: 'finance' },
  op1_schedule_delay: { icon: Timer, label: 'Op1 delay', category: 'production' },
  outsource_lead_delay: { icon: Truck, label: 'Outsource delay', category: 'production' },
  horizon_wave_renewed: { icon: Waves, label: 'Wave renew', category: 'production' },
  horizon_wave_stuck: { icon: Factory, label: 'Wave stuck', category: 'production' },
};

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

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

function sortNotifications(list) {
  return [...list].sort((a, b) => {
    const pa = Number(a.priority) || (a.category === 'inventory' ? 1 : 2);
    const pb = Number(b.priority) || (b.category === 'inventory' ? 1 : 2);
    if (pa !== pb) return pa - pb;
    const sa = SEVERITY_RANK[a.severity] ?? 9;
    const sb = SEVERITY_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { hasAccess } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = hasAccess('ADMIN');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('unread');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!isAdmin) {
      setItems([]);
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = {};
      if (statusFilter === 'unread') params.status = 'unread';
      if (categoryFilter !== 'all') params.category = categoryFilter;
      const { data } = await api.get('/notifications', { params });
      setItems(sortNotifications(data.notifications || []));
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.error || 'Unable to load notifications');
        setItems([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAdmin, statusFilter, categoryFilter]);

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

  useEffect(() => {
    if (!isAdmin) return undefined;
    return subscribe('leave-requests:updated', () => {
      load({ silent: true });
    });
  }, [isAdmin, subscribe, load]);

  const unreadCount = useMemo(
    () => items.filter((n) => n.status === 'unread').length,
    [items]
  );

  async function handleMarkAllRead() {
    if (!isAdmin) return;
    const ok = await appConfirm({
      title: 'Mark all as read?',
      message: 'All unread alerts will be marked read.',
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
      if (n.type === 'leave_request_pending') {
        navigate('/leave-requests?status=pending');
      } else if (n.employee_id && n.type !== 'leave_request_pending') {
        navigate(`/employees/${n.employee_id}`);
      } else if (n.type === 'girn_pending_inspection') {
        const girnId = n.payload?.girn_id;
        navigate(girnId ? `/girn/${girnId}` : '/girn');
      } else if (n.type === 'op1_schedule_delay') {
        const cardId = n.payload?.parent_card_id;
        navigate(cardId ? `/production/cards/${cardId}` : '/production/horizon-planner');
      } else if (n.type === 'outsource_lead_delay') {
        navigate('/production/outsource');
      } else if (n.type === 'horizon_wave_renewed' || n.type === 'horizon_wave_stuck') {
        navigate('/production/horizon-planner');
      } else if (n.category === 'inventory') {
        navigate('/delivery-schedules');
      } else if (n.category === 'finance' || n.type === 'invoice_overdue') {
        const invId = n.payload?.sales_invoice_id;
        navigate(invId ? `/sales-invoices/${invId}` : '/sales-invoices?tab=due');
      } else if (n.category === 'production') {
        navigate('/production/horizon-planner');
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

      <div className="mes-view-toggle" role="group" aria-label="Status filter" style={{ marginBottom: 12 }}>
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

      <div className="mes-view-toggle" role="group" aria-label="Category filter" style={{ marginBottom: 16, marginLeft: 16 }}>
        <button
          type="button"
          className={`mes-view-toggle-btn${categoryFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          All types
        </button>
        <button
          type="button"
          className={`mes-view-toggle-btn${categoryFilter === 'attendance' ? ' is-active' : ''}`}
          onClick={() => setCategoryFilter('attendance')}
        >
          Attendance
        </button>
        <button
          type="button"
          className={`mes-view-toggle-btn${categoryFilter === 'inventory' ? ' is-active' : ''}`}
          onClick={() => setCategoryFilter('inventory')}
        >
          Inventory
        </button>
        <button
          type="button"
          className={`mes-view-toggle-btn${categoryFilter === 'production' ? ' is-active' : ''}`}
          onClick={() => setCategoryFilter('production')}
        >
          Production
        </button>
        <button
          type="button"
          className={`mes-view-toggle-btn${categoryFilter === 'finance' ? ' is-active' : ''}`}
          onClick={() => setCategoryFilter('finance')}
        >
          Finance
        </button>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading notifications…</p> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="Missed punch-outs, attendance, stock shortages, production delays, GIRN inspection, and invoice alerts will appear here."
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="mes-card notif-list" style={{ padding: 12 }}>
          <p className="muted" style={{ margin: '4px 8px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Priority 1 (inventory) first
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((n) => {
              const meta = TYPE_META[n.type] || { icon: UserX, label: n.type };
              const Icon = meta.icon;
              const unread = n.status === 'unread';
              const priority = Number(n.priority) || (n.category === 'inventory' ? 1 : 2);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`mes-list-item notif-row${unread ? ' is-unread' : ''}${priority === 1 ? ' is-critical' : ''}`}
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
                          <StatusBadge status={priority === 1 ? 'overdue' : 'ready'}>
                            P{priority}
                          </StatusBadge>
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
                        {n.payload?.component_label ? ` · ${n.payload.component_label}` : ''}
                        {n.payload?.due_date ? ` · due ${n.payload.due_date}` : ''}
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
