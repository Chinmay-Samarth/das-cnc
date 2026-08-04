import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import api from '../api/client';
import {
  PageHeader,
  EmptyState,
  MetricCard,
  AlertBanner,
  StatusBadge,
  TruncatedText,
} from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import HorizonGantt from './HorizonGantt';

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function HorizonPlannerPage() {
  const navigate = useNavigate();
  const [workCenters, setWorkCenters] = useState([]);
  const [view, setView] = useState('queue');
  const [form, setForm] = useState({
    work_center_id: '',
    horizon_start: todayStr(),
    horizon_end: addMonths(todayStr(), 5),
    hours_per_day: 9,
  });
  const [preview, setPreview] = useState(null);
  const [waves, setWaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState(null);
  const [ackWarnings, setAckWarnings] = useState(false);

  useEffect(() => {
    api.get('/work-centers').then(({ data }) => setWorkCenters(data.work_centers || data || []));
  }, []);

  const loadWaves = useCallback(() => {
    const params = form.work_center_id ? { work_center_id: form.work_center_id } : {};
    api.get('/campaigns/waves', { params }).then(({ data }) => setWaves(data.waves || []));
  }, [form.work_center_id]);

  useEffect(() => {
    loadWaves();
  }, [loadWaves]);

  const runPreview = useCallback(async () => {
    if (!form.work_center_id) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    setAckWarnings(false);
    try {
      const { data } = await api.post('/campaigns/waves/preview', form);
      setPreview(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    const t = setTimeout(runPreview, 400);
    return () => clearTimeout(t);
  }, [runPreview]);

  const metrics = useMemo(() => {
    const camps = preview?.campaigns || [];
    const demand = camps.reduce((s, c) => s + Number(c.demand_qty || 0), 0);
    const days = camps.reduce((s, c) => s + Number(c.production_days || c.capacity?.productionDays || 0), 0);
    return {
      campaigns: camps.length,
      demand,
      days,
      canRelease: !!(preview?.can_release ?? preview?.can_lock),
    };
  }, [preview]);

  const starvationIds = useMemo(
    () =>
      (preview?.warnings || [])
        .filter((w) => w.code === 'starvation')
        .map((w) => w.master_record_id)
        .filter(Boolean),
    [preview]
  );

  const canClickRelease =
    metrics.canRelease &&
    (!preview?.warnings?.length || ackWarnings) &&
    !releasing;

  async function handleRelease() {
    if (!canClickRelease) return;
    if (preview?.warnings?.length) {
      const ok = await appConfirm({
        title: 'Acknowledge starvation warnings?',
        message: preview.warnings.map((w) => w.reason).join('\n'),
        confirmLabel: 'Release anyway',
      });
      if (!ok) return;
    } else {
      const ok = await appConfirm({
        title: 'Release to floor?',
        message: `Create ${metrics.campaigns} demand-ranked campaigns and pin BOM/AF on covered schedules.`,
        confirmLabel: 'Release to floor',
      });
      if (!ok) return;
    }

    setReleasing(true);
    setError(null);
    try {
      const { data } = await api.post('/campaigns/waves/release', {
        ...form,
        acknowledge_warnings: true,
      });
      await appAlert({
        title: 'Released to floor',
        message: `Created ${data.campaigns?.length || 0} campaigns. First campaign is active.`,
        tone: 'success',
      });
      navigate(`/production/today?wc=${form.work_center_id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Shop floor"
        title="Horizon Planner"
        subtitle="Demand-ranked campaigns — release to floor starts production"
        actions={
          <>
            <button type="button" className="mes-btn mes-btn-secondary" onClick={runPreview} disabled={loading}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              disabled={!canClickRelease}
              onClick={handleRelease}
            >
              {releasing ? 'Releasing…' : 'Release to floor'}
            </button>
          </>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      <div className="mes-filters" style={{ marginBottom: 16 }}>
        <label>
          Work center
          <select
            value={form.work_center_id}
            onChange={(e) => setForm((f) => ({ ...f, work_center_id: e.target.value }))}
          >
            <option value="">Select…</option>
            {workCenters.map((wc) => (
              <option key={wc.id} value={wc.id}>
                {wc.code ? `${wc.code} — ` : ''}
                {wc.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Horizon start
          <input
            type="date"
            value={form.horizon_start}
            onChange={(e) => setForm((f) => ({ ...f, horizon_start: e.target.value }))}
          />
        </label>
        <label>
          Horizon end
          <input
            type="date"
            value={form.horizon_end}
            onChange={(e) => setForm((f) => ({ ...f, horizon_end: e.target.value }))}
          />
        </label>
        <label>
          Hours / day
          <select
            value={form.hours_per_day}
            onChange={(e) => setForm((f) => ({ ...f, hours_per_day: Number(e.target.value) }))}
          >
            {[8, 9, 10].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </label>
        <label>
          View
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="queue">Queue</option>
            <option value="gantt">Gantt</option>
          </select>
        </label>
      </div>

      {!form.work_center_id ? (
        <EmptyState
          title="Select a work center"
          description="Preview demand for the horizon window, review protections, then release to the floor."
        />
      ) : null}

      {form.work_center_id && loading && !preview ? <p className="muted">Loading preview…</p> : null}

      {(preview?.blockers || []).map((b, i) => (
        <AlertBanner key={`b-${i}`} tone="danger" title="Cannot release">
          {b.reason}
        </AlertBanner>
      ))}

      {(preview?.warnings || []).map((w, i) => (
        <AlertBanner key={`w-${i}`} tone="amber" title="Starvation risk">
          {w.reason}
        </AlertBanner>
      ))}

      {preview?.warnings?.length ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={ackWarnings}
            onChange={(e) => setAckWarnings(e.target.checked)}
          />
          I understand the starvation warnings and still want to release
        </label>
      ) : null}

      {preview ? (
        <div className="mes-metric-grid" style={{ marginBottom: 16 }}>
          <MetricCard label="Campaigns" value={metrics.campaigns} tone="info" />
          <MetricCard label="Demand qty" value={metrics.demand} />
          <MetricCard label="Est. days" value={metrics.days} hint={`${form.hours_per_day} h/day`} />
          <MetricCard
            label="Release"
            value={metrics.canRelease ? 'Ready' : 'Blocked'}
            tone={metrics.canRelease ? 'success' : 'danger'}
          />
        </div>
      ) : null}

      {preview && view === 'queue' ? (
        <div className="mes-card" style={{ padding: 0, overflow: 'hidden' }}>
          {(preview.campaigns || []).length === 0 ? (
            <EmptyState
              title="No demand in this window"
              description="Generate delivery schedules from blanket PO rules, or widen the horizon dates."
            />
          ) : (
            <div className="data-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Component</th>
                    <th>Run-out (d)</th>
                    <th>Priority</th>
                    <th>Demand</th>
                    <th>Est. hours</th>
                    <th>Days</th>
                    <th>Earliest due</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.campaigns.map((c) => (
                    <tr key={c.master_record_id} className={c.demand_rank === 1 ? 'is-focus-row' : ''}>
                      <td>
                        <strong>#{c.demand_rank}</strong>
                      </td>
                      <td>
                        <TruncatedText>{c.component_label || c.master_record_id}</TruncatedText>
                      </td>
                      <td>
                        {Number.isFinite(c.run_out_days) ? Number(c.run_out_days).toFixed(1) : '—'}
                      </td>
                      <td>
                        {c.priority_score != null ? Number(c.priority_score).toFixed(3) : '—'}
                      </td>
                      <td>{c.demand_qty}</td>
                      <td>{c.capacity?.totalHours ?? '—'}</td>
                      <td>{c.production_days || c.capacity?.productionDays || '—'}</td>
                      <td>{c.earliest_due || '—'}</td>
                      <td>
                        {c.template?.pcs_per_day
                          ? `${c.template.pcs_per_day}/day`
                          : c.run_time_per_unit_minutes
                            ? `${c.run_time_per_unit_minutes} min/pc`
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {preview && view === 'gantt' ? (
        <div className="mes-card" style={{ padding: 12 }}>
          <HorizonGantt
            campaigns={preview.campaigns || []}
            horizonStart={form.horizon_start}
            starvationIds={starvationIds}
          />
        </div>
      ) : null}

      {waves.length ? (
        <section style={{ marginTop: 24 }}>
          <h2 className="mes-section-title" style={{ fontSize: 16, marginBottom: 8 }}>
            Horizon waves
          </h2>
          <div className="data-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Window</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {waves.slice(0, 12).map((w) => (
                  <tr key={w.id}>
                    <td>{w.horizon_index}</td>
                    <td>
                      {w.horizon_start} → {w.horizon_end}
                    </td>
                    <td>
                      <StatusBadge status={w.status}>
                        {w.status === 'planning' ? 'Ready to lock' : w.status}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: 20,
          padding: '12px 0',
          background: 'var(--surface, #fff)',
          borderTop: '1px solid var(--border, #e5e7eb)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <button
          type="button"
          className="mes-btn mes-btn-primary"
          disabled={!canClickRelease}
          onClick={handleRelease}
        >
          {releasing ? 'Releasing…' : 'Release to floor'}
        </button>
      </div>
    </div>
  );
}
