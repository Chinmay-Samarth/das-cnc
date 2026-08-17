import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { EmptyState, StatusBadge } from '../components/mes';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';

const STATUS_FILTERS = [
  { key: 'ready', label: 'Ready' },
  { key: 'awaiting_inspection', label: 'Awaiting inspection' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function statusTone(status, queueStatus) {
  if (status === 'approved') return 'COMPLETED';
  if (status === 'rejected') return 'overdue';
  if (queueStatus === 'ready') return 'READY';
  return 'pending';
}

function statusLabel(status, queueStatus) {
  if (status === 'pending_inspection') {
    return queueStatus === 'ready' ? 'Ready for approval' : 'Awaiting inspection';
  }
  return status;
}

function reviewerCell(row) {
  if (row.status === 'approved') {
    return {
      name: row.approver_name,
      at: row.approved_at,
    };
  }
  if (row.status === 'rejected') {
    return {
      name: row.rejecter_name,
      at: row.rejected_at,
    };
  }
  return { name: row.received_by_name, at: row.updated_at };
}

export default function GirnApprovalsTab({ initialStatus = 'ready' }) {
  const { subscribe } = useSocket();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [girns, setGirns] = useState([]);
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
        const { data } = await api.get('/girn-approvals', {
          params: { status: statusFilter },
        });
        setGirns(data.girns || []);
      } catch (err) {
        if (!silent) {
          setError(err.response?.data?.error || 'Unable to load GIRN approvals');
          setGirns([]);
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
    return subscribe('girn:updated', () => {
      load({ silent: true });
    });
  }, [subscribe, load]);

  async function handleApprove(row) {
    const ok = await appConfirm({
      title: 'Approve GIRN?',
      message: `${row.girn_number || 'GIRN'} from ${row.supplier_name || 'supplier'} will be approved and stock will be posted.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.post(`/girn/${row.id}/approve`);
      await appAlert({ title: 'GIRN approved', tone: 'success' });
      await load();
    } catch (err) {
      await appAlert({
        title: 'Approve failed',
        message: err.response?.data?.error || 'Could not approve GIRN',
        tone: 'danger',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(row) {
    const notes = await appPrompt({
      title: 'Reject GIRN?',
      message: `${row.girn_number || 'GIRN'} will be rejected. Add an optional reason.`,
      confirmLabel: 'Reject',
      placeholder: 'Rejection reason (optional)',
    });
    if (notes === null) return;
    setBusyId(row.id);
    try {
      await api.post(`/girn/${row.id}/reject`, { notes: notes || undefined });
      await load();
    } catch (err) {
      await appAlert({
        title: 'Reject failed',
        message: err.response?.data?.error || 'Could not reject GIRN',
        tone: 'danger',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mes-view-toggle" role="group" aria-label="Status filter" style={{ marginBottom: 16 }}>
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`mes-view-toggle-btn${statusFilter === key ? ' is-active' : ''}`}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading GIRNs…</p> : null}

      {!loading && girns.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No GIRNs in this filter"
          description={
            statusFilter === 'ready'
              ? 'GIRNs with all inspections passed will appear here for final approval.'
              : 'Nothing in this filter.'
          }
        />
      ) : null}

      {!loading && girns.length > 0 ? (
        <div className="data-table-wrap mes-card" style={{ padding: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th>GIRN</th>
                <th>Supplier</th>
                <th>Received</th>
                <th>Items</th>
                <th>Inspections</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Reviewed by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {girns.map((row) => {
                const reviewer = reviewerCell(row);
                const canAct = row.queue_status === 'ready';
                return (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/girn/${row.id}`}>{row.girn_number || '—'}</Link>
                    </td>
                    <td>{row.supplier_name || '—'}</td>
                    <td>{formatDisplayDate(row.received_date)}</td>
                    <td>{row.item_count ?? '—'}</td>
                    <td>
                      {row.inspection_total
                        ? `${row.inspection_passed}/${row.inspection_total} passed`
                        : '—'}
                    </td>
                    <td>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatDisplayDateTime(row.updated_at)}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={statusTone(row.status, row.queue_status)}>
                        {statusLabel(row.status, row.queue_status)}
                      </StatusBadge>
                    </td>
                    <td>
                      {reviewer.name ? (
                        <>
                          <div>{reviewer.name}</div>
                          {reviewer.at ? (
                            <div className="muted" style={{ fontSize: 12 }}>
                              {formatDisplayDateTime(reviewer.at)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Link to={`/girn/${row.id}`} className="mes-btn mes-btn-secondary">
                          View
                        </Link>
                        {canAct ? (
                          <>
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
                              onClick={() => handleReject(row)}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
