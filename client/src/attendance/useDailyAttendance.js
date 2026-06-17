import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

export function toDisplayTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toISODateString(date) {
  return new Date(date).toLocaleDateString('en-CA');
}

export default function useDailyAttendance(initialDate = null) {
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // queryDate is the date string (YYYY-MM-DD) used for API queries.
  const [queryDate, setQueryDate] = useState(initialDate);
  const mountedRef = useRef(true);

  const loadDailyAttendance = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const url = '/attendance/daily';
      const params = queryDate ? { params: { date: queryDate } } : {};
      const { data } = await api.get(url, params);

      if (!mountedRef.current) return;
      setDaily(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err?.response?.data?.error || 'Failed to load attendance dashboard.');
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, [queryDate]);

  useEffect(() => {
    mountedRef.current = true;
    loadDailyAttendance();

    return () => {
      mountedRef.current = false;
    };
  }, [loadDailyAttendance]);

  const absentees = useMemo(() => {
    const records = daily?.records || [];
    return records.filter((row) => row.status === 'ABSENT');
  }, [daily]);

  const latestRecords = useMemo(() => {
    const records = daily?.records || [];
    return records
      .filter((row) => row.local_in || row.local_out)
      .sort((a, b) => {
        const aTime = new Date(a.local_out || a.local_in || 0).getTime();
        const bTime = new Date(b.local_out || b.local_in || 0).getTime();
        return bTime - aTime;
      });
  }, [daily]);

  return {
    daily,
    loading,
    error,
    // setter to allow components to change which date is queried
    setDate: setQueryDate,
    refresh: loadDailyAttendance,
    absentees,
    latestRecords,
    presentCount: daily?.summary?.present ?? 0,
    absentCount: daily?.summary?.absent ?? 0,
    totalCount: daily?.summary?.total ?? 0,
  };
}
