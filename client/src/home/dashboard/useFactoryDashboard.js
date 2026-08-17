import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { useSocket } from '../../socket/socketContext';

const EVENTS = [
  'attendance:updated',
  'production:updated',
  'inventory:updated',
  'leave-requests:updated',
  'dispatch-shortfall:updated',
  'girn:updated',
];

export default function useFactoryDashboard() {
  const { subscribe, connected } = useSocket();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { data: payload } = await api.get('/admin/factory-dashboard');
      setData(payload);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.error || 'Unable to load factory dashboard');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubs = EVENTS.map((event) =>
      subscribe(event, () => {
        load({ silent: true });
      })
    );
    return () => unsubs.forEach((fn) => fn?.());
  }, [subscribe, load, connected]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, loading, error, reload: load };
}
