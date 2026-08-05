import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarRange, Factory, RefreshCw, Rows3 } from 'lucide-react';
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

function clampHorizonMonths(n) {
  const m = Number(n);
  if (!Number.isFinite(m)) return 5;
  return Math.min(6, Math.max(4, Math.round(m)));
}

function clampHours(n) {
  const h = Number(n);
  if (h === 8 || h === 9 || h === 10) return h;
  return 9;
}

function latestWaveForWc(waves, wcId) {
  const list = (waves || []).filter((w) => w.work_center_id === wcId);
  if (!list.length) return null;
  return list.slice().sort((a, b) => (b.horizon_index || 0) - (a.horizon_index || 0))[0];
}

function waveStatusLabel(status) {
  if (status === 'planning') return 'Ready to release';
  return status || '—';
}

export default function HorizonPlannerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workCenters, setWorkCenters] = useState([]);
  const [accessReady, setAccessReady] = useState(false);
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

  const selectWorkCenter = useCallback(
    (wcId, centers = workCenters) => {
      const wc = (centers || []).find((c) => c.id === wcId);
      if (!wc) return;
      setForm((f) => {
        if (f.work_center_id === wc.id) return f;
        const months = clampHorizonMonths(wc.horizon_months_default);
        const start = todayStr();
        return {
          ...f,
          work_center_id: wc.id,
          hours_per_day: clampHours(wc.hours_per_day ?? f.hours_per_day),
          horizon_start: start,
          horizon_end: addMonths(start, months),
        };
      });
      setSearchParams({ wc: wc.id });
    },
    [workCenters, setSearchParams]
  );

  const clearWorkCenter = useCallback(() => {
    setForm((f) => ({ ...f, work_center_id: '' }));
    setPreview(null);
    setSearchParams({});
  }, [setSearchParams]);

  useEffect(() => {
    let mounted = true;
    const wcParam = searchParams.get('wc');
    async function loadWorkCenters() {
      try {
        const { data } = await api.get('/work-centers');
        const raw = data.work_centers || data || [];
        // Open for everyone: all active centers (fall back to full list if none flagged active)
        const active = raw.filter((wc) => wc.is_active !== false);
        const centers = (active.length ? active : raw).slice().sort((a, b) =>
          String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''))
        );
        if (!mounted) return;
        setWorkCenters(centers);

        if (wcParam && centers.some((wc) => wc.id === wcParam)) {
          const wc = centers.find((c) => c.id === wcParam);
          const months = clampHorizonMonths(wc.horizon_months_default);
          const start = todayStr();
          setForm((f) => ({
            ...f,
            work_center_id: wc.id,
            hours_per_day: clampHours(wc.hours_per_day ?? f.hours_per_day),
            horizon_start: f.work_center_id === wc.id ? f.horizon_start : start,
            horizon_end: f.work_center_id === wc.id ? f.horizon_end : addMonths(start, months),
          }));
        } else if (centers.length === 1) {
          const wc = centers[0];
          const months = clampHorizonMonths(wc.horizon_months_default);
          const start = todayStr();
          setForm((f) => {
            if (f.work_center_id === wc.id) return f;
            return {
              ...f,
              work_center_id: wc.id,
              hours_per_day: clampHours(wc.hours_per_day ?? 9),
              horizon_start: start,
              horizon_end: addMonths(start, months),
            };
          });
          if (wcParam !== wc.id) setSearchParams({ wc: wc.id });
        } else if (wcParam && !centers.some((wc) => wc.id === wcParam)) {
          setForm((f) => ({ ...f, work_center_id: '' }));
          setSearchParams({});
        }
      } catch {
        if (!mounted) return;
        setWorkCenters([]);
      } finally {
        if (mounted) setAccessReady(true);
      }
    }
    loadWorkCenters();
    return () => {
      mounted = false;
    };
  }, [searchParams, setSearchParams]);

  const loadWaves = useCallback(() => {
    api.get('/campaigns/waves').then(({ data }) => setWaves(data.waves || []));
  }, []);

  useEffect(() => {
    if (!accessReady) return;
    loadWaves();
  }, [accessReady, loadWaves]);

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
    if (!accessReady || !form.work_center_id) return undefined;
    const t = setTimeout(runPreview, 400);
    return () => clearTimeout(t);
  }, [runPreview, accessReady, form.work_center_id]);

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

  const riskIds = useMemo(
    () =>
      (preview?.warnings || [])
        .filter((w) => w.code === 'starvation' || w.code === 'run_out_buffer')
        .map((w) => w.master_record_id)
        .filter(Boolean),
    [preview]
  );

  const selectedWcWaves = useMemo(
    () =>
      form.work_center_id
        ? (waves || []).filter((w) => w.work_center_id === form.work_center_id)
        : [],
    [waves, form.work_center_id]
  );

  const canClickRelease =
    !!form.work_center_id &&
    metrics.canRelease &&
    (!preview?.warnings?.length || ackWarnings) &&
    !releasing;

  async function handleRelease() {
    if (!canClickRelease) return;
    if (preview?.warnings?.length) {
      const ok = await appConfirm({
        title: 'Acknowledge release warnings?',
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
      loadWaves();
      navigate(`/production/today?wc=${form.work_center_id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Release failed');
    } finally {
      setReleasing(false);
    }
  }

  const showLobby = accessReady && !form.work_center_id;

  return (
    <div className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Shop floor"
        title="Horizon Planner"
        actions={
          form.work_center_id ? (
            <>
              <div className="mes-view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`mes-view-toggle-btn${view === 'queue' ? ' is-active' : ''}`}
                  onClick={() => setView('queue')}
                >
                  <Rows3 size={16} />
                  Queue
                </button>
                <button
                  type="button"
                  className={`mes-view-toggle-btn${view === 'gantt' ? ' is-active' : ''}`}
                  onClick={() => setView('gantt')}
                >
                  <CalendarRange size={16} />
                  Gantt
                </button>
              </div>
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
          ) : null
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      {!accessReady ? <p className="muted">Loading work centers…</p> : null}

      {accessReady && workCenters.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No work centers to plan"
          description="Create a work center in Masters before using Horizon Planner."
        />
      ) : null}

      {showLobby && workCenters.length > 0 ? (
        <section className="mes-card" style={{ padding: 16 }} aria-label="Work center lobby">
          <h2 className="mes-section-title" style={{ marginTop: 0, marginBottom: 6, fontSize: 16 }}>
            Choose a work center
          </h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            Horizon waves are scoped per work center — capacity, ranking, and release stay on one floor.
            All work centers are open for planning right now.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workCenters.map((wc) => {
              const wave = latestWaveForWc(waves, wc.id);
              return (
                <button
                  key={wc.id}
                  type="button"
                  className="mes-list-item hp-lobby-item"
                  onClick={() => selectWorkCenter(wc.id)}
                >
                  <div className="mes-list-item-top">
                    <p className="mes-list-item-title">
                      <TruncatedText>{wc.name}</TruncatedText>
                    </p>
                    {wave ? (
                      <StatusBadge status={wave.status}>{waveStatusLabel(wave.status)}</StatusBadge>
                    ) : (
                      <StatusBadge status="planned">No wave yet</StatusBadge>
                    )}
                  </div>
                  <p className="mes-list-item-meta" style={{ marginBottom: 0 }}>
                    {wc.code || '—'}
                    {wave?.horizon_start
                      ? ` · Wave ${wave.horizon_index}: ${wave.horizon_start} → ${wave.horizon_end}`
                      : ''}
                    {wc.hours_per_day ? ` · ${wc.hours_per_day} h/day` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {form.work_center_id ? (
        <>
          <div className="hp-wc-bar" style={{ marginBottom: 12 }}>
            {workCenters.length > 1 ? (
              <div className="mes-view-toggle hp-wc-chips" role="group" aria-label="Work center">
                {workCenters.map((wc) => (
                  <button
                    key={wc.id}
                    type="button"
                    className={`mes-view-toggle-btn${form.work_center_id === wc.id ? ' is-active' : ''}`}
                    onClick={() => selectWorkCenter(wc.id)}
                  >
                    {wc.code || wc.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {workCenters[0]?.code ? `${workCenters[0].code} — ` : ''}
                {workCenters[0]?.name || 'Work center'}
              </p>
            )}
            {workCenters.length > 1 ? (
              <button type="button" className="mes-btn mes-btn-secondary" onClick={clearWorkCenter}>
                All centers
              </button>
            ) : null}
          </div>

          <div className="mes-filters" style={{ marginBottom: 16 }}>
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
          </div>

          {loading && !preview ? <p className="muted">Loading preview…</p> : null}

          {(preview?.blockers || []).map((b, i) => (
            <AlertBanner key={`b-${i}`} tone="danger" title="Cannot release">
              {b.reason}
            </AlertBanner>
          ))}

          {(preview?.warnings || []).map((w, i) => (
            <AlertBanner
              key={`w-${i}`}
              tone="amber"
              title={w.code === 'run_out_buffer' ? 'Run-out buffer warning' : 'Starvation risk'}
            >
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
              I understand the warnings and still want to release to the floor
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
                  icon={Factory}
                  title="No demand routable at this work center"
                  description="Nothing in this window has a schedulable activity-flow node on this center. Check AF routing, generate delivery schedules from blanket POs, or widen the horizon dates."
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
                        <tr
                          key={c.master_record_id}
                          className={c.demand_rank === 1 ? 'is-focus-row' : ''}
                        >
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
                starvationIds={riskIds}
              />
            </div>
          ) : null}

          {selectedWcWaves.length ? (
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
                    {selectedWcWaves.slice(0, 12).map((w) => (
                      <tr key={w.id}>
                        <td>{w.horizon_index}</td>
                        <td>
                          {w.horizon_start}{' '}
                          <ArrowRight style={{ display: 'inline' }} size={16} /> {w.horizon_end}
                        </td>
                        <td>
                          <StatusBadge status={w.status}>{waveStatusLabel(w.status)}</StatusBadge>
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
        </>
      ) : null}
    </div>
  );
}
