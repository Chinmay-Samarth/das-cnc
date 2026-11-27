import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
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
  PackageCheck,
  ShoppingCart,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { PageHeader, EmptyState, Skeleton, SlidingPillBar } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import { useSocket } from '../socket/socketContext';

const TYPE_META = {
  open_punch_out: { icon: LogOut, label: 'Missing punch-out', category: 'attendance' },
  low_attendance: { icon: Percent, label: 'Attendance %', category: 'attendance' },
  consecutive_absent: { icon: CalendarX2, label: 'Absence streak', category: 'attendance' },
  leave_request_pending: { icon: CalendarOff, label: 'Leave request', category: 'attendance' },
  dispatch_shortfall_pending: {
    icon: PackageCheck,
    label: 'Dispatch shortfall',
    category: 'production',
  },
  insufficient_stock: { icon: PackageX, label: 'Stock short', category: 'inventory' },
  reorder_purchase_required: { icon: ShoppingCart, label: 'Reorder purchase', category: 'inventory' },
  predictive_reorder: { icon: ShoppingCart, label: 'Predictive reorder', category: 'inventory' },
  tool_life_low: { icon: Wrench, label: 'Tool life low', category: 'inventory' },
  girn_pending_inspection: { icon: ClipboardCheck, label: 'GIRN inspection', category: 'inventory' },
  girn_ready_for_approval: { icon: ClipboardCheck, label: 'GIRN approval', category: 'inventory' },
  girn_approved: { icon: ClipboardCheck, label: 'GIRN approved', category: 'inventory' },
  invoice_overdue: { icon: FileText, label: 'Invoice overdue', category: 'finance' },
  purchase_invoice_overdue: { icon: FileText, label: 'Purchase due', category: 'finance' },
  purchase_invoice_tally_unsynced: { icon: FileText, label: 'Purchase Tally sync', category: 'finance' },
  sales_invoice_tally_unsynced: { icon: FileText, label: 'Sales Tally sync', category: 'finance' },
  rm_rate_increase: { icon: FileText, label: 'RM rate increase', category: 'finance' },
  op1_schedule_delay: { icon: Timer, label: 'Op1 delay', category: 'production' },
  outsource_lead_delay: { icon: Truck, label: 'Outsource delay', category: 'production' },
  horizon_wave_renewed: { icon: Waves, label: 'Wave renew', category: 'production' },
  horizon_wave_stuck: { icon: Factory, label: 'Wave stuck', category: 'production' },
};

const FOCUS_TYPES = new Set(['purchase_invoice_overdue', 'invoice_overdue', 'open_punch_out']);
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

function notificationPriority(n) {
  return Number(n.priority) || (n.category === 'inventory' ? 1 : 2);
}

