import { useCallback, useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { EmptyState, StatusBadge, TruncatedText } from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';

function statusTone(status) {
  if (status === 'approved' || status === 'consumed') return 'COMPLETED';
  if (status === 'denied' || status === 'cancelled') return 'overdue';
  return 'READY';
}

export default function DispatchShortfallTab({ initialStatus = 'pending' }) {
  const { subscribe } = useSocket();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    setStatusFilter(initialStatus);
  }, [initialStatus]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const { data } = await api.get('/dispatch-shortfall-approvals', {
          params: { status: statusFilter },
        });
        setRequests(data.requests || []);
      } catch (err) {
        if (!silent) {
          setError(err.response?.data?.error || 'Unable to load shortfall requests');
          setRequests([]);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [statusFilter]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('dispatch-shortfall:updated', () => {
      load({ silent: true });
    });
  }, [subscribe, load]);

  async function handleApprove(row) {
    const ok = await appConfirm({
      title: 'Approve shortfall dispatch?',
      message: `Lot ${row.lot_number || '—'}: ship ${Number(row.lot_qty)} against schedule ${Number(
        row.schedule_qty
      )}. Remaining schedule demand stays open for future lots.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.post(`/dispatch-shortfall-approvals/${row.id}/approve`);
      await appAlert({ title: 'Shortfall approved', tone: 'success' });
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
      title: 'Deny shortfall?',
      message: `Lot ${row.lot_number || '—'} will remain blocked until a new request is approved.`,
      confirmLabel: 'Deny',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.post(`/dispatch-shortfall-approvals/${row.id}/deny`);
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
        {['pending', 'approved', 'denied', 'consumed', 'all'].map((s) => (
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
          icon={PackageCheck}
          title="No shortfall requests"
          description={
            statusFilter === 'pending'
              ? 'Shortfall dispatch requests from Ready for Dispatch will appear here.'
              : 'Nothing in this filter.'
          }
        />
      ) : null}

      {!loading && requests.length > 0 ? (
        <div className="data-table-wrap mes-card" style={{ padding: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Component</th>
                <th>Lot qty</th>
                <th>Schedule qty</th>
                <th>Reason</th>
                <th>Requested by</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.lot_number || '—'}</div>
                    {row.schedule_number ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {row.schedule_number}
                        {row.schedule_due_date
                          ? ` · due ${formatDisplayDate(row.schedule_due_date)}`
                          : ''}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ maxWidth: 180 }}>
                    <TruncatedText>{row.component_label || '—'}</TruncatedText>
                  </td>
                  <td>{Number(row.lot_qty)}</td>
                  <td>{Number(row.schedule_qty)}</td>
                  <td style={{ maxWidth: 220 }}>
                    <TruncatedText>{row.reason}</TruncatedText>
                    {row.review_note ? (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Note: {row.review_note}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div>{row.requester_name || '—'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatDisplayDateTime(row.created_at)}
                    </div>
                  </td>
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
