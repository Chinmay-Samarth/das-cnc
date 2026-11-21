import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  FileText,
  PackagePlus,
  Receipt,
  Wallet,
} from 'lucide-react';
import api from '../../api/client';
import { useSocket } from '../../socket/socketContext';
import { EmptyState, Skeleton } from '../../components/mes';

const MAX_ITEMS = 40;
const ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;
const OPENED_STORAGE_KEY = 'das-admin-activity-opened-v1';

function isWithinTtl(iso, now = Date.now()) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= ACTIVITY_TTL_MS;
}

function pruneExpired(items, now = Date.now()) {
  return (items || []).filter((row) => isWithinTtl(row.created_at, now));
}

function readOpenedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_STORAGE_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const next = {};
    for (const [id, iso] of Object.entries(raw)) {
      if (isWithinTtl(iso, now)) next[id] = iso;
    }
    return next;
  } catch {
    return {};
  }
}

function writeOpenedMap(map) {
  try {
    localStorage.setItem(OPENED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

const EVENT_META = {
  purchase_invoice_published: {
    label: 'Purchase',
    accent: 'purchase',
    Icon: FileText,
  },
  girn_uploaded: {
    label: 'GIRN',
    accent: 'girn',
    Icon: PackagePlus,
  },
  sales_invoice_issued: {
    label: 'Sales',
    accent: 'sales',
    Icon: Receipt,
  },
  purchase_payment_updated: {
    label: 'Payment',
    accent: 'payment',
    Icon: Wallet,
  },
  job_card_completed: {
    label: 'Job card',
    accent: 'job',
    Icon: CheckCircle2,
  },
};

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

function metaFor(type) {
  return (
    EVENT_META[type] || {
      label: 'Update',
      accent: 'default',
      Icon: FileText,
    }
  );
}

export default function LiveActivityPanel() {
  const navigate = useNavigate();
  const { subscribe, connected } = useSocket();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [openedMap, setOpenedMap] = useState(readOpenedMap);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data } = await api.get('/admin/activity-feed', {
        params: { limit: MAX_ITEMS },
      });
      setItems(pruneExpired(Array.isArray(data?.items) ? data.items : []));
      setOpenedMap(readOpenedMap());
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setItems((prev) => pruneExpired(prev));
      setOpenedMap((prev) => {
        const next = {};
        const now = Date.now();
        for (const [oid, iso] of Object.entries(prev)) {
          if (isWithinTtl(iso, now)) next[oid] = iso;
        }
        writeOpenedMap(next);
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const unsub = subscribe('activity:created', (row) => {
      if (!row?.id || !isWithinTtl(row.created_at)) return;
      setItems((prev) => {
        const fresh = pruneExpired(prev);
        if (fresh.some((x) => x.id === row.id)) return fresh;
        return [row, ...fresh].slice(0, MAX_ITEMS);
      });
      setFlashIds((prev) => {
        const next = new Set(prev);
        next.add(row.id);
        return next;
      });
      window.setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }, 1200);
    });
    return () => unsub?.();
  }, [subscribe, connected]);

  function markOpened(row) {
    if (!row?.id) return;
    setSelectedId(row.id);
    setOpenedMap((prev) => {
      const next = {
        ...prev,
        [row.id]: row.created_at || new Date().toISOString(),
      };
      writeOpenedMap(next);
      return next;
    });
  }

  function handleOpen(row) {
    if (!row?.href) return;
    markOpened(row);
    navigate(row.href);
  }

  if (loading) {
    return (
      <div className="mes-activity" aria-busy="true">
        <div className="mes-activity-toolbar">
          <Skeleton width={72} height={22} radius={999} />
        </div>
        <div className="mes-activity-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mes-activity-row is-skeleton">
              <Skeleton width={36} height={36} radius={10} />
              <div className="mes-activity-copy">
                <Skeleton width="45%" height={12} />
                <Skeleton width="70%" height={10} />
              </div>
              <Skeleton width={48} height={10} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState title="Activity unavailable" description={error} />
    );
  }

  return (
    <div className="mes-activity">
      <div className="mes-activity-toolbar">
        <span
          className={`mes-activity-live${connected ? ' is-on' : ''}`}
          title={connected ? 'Receiving live updates' : 'Reconnecting…'}
        >
          <span className="mes-activity-live-dot" aria-hidden="true" />
          {connected ? 'Live' : 'Reconnecting'}
        </span>
        <span className="mes-activity-count muted">
          {items.length ? `${items.length} recent` : 'No events yet'}
        </span>
      </div>

      {!items.length ? (
        <EmptyState
          title="No activity yet"
          description="Updates from the last 24 hours appear here in real time, then expire automatically."
        />
      ) : (
        <ul className="mes-activity-list">
          {items.map((row) => {
            const meta = metaFor(row.event_type);
            const Icon = meta.Icon;
            const clickable = Boolean(row.href);
            const isOpened = Boolean(openedMap[row.id]);
            const isSelected = selectedId === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={`mes-activity-row accent-${meta.accent}${
                    flashIds.has(row.id) ? ' is-new' : ''
                  }${clickable ? '' : ' is-static'}${
                    !isOpened ? ' is-unread' : ' is-opened'
                  }${isSelected ? ' is-selected' : ''}`}
                  onClick={() => handleOpen(row)}
                  disabled={!clickable}
                  aria-pressed={isSelected}
                >
                  <span className="mes-activity-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="mes-activity-copy">
                    <span className="mes-activity-title-row">
                      <strong>{row.title}</strong>
                      <span className="mes-activity-chip">{meta.label}</span>
                    </span>
                    {row.body ? <span className="mes-activity-body">{row.body}</span> : null}
                    <span className="mes-activity-actor">
                      {row.actor_name || 'System'}
                    </span>
                  </span>
                  <time className="mes-activity-time" dateTime={row.created_at}>
                    {relativeTime(row.created_at)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
