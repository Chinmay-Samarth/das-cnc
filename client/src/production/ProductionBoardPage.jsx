import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Package, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import {
  PageHeader,
  MetricCard,
  StatusBadge,
  EmptyState,
  TruncatedText,
  ProgressBar,
} from '../components/mes';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ProductionBoardPage() {
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const [filters, setFilters] = useState({
    from: addDays(todayStr(), -7),
    to: addDays(todayStr(), 7),
    work_center_id: '',
    status: '',
    search: '',
  });
  const [commitments, setCommitments] = useState([]);
  const [workCenters, setWorkCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = {};
        if (filters.from) params.from = filters.from;
        if (filters.to) params.to = filters.to;
        if (filters.work_center_id) params.work_center_id = filters.work_center_id;
        if (filters.status) params.status = filters.status;
        if (filters.search) params.search = filters.search;

        const { data } = await api.get('/campaigns/commitments', { params });
        setCommitments(data.commitments || []);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to load daily cards');
        setCommitments([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    api
      .get('/work-centers')
      .then(({ data }) => setWorkCenters(data.work_centers || data || []))
      .catch(() => setWorkCenters([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('production:updated', () => load({ silent: true }));
  }, [subscribe, load]);

  const metrics = useMemo(() => {
    const open = commitments.filter((c) =>
      ['open', 'READY', 'RUNNING', 'OVERDUE'].includes(c.card_status || c.status)
    ).length;
    const met = commitments.filter((c) =>
      ['COMPLETED', 'closed', 'met'].includes(c.card_status || c.status)
    ).length;
    const closed = met;
    const remaining = commitments.reduce(
      (sum, c) => sum + Math.max(0, Number(c.committed_qty || 0) - Number(c.good_qty || 0)),
      0
    );
    return { open, met, closed, remaining };
  }, [commitments]);

  function handleFilterChange(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <main className="mes-shell">
      <PageHeader
        title="Production"
        subtitle="Campaign daily cards"
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <div className="mes-filters" style={{ marginBottom: 16 }}>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => handleFilterChange('from', e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(e) => handleFilterChange('to', e.target.value)}
          />
        </label>
        <label>
          Work center
          <select
            value={filters.work_center_id}
            onChange={(e) => handleFilterChange('work_center_id', e.target.value)}
          >
            <option value="">All work centers</option>
            {workCenters.map((wc) => (
              <option key={wc.id} value={wc.id}>
                {wc.code ? `${wc.code} â€” ` : ''}
                {wc.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="READY">Ready</option>
            <option value="RUNNING">Running</option>
            <option value="COMPLETED">Completed</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            placeholder="Component, campaignâ€¦"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      <div className="mes-metric-grid" style={{ marginBottom: 16 }}>
        <MetricCard label="Open" value={metrics.open} icon={AlertCircle} tone="amber" />
        <MetricCard label="Met" value={metrics.met} icon={CheckCircle2} tone="success" />
        <MetricCard label="Remaining good" value={metrics.remaining} icon={Package} tone="info" />
        <MetricCard label="Closed" value={metrics.closed} icon={XCircle} tone="neutral" />
      </div>

      {loading && !commitments.length ? (
        <p className="muted">Loading daily cardsâ€¦</p>
      ) : !commitments.length ? (
        <EmptyState
          icon={Package}
          title="No daily cards"
          description="Release campaigns in Horizon Planner to create daily production cards for work centers."
          actionLabel="Open Horizon Planner"
          onAction={() => navigate('/production/horizon-planner')}
        />
      ) : (
        <div className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>WC</th>
                  <th>Component</th>
                  <th>Card</th>
                  <th>Target</th>
                  <th>Good</th>
                  <th>Scrap</th>
                  <th>Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {commitments.map((c) => {
                  const remaining = Math.max(
                    0,
                    Number(c.committed_qty || 0) - Number(c.good_qty || 0)
                  );
                  const progress =
                    c.committed_qty > 0 ? (c.good_qty / c.committed_qty) * 100 : 0;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/production/cards/${c.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{c.work_date || 'â€”'}</td>
                      <td>
                        <TruncatedText>
                          {c.work_center_code || c.work_center_name || 'â€”'}
                        </TruncatedText>
                      </td>
                      <td>
                        <TruncatedText>{c.component_label || 'â€”'}</TruncatedText>
                      </td>
                      <td>{c.card_number || 'â€”'}</td>
                      <td>{c.committed_qty}</td>
                      <td>
                        <div style={{ minWidth: 80 }}>
                          <ProgressBar value={progress} />
                          <span className="muted" style={{ fontSize: 12 }}>
                            {c.good_qty}
                          </span>
                        </div>
                      </td>
                      <td>{c.scrap_qty}</td>
                      <td>{remaining}</td>
                      <td>
                        <StatusBadge status={c.card_status || c.status}>
                          {c.card_status || c.status}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
