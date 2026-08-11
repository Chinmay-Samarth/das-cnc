import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/authContext';
import { useSocket } from '../../socket/socketContext';

function badgeLabel(count) {
  if (count <= 0) return null;
  if (count > 9) return '9+';
  return String(count);
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { user, hasAccess } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = hasAccess('ADMIN');
  const [count, setCount] = useState(0);

  const loadCount = useCallback(async () => {
    if (!isAdmin) {
      setCount(0);
      return;
    }
    try {
      const { data } = await api.get('/notifications/unread-count');
      setCount(Number(data.count) || 0);
    } catch {
      setCount(0);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadCount();
    if (!isAdmin) return undefined;

    const interval = setInterval(loadCount, 60000);
    const onFocus = () => loadCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAdmin, loadCount, user?.id]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    return subscribe('leave-requests:updated', () => {
      loadCount();
    });
  }, [isAdmin, subscribe, loadCount]);

  if (!isAdmin) return null;

  const label = badgeLabel(count);

  return (
    <button
      type="button"
      className="notif-bell-btn"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      onClick={() => navigate('/notifications')}
    >
      <Bell size={18} strokeWidth={1.75} />
      {label ? <span className="notif-bell-badge">{label}</span> : null}
    </button>
  );
}
