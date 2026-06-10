import { useEffect, useMemo, useState } from 'react';
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

export default function useDailyAttendance(initialDate = null) {
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // queryDate is the date string (YYYY-MM-DD) used for API queries.
  const [queryDate, setQueryDate] = useState(initialDate);

  useEffect(() => {
    let mounted = true;

    async function loadDailyAttendance() {
      try {
        setLoading(true);
        setError('');

        // include date query param only when queryDate is set
        const url = queryDate ? '/attendance/daily' : '/attendance/daily';
        const params = queryDate ? { params: { date: queryDate } } : {};

        const { data } = await api.get(url, params);
        if (!mounted) return;
        setDaily(data);
      } catch (err) {
        if (!mounted) return;
        setError(err?.response?.data?.error || 'Failed to load attendance dashboard.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadDailyAttendance();
    return () => {
      mounted = false;
    };
  }, [queryDate]);

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
    absentees,
    latestRecords,
    presentCount: daily?.summary?.present ?? 0,
    absentCount: daily?.summary?.absent ?? 0,
    totalCount: daily?.summary?.total ?? 0,
  };
}