function sortNotifications(list) {
  return [...list].sort((a, b) => {
    const focusA = FOCUS_TYPES.has(a.type) ? 0 : 1;
    const focusB = FOCUS_TYPES.has(b.type) ? 0 : 1;
    if (focusA !== focusB) return focusA - focusB;
    const pa = notificationPriority(a);
    const pb = notificationPriority(b);
    if (pa !== pb) return pa - pb;
    const sa = SEVERITY_RANK[a.severity] ?? 9;
    const sb = SEVERITY_RANK[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function limitWords(text, max = 10) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ')}…`;
}

function formatStockRemaining(qty) {
  if (qty == null || qty === '') return '';
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** One short informative line for the tile (max ~12 words, with concrete ids/dates). */
function tileSummary(n) {
  const p = n.payload || {};
  const person = p.employee_name || p.employee_code || '';
  const bodySupplier = String(n.body || '').match(/^(.+?)\s+[—-]/)?.[1]?.trim() || '';
  const supplier = p.supplier_name || p.vendor_name || bodySupplier || '';
  const due = p.due_date || '';
  const shiftDate = p.shift_date || '';
  const component = p.component_label || p.item_label || p.label || '';
  const onHand = formatStockRemaining(p.on_hand_qty);
  const unit = p.unit ? ` ${p.unit}` : '';

  let line = '';
  if (n.type === 'open_punch_out') {
    const dateLabel = shiftDate ? formatDisplayDate(shiftDate) : '';
    line = person
      ? `${person} · Missing punch-out${dateLabel ? ` · ${dateLabel}` : ''}`
      : `Missing punch-out${dateLabel ? ` · ${dateLabel}` : ''}`;
  } else if (n.type === 'purchase_invoice_overdue' || n.type === 'invoice_overdue') {
    const dateLabel = due ? formatDisplayDate(due) : '';
    const label = TYPE_META[n.type]?.label || 'Invoice overdue';
    line = supplier
      ? `${supplier} · ${label}${dateLabel ? ` · ${dateLabel}` : ''}`
      : `${label}${dateLabel ? ` · ${dateLabel}` : ''}`;
  } else if (n.type === 'purchase_invoice_tally_unsynced' || n.type === 'sales_invoice_tally_unsynced') {
    const label = TYPE_META[n.type]?.label || 'Tally sync';
    line = supplier ? `${supplier} · ${label}` : label;
  } else if (n.type === 'rm_rate_increase') {
    const prev = p.previous_rate != null ? Number(p.previous_rate) : null;
    const next = p.new_rate != null ? Number(p.new_rate) : null;
    const rateBit =
      Number.isFinite(prev) && Number.isFinite(next)
        ? ` · ₹${prev} → ₹${next}`
        : '';
    line = supplier ? `${supplier} · RM rate up${rateBit}` : `RM rate increased${rateBit}`;
  } else if (n.type === 'insufficient_stock' || n.type === 'reorder_purchase_required' || n.type === 'predictive_reorder') {
    if (component && onHand !== '') {
      line = `${component} · ${onHand}${unit} left`;
    } else if (component) {
      line = `Stock alert: ${component}`;
    } else {
      line = limitWords(n.title || n.body || 'Stock alert', 12);
    }
  } else if (n.type === 'girn_pending_inspection' || n.type === 'girn_ready_for_approval' || n.type === 'girn_approved') {
    const girn = p.girn_number || p.girn_id || '';
    line = girn ? `GIRN ${girn}: ${TYPE_META[n.type]?.label || 'update'}` : TYPE_META[n.type]?.label || 'GIRN alert';
  } else if (n.title) {
    line = n.title;
  } else if (n.body) {
    line = n.body;
  } else {
    line = TYPE_META[n.type]?.label || 'Alert';
  }
  return limitWords(line, 12);
}

function navigateForNotification(navigate, n) {
  const p = n.payload || {};

  if (n.type === 'open_punch_out') {
    const empId = p.employee_id || n.employee_id;
    const date = p.shift_date || '';
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (empId) qs.set('highlightEmployee', empId);
    navigate(qs.toString() ? `/attendance?${qs}` : '/attendance');
    return;
  }

  if (
    n.type === 'insufficient_stock' ||
    n.type === 'reorder_purchase_required' ||
    n.type === 'predictive_reorder'
  ) {
    const masterId = p.master_record_id;
    navigate(
      masterId
        ? `/purchase-orders?highlightMaster=${encodeURIComponent(masterId)}`
        : '/purchase-orders'
    );
    return;
  }

  if (n.type === 'op1_schedule_delay') {
    const cardId = p.parent_card_id;
    const qs = new URLSearchParams();
    if (cardId) qs.set('highlightCard', cardId);
    if (p.card_number) qs.set('card', p.card_number);
    navigate(qs.toString() ? `/production?${qs}` : '/production');
    return;
  }

  if (n.type === 'purchase_invoice_overdue') {
    const invId = p.invoice_id;
    const qs = new URLSearchParams();
    if (invId) qs.set('highlightInvoice', invId);
    if (p.supplier_id) qs.set('supplierId', p.supplier_id);
    navigate(qs.toString() ? `/purchase-payments?${qs}` : '/purchase-payments');
    return;
  }

  if (n.type === 'leave_request_pending') {
    navigate('/leave-requests?status=pending');
    return;
  }
  if (n.type === 'dispatch_shortfall_pending') {
    navigate('/approvals?tab=dispatch&status=pending');
    return;
  }
  if (n.type === 'girn_ready_for_approval') {
    navigate('/approvals?tab=girn&status=ready');
    return;
  }
  if (n.type === 'girn_approved') {
    navigate(p.girn_id ? `/girn/${p.girn_id}` : '/girn');
    return;
  }
  if (n.type === 'girn_pending_inspection') {
    navigate('/approvals?tab=girn&status=awaiting_inspection');
    return;
  }
  if (n.employee_id) {
    navigate(`/employees/${n.employee_id}`);
    return;
  }
  if (n.type === 'outsource_lead_delay') {
    navigate('/production/outsource');
    return;
  }
  if (n.type === 'horizon_wave_renewed' || n.type === 'horizon_wave_stuck') {
    navigate('/production/horizon-planner');
    return;
  }
  if (n.category === 'inventory') {
    navigate('/delivery-schedules');
    return;
  }
  if (n.category === 'finance' || n.type === 'invoice_overdue') {
    if (n.type === 'rm_rate_increase') {
      if (p.href) {
        navigate(p.href);
        return;
      }
      const recordId = p.master_record_id;
      navigate(
        recordId
          ? `/masters/raw-material/records/${recordId}?tab=commercials`
          : '/masters/raw-material'
      );
      return;
    }
    if (n.type === 'purchase_invoice_tally_unsynced') {
      const invId = p.invoice_id;
      navigate(invId ? `/invoices/${invId}` : '/invoices');
      return;
    }
    if (p.path) {
      navigate(p.path);
      return;
    }
    const invId = p.sales_invoice_id || p.invoice_id;
    navigate(invId ? `/sales-invoices/${invId}` : '/sales-invoices?tab=due');
    return;
  }
  if (n.category === 'production') {
    navigate('/production/horizon-planner');
  }
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasAccess, isAdmin: authIsAdmin, defaultHomePath } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = authIsAdmin() || hasAccess('ADMIN');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewTab, setViewTab] = useState(() => {
    const tab = searchParams.get('tab');
    if (tab === 'opened') return 'opened';
    if (tab === 'all') return 'all';
    return 'unread';
  });
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') || 'all');
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
      const params = { limit: 200 };
      if (viewTab === 'opened') params.status = 'read';
      else if (viewTab === 'unread') params.status = 'unread';
      // viewTab === 'all' → omit status (API returns unread + read)
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
  }, [isAdmin, viewTab, categoryFilter]);

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

  const totalCount = items.length;

  async function handleMarkAllRead() {
    if (!isAdmin || viewTab !== 'unread') return;
    const ok = await appConfirm({
      title: 'Mark all as read?',
      message: 'Unread alerts move to the Opened tab.',
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

  async function handleDeleteAllOpened() {
    if (!isAdmin || viewTab !== 'opened') return;
    const ok = await appConfirm({
      title: 'Delete all opened?',
      message: 'This permanently deletes every opened notification. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete all',
    });
    if (!ok) return;
    try {
      await api.post('/notifications/delete-opened');
      setItems([]);
      await load();
    } catch (err) {
      await appAlert({
        title: 'Could not delete',
        message: err.response?.data?.error || 'Delete all opened failed',
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
        setItems((prev) => prev.filter((x) => x.id !== n.id));
      }
      navigateForNotification(navigate, n);
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
    return <Navigate to={defaultHomePath()} replace />;
  }

  function renderRow(n) {
    const meta = TYPE_META[n.type] || { icon: UserX, label: n.type };
    const Icon = meta.icon;
    const summary = tileSummary(n);
    const priority = notificationPriority(n);
    const isPunch = n.type === 'open_punch_out';
    const isFinance =
      n.category === 'finance' ||
      n.type === 'purchase_invoice_overdue' ||
      n.type === 'invoice_overdue' ||
      n.type === 'purchase_invoice_tally_unsynced' ||
      n.type === 'sales_invoice_tally_unsynced' ||
      n.type === 'rm_rate_increase';
    const isDue =
      n.type === 'purchase_invoice_overdue' || n.type === 'invoice_overdue';

    let chipName = '';
    let chipLabel = '';
    let chipDate = '';
    if (isPunch) {
      chipName = n.payload?.employee_name || n.payload?.employee_code || '';
      chipLabel = 'Missing punch-out';
      chipDate = n.payload?.shift_date ? formatDisplayDate(n.payload.shift_date) : '';
    } else if (isFinance) {
      chipName =
        n.payload?.supplier_name ||
        n.payload?.vendor_name ||
        n.payload?.customer_name ||
        '';
      chipLabel = meta.label || 'Accounting alert';
      chipDate = n.payload?.due_date ? formatDisplayDate(n.payload.due_date) : '';
    }
    const useChipTitle = isPunch || isFinance;

    return (
      <button
        key={n.id}
        type="button"
        className={`notif-row is-compact${n.status === 'unread' ? ' is-unread' : ''}${
          priority === 1 ? ' is-critical' : ''
        }${isPunch ? ' is-punch' : ''}${isDue ? ' is-due' : ''}`}
        onClick={() => handleOpen(n)}
        disabled={busyId === n.id}
        title={n.body || n.title || summary}
      >
        <div className="notif-row-main">
          <span className={`notif-type-icon notif-sev-${n.severity || 'warning'}`} aria-hidden>
            <Icon size={14} />
          </span>
          <div className="notif-row-copy">
            {useChipTitle ? (
              <span className="notif-row-title notif-chip-title">
                {chipName ? <span className="notif-chip-name">{chipName}</span> : null}
                <span className="notif-chip-label">{chipLabel}</span>
                {chipDate ? <span className="notif-chip-date">{chipDate}</span> : null}
              </span>
            ) : (
              <span className="notif-row-title">{summary}</span>
            )}
            <span className="notif-row-meta">{relativeTime(n.created_at)}</span>
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
          <X size={14} />
        </span>
      </button>
    );
  }

  return (
    <div className="mes-shell notif-page">
      <PageHeader
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
            {viewTab === 'unread' ? (
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={handleMarkAllRead}
                disabled={totalCount === 0}
              >
                <CheckCheck size={15} />
                Mark all read
              </button>
            ) : null}
            {viewTab === 'opened' ? (
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={handleDeleteAllOpened}
                disabled={totalCount === 0}
              >
                <Trash2 size={15} />
                Delete all
              </button>
            ) : null}
          </>
        }
      />

      {settingsOpen ? (
        <form className="mes-card notif-settings" onSubmit={handleSaveSettings}>
          <h3 className="mes-section-title" style={{ marginTop: 0, fontSize: 15 }}>
            Attendance threshold
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexDirection: 'row' }}>
            <label className="notif-settings-field">Threshold %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={threshold}
              style={{ width: '50%' }}
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

      <div className="notif-toolbar">
        <SlidingPillBar className="mes-view-toggle" role="group" aria-label="Inbox tab">
          <button
            type="button"
            className={`mes-view-toggle-btn${viewTab === 'unread' ? ' is-active' : ''}`}
            onClick={() => setViewTab('unread')}
          >
            Unread
          </button>
          <button
            type="button"
            className={`mes-view-toggle-btn${viewTab === 'opened' ? ' is-active' : ''}`}
            onClick={() => setViewTab('opened')}
          >
            Opened
          </button>
          <button
            type="button"
            className={`mes-view-toggle-btn${viewTab === 'all' ? ' is-active' : ''}`}
            onClick={() => setViewTab('all')}
          >
            All
          </button>
        </SlidingPillBar>
        <SlidingPillBar className="mes-view-toggle" role="group" aria-label="Category filter">
          {[
            ['all', 'All types'],
            ['attendance', 'Attendance'],
            ['inventory', 'Inventory'],
            ['production', 'Production'],
            ['finance', 'Accounting'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`mes-view-toggle-btn${categoryFilter === value ? ' is-active' : ''}`}
              onClick={() => setCategoryFilter(value)}
            >
              {label}
            </button>
          ))}
        </SlidingPillBar>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {loading ? (
        <div className="notif-list-clean notif-skeleton" role="status" aria-label="Loading notifications">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="notif-row is-compact notif-skeleton-row">
              <div className="notif-row-main">
                <Skeleton className="skeleton-circle" width={28} height={28} radius={8} />
                <div className="notif-row-copy" style={{ gap: 6, display: 'flex', flexDirection: 'column' }}>
                  <Skeleton height={12} width={i % 2 === 0 ? '58%' : '46%'} radius={6} />
                  <Skeleton height={10} width={72} radius={6} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && totalCount === 0 ? (
        <EmptyState
          icon={Bell}
          title={
            viewTab === 'unread'
              ? 'No unread alerts'
              : viewTab === 'opened'
                ? 'No opened alerts'
                : 'No alerts'
          }
        />
      ) : null}

      {!loading && totalCount > 0 ? (
        <div className="notif-list-clean">{items.map(renderRow)}</div>
      ) : null}
    </div>
  );
}
