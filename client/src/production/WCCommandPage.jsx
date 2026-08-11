import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import { useSocket } from '../socket/socketContext';
import { PageHeader, MetricCard, StatusBadge, EmptyState } from '../components/mes';
import { appAlert } from '../components/dialog';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function WCCommandPage() {
  const { id: workCenterId } = useParams();
  const { subscribe } = useSocket();
  const [workDate, setWorkDate] = useState(todayStr());
  const [command, setCommand] = useState(null);
  const [coverage, setCoverage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [postForm, setPostForm] = useState({ good_qty: '', scrap_qty: '' });
  const [postBusy, setPostBusy] = useState(false);
  const [effForm, setEffForm] = useState({ employee_id: '', efficiency_pct: '', notes: '' });

  const load = useCallback(async () => {
    if (!workCenterId) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: cmd }, { data: cov }] = await Promise.all([
        api.get(`/campaigns/work-centers/${workCenterId}/command`, { params: { work_date: workDate } }),
        api.get(`/campaigns/work-centers/${workCenterId}/coverage`),
      ]);
      setCommand(cmd);
      setCoverage(cov.entries || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load WC command');
      setCommand(null);
    } finally {
      setLoading(false);
    }
  }, [workCenterId, workDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('production:updated', () => load());
  }, [subscribe, load]);

  async function handlePost(e) {
    e.preventDefault();
    const commit = command?.today_commitment;
    if (!commit?.id) return;
    setPostBusy(true);
    try {
      await api.post(`/campaigns/commitments/${commit.id}/progress`, {
        good_qty: postForm.good_qty !== '' ? Number(postForm.good_qty) : undefined,
        scrap_qty: postForm.scrap_qty !== '' ? Number(postForm.scrap_qty) : undefined,
      });
      setPostForm({ good_qty: '', scrap_qty: '' });
      await load();
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Post failed');
    } finally {
      setPostBusy(false);
    }
  }

  async function handleCloseDay() {
    const commit = command?.today_commitment;
    if (!commit?.id) return;
    try {
      await api.post(`/campaigns/commitments/${commit.id}/close`);
      await appAlert({ title: 'Day closed', tone: 'success' });
      await load();
    } catch (err) {
      if (err.response?.data?.ot_required) {
        await appAlert({
          title: 'OT required',
          message: err.response.data.error,
          tone: 'warning',
        });
      } else {
        await appAlert(err.response?.data?.error || 'Close failed');
      }
    }
  }

  async function handleEfficiency(e) {
    e.preventDefault();
    if (!effForm.employee_id) return;
    const managerId = command?.work_center?.manager_employee_id;
    const isManager = !!managerId && effForm.employee_id === managerId;
    try {
      await api.post('/campaigns/efficiency', {
        work_center_id: workCenterId,
        work_date: workDate,
        employee_id: effForm.employee_id,
        efficiency_pct: isManager
          ? Number(command?.efficiency_index_pct ?? 0)
          : Number(effForm.efficiency_pct),
        notes: isManager
          ? 'Derived from day efficiency index'
          : effForm.notes || undefined,
      });
      setEffForm({ employee_id: '', efficiency_pct: '', notes: '' });
      await load();
    } catch (err) {
      await appAlert(err.response?.data?.error || 'Efficiency save failed');
    }
  }

  const wc = command?.work_center;
  const camp = command?.active_campaign;
  const commit = command?.today_commitment;
  const pct =
    commit && commit.committed_qty > 0
      ? Math.round((commit.good_qty / commit.committed_qty) * 100)
      : 0;

  return (
    <div className="page-content">
      <PageHeader
        title={wc ? `${wc.code} — WC Command` : 'WC Command'}
        subtitle="Manager-only production posting · no worker qty logging"
        actions={
          <Link to="/production/horizon-planner" className="mes-btn">
            Horizon Planner
          </Link>
        }
      />

      <div className="mes-filters" style={{ marginBottom: 16 }}>
        <label>
          Work date
          <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </label>
      </div>

      {error ? <p className="error-message">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !camp ? (
        <EmptyState
          title="No active campaign"
          message="Lock a horizon wave in the planner to start production on this work center."
        />
      ) : null}

      {camp ? (
        <>
          <div className="mes-metrics-row" style={{ marginBottom: 16 }}>
            <MetricCard label="Active campaign" value={camp.component_label || 'Component'} />
            <MetricCard
              label="Campaign progress"
              value={`${camp.good_quantity} / ${camp.target_quantity}`}
            />
            <MetricCard label="Horizon rank" value={`#${camp.demand_rank}`} />
            {commit ? (
              <MetricCard label="Today commitment" value={`${commit.good_qty} / ${commit.committed_qty} (${pct}%)`} />
            ) : null}
          </div>

          {commit?.status === 'ot_required' ? (
            <p className="error-message" style={{ marginBottom: 12 }}>
              OT required — post remaining good before closing the day.
            </p>
          ) : null}

          {commit ? (
            <form className="mes-card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handlePost}>
              <h3 style={{ margin: '0 0 12px' }}>Post good / scrap (manager)</h3>
              <div className="mes-filters">
                <label>
                  Good qty
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={postForm.good_qty}
                    onChange={(e) => setPostForm((f) => ({ ...f, good_qty: e.target.value }))}
                  />
                </label>
                <label>
                  Scrap qty
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={postForm.scrap_qty}
                    onChange={(e) => setPostForm((f) => ({ ...f, scrap_qty: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" className="mes-btn mes-btn-primary" disabled={postBusy}>
                  Post
                </button>
                {commit.status !== 'closed' ? (
                  <button type="button" className="mes-btn" onClick={handleCloseDay}>
                    Close day
                  </button>
                ) : (
                  <StatusBadge status="closed" label="Day closed" />
                )}
              </div>
            </form>
          ) : null}

          <form className="mes-card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleEfficiency}>
            <h3 style={{ margin: '0 0 12px' }}>Worker efficiency (manager)</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
              Selecting the WC manager auto-fills % from today’s efficiency index
              {command?.efficiency_index_pct != null
                ? ` (${command.efficiency_index_pct}%)`
                : ''}
              .
            </p>
            <div className="mes-filters">
              <label>
                Employee
                <select
                  value={effForm.employee_id}
                  onChange={(e) => {
                    const employeeId = e.target.value;
                    const managerId = command?.work_center?.manager_employee_id;
                    const isManager = !!managerId && employeeId === managerId;
                    setEffForm((f) => ({
                      ...f,
                      employee_id: employeeId,
                      efficiency_pct: isManager
                        ? String(command?.efficiency_index_pct ?? 0)
                        : f.efficiency_pct,
                      notes: isManager ? 'Derived from day efficiency index' : f.notes,
                    }));
                  }}
                >
                  <option value="">Select…</option>
                  {(command?.team || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                      {emp.is_wc_manager || emp.id === command?.work_center?.manager_employee_id
                        ? ' (manager)'
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Efficiency %
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={
                    effForm.employee_id &&
                    effForm.employee_id === command?.work_center?.manager_employee_id
                      ? String(command?.efficiency_index_pct ?? 0)
                      : effForm.efficiency_pct
                  }
                  onChange={(e) => setEffForm((f) => ({ ...f, efficiency_pct: e.target.value }))}
                  required
                  readOnly={
                    !!effForm.employee_id &&
                    effForm.employee_id === command?.work_center?.manager_employee_id
                  }
                />
              </label>
              <label>
                Notes
                <input
                  type="text"
                  value={effForm.notes}
                  onChange={(e) => setEffForm((f) => ({ ...f, notes: e.target.value }))}
                  readOnly={
                    !!effForm.employee_id &&
                    effForm.employee_id === command?.work_center?.manager_employee_id
                  }
                />
              </label>
            </div>
            <button type="submit" className="mes-btn mes-btn-primary" style={{ marginTop: 12 }}>
              Save efficiency
            </button>
          </form>

          {command?.campaign_queue?.length > 1 ? (
            <div className="mes-card" style={{ padding: 16, marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px' }}>Campaign queue</h3>
              <ul>
                {command.campaign_queue.map((q) => (
                  <li key={q.id}>
                    #{q.queue_sequence} {q.component_label || q.master_record_id.slice(0, 8)} — {q.status}{' '}
                    ({q.good_quantity}/{q.target_quantity})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {coverage.length ? (
        <div className="mes-card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Coverage calendar</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Schedule</th>
                <th>Qty</th>
                <th>Covered</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {coverage.slice(0, 30).map((row) => (
                <tr key={row.delivery_schedule_id}>
                  <td>{row.due_date}</td>
                  <td>{row.schedule_number}</td>
                  <td>{row.schedule_qty}</td>
                  <td>{row.covered_qty}</td>
                  <td>
                    <StatusBadge status={row.state} label={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
