import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarRange, Factory, Package, RefreshCw, Rows3, Target, Warehouse } from 'lucide-react';
import api from '../api/client';
import {
  PageHeader,
  EmptyState,
  MetricCard,
  AlertBanner,
  StatusBadge,
  TruncatedText,
} from '../components/mes';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';
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

function qty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

function rateLabel(campaign) {
  if (campaign.template?.pcs_per_day) return `${campaign.template.pcs_per_day}/day`;
  if (campaign.run_time_per_unit_minutes) return `${campaign.run_time_per_unit_minutes} min/pc`;
  return '';
}

function partCover(campaign, horizonDays, riskIds) {
  if (riskIds.has(campaign.master_record_id)) return 'risk';
  const runOut = Number(campaign.run_out_days);
  if (!Number.isFinite(runOut)) return 'covered';
  if (horizonDays > 0 && runOut >= horizonDays) return 'covered';
  return 'tight';
}

function CoverBadge({ state }) {
  if (state === 'covered') return <StatusBadge status="met">Covered</StatusBadge>;
  if (state === 'tight') return <StatusBadge status="ready">Tight</StatusBadge>;
  return <StatusBadge status="blocked">At risk</StatusBadge>;
}

function warningTitle(warning) {
  if (warning.code === 'run_out_buffer') return 'Run-out buffer';
  if (warning.code === 'starvation') return 'Starvation risk';
  return 'Warning';
}

const NONE = [];

export default function HorizonPlannerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workCenters, setWorkCenters] = useState([]);
  const [accessReady, setAccessReady] = useState(false);
  const [view, setView] = useState('table');
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

  const selectedWc = workCenters.find((wc) => wc.id === form.work_center_id) || null;
  const campaigns = preview?.campaigns ?? NONE;
  const blockers = preview?.blockers ?? NONE;
  const warnings = preview?.warnings ?? NONE;
  const horizonDays = Number(preview?.horizon_working_days) || 0;

  const riskIds = useMemo(() => {
    const ids = new Set();
    for (const warning of warnings) {
      if (warning.code === 'starvation' || warning.code === 'run_out_buffer') {
        if (warning.master_record_id) ids.add(warning.master_record_id);
      }
    }
    return ids;
  }, [warnings]);

  const metrics = useMemo(() => {
    let demand = 0;
    let coveredQty = 0;
    let fg = 0;
    let wip = 0;
    let days = 0;
    let shortest = null;
    let covered = 0;
    let tight = 0;
    let risk = 0;

    for (const campaign of campaigns) {
      const demandQty = Number(campaign.demand_qty) || 0;
      const fgQty = Number(campaign.fg_stock) || 0;
      const wipQty = Number(campaign.wip_stock) || 0;
      demand += demandQty;
      coveredQty += Math.min(demandQty, fgQty + wipQty);
      fg += fgQty;
      wip += wipQty;
      days += Number(campaign.production_days || campaign.capacity?.productionDays || 0);
      const runOut = Number(campaign.run_out_days);
      if (Number.isFinite(runOut) && (shortest == null || runOut < shortest)) shortest = runOut;
      const state = partCover(campaign, horizonDays, riskIds);
      if (state === 'covered') covered += 1;
      else if (state === 'tight') tight += 1;
      else risk += 1;
    }

    const coveragePct = demand > 0 ? Math.round((coveredQty / demand) * 100) : campaigns.length ? 100 : null;
    let coverageTone = 'neutral';
    if (campaigns.length) {
      if (risk > 0) coverageTone = 'danger';
      else if (tight > 0 || (coveragePct != null && coveragePct < 100)) coverageTone = 'amber';
      else coverageTone = 'success';
    }

    const loadTone = horizonDays > 0 && days > horizonDays ? 'amber' : 'neutral';

    return {
      campaigns: campaigns.length,
      demand,
      days,
      fg,
      wip,
      stock: fg + wip,
      shortest,
      covered,
      tight,
      risk,
      coveragePct,
      coverageTone,
      loadTone,
      canRelease: !!(preview?.can_release ?? preview?.can_lock),
    };
  }, [campaigns, horizonDays, preview, riskIds]);

  const blocked = !metrics.canRelease || blockers.length > 0;
  const canClickRelease =
    !!form.work_center_id &&
    !blocked &&
    (!warnings.length || ackWarnings) &&
    !releasing;

  const selectedWcWaves = useMemo(
    () =>
      form.work_center_id
        ? (waves || [])
            .filter((w) => w.work_center_id === form.work_center_id)
            .slice()
            .sort((a, b) => (b.horizon_index || 0) - (a.horizon_index || 0))
        : [],
    [waves, form.work_center_id]
  );

  const wcOptions = useMemo(
    () =>
      workCenters.map((wc) => ({
        value: wc.id,
        label: wc.code ? `${wc.code} · ${wc.name}` : wc.name,
      })),
    [workCenters]
  );

  async function handleRelease() {
    if (!canClickRelease) return;
    if (warnings.length) {
      const ok = await appConfirm({
        title: 'Acknowledge release warnings?',
        message: warnings.map((w) => w.reason).join('\n'),
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
  const hasIssues = blockers.length > 0 || warnings.length > 0;
  const periodHint = `${formatDisplayDate(form.horizon_start)} → ${formatDisplayDate(form.horizon_end)} · ${form.hours_per_day} h/day`;
  const subtitle = selectedWc
    ? [selectedWc.code, selectedWc.name].filter(Boolean).join(' — ')
    : '';

  return (
    <div className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Shop floor"
        title="Horizon Planner"
        subtitle={subtitle || undefined}
        actions={
          form.work_center_id ? (
            <>
              <button type="button" className="mes-btn mes-btn-secondary" onClick={runPreview} disabled={loading}>
                <RefreshCw size={15} />
                Refresh
              </button>
              <button
                type="button"
                className="mes-btn mes-btn-primary"
                disabled={!canClickRelease}
                title={
                  blocked
                    ? 'Resolve blockers before release'
                    : warnings.length && !ackWarnings
                      ? 'Acknowledge warnings in the panel before release'
                      : undefined
                }
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
        <section className="mes-card hp-lobby" aria-label="Work center lobby">
          <h2 className="hp-panel-title">Choose a work center</h2>
          <p className="muted hp-lead">Pick a floor to set the horizon, then review coverage and stock before release.</p>
          <div className="hp-lobby-list">
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
                  <p className="mes-list-item-meta hp-meta">
                    {wc.code || '—'}
                    {wave?.horizon_start
                      ? ` · Wave ${wave.horizon_index}: ${formatDisplayDate(wave.horizon_start)} → ${formatDisplayDate(wave.horizon_end)}`
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
          <section className="mes-card hp-plan-bar" aria-label="Horizon settings">
            <div className="mes-filters hp-plan-fields">
              {workCenters.length > 1 ? (
                <label className="hp-wc-field">
                  Work center
                  <FormSearchSelect
                    value={form.work_center_id}
                    onChange={(value) => (value ? selectWorkCenter(value) : clearWorkCenter())}
                    options={wcOptions}
                    placeholder="Choose a work center"
                    emptyMessage="No work centers"
                  />
                </label>
              ) : null}
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
            <div className="mes-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`mes-view-toggle-btn${view === 'table' ? ' is-active' : ''}`}
                onClick={() => setView('table')}
              >
                <Rows3 size={16} />
                Table
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
          </section>

          {loading && !preview ? <p className="muted">Loading preview…</p> : null}

          {preview ? (
            <div className="mes-metric-grid">
              <MetricCard
                label="Horizon"
                value={horizonDays ? `${horizonDays}d` : '—'}
                hint={periodHint}
                icon={CalendarRange}
              />
              <MetricCard
                label="Coverage"
                value={metrics.coveragePct == null ? '—' : `${metrics.coveragePct}%`}
                hint={
                  metrics.campaigns
                    ? `${metrics.covered} covered · ${metrics.tight} tight · ${metrics.risk} at risk`
                    : 'No demand in this window'
                }
                icon={Target}
                tone={metrics.coverageTone}
              />
              <MetricCard
                label="Stock"
                value={qty(metrics.stock)}
                hint={`FG ${qty(metrics.fg)} · WIP ${qty(metrics.wip)}${
                  metrics.shortest != null ? ` · shortest run-out ${metrics.shortest.toFixed(1)}d` : ''
                }`}
                icon={Warehouse}
              />
              <MetricCard
                label="Load"
                value={`${qty(metrics.days)}d`}
                hint={`${metrics.campaigns} campaign${metrics.campaigns === 1 ? '' : 's'} · ${horizonDays || '—'} working days`}
                icon={Package}
                tone={metrics.loadTone}
              />
            </div>
          ) : null}

          <div className={`hp-review${hasIssues ? '' : ' is-full'}`}>
            <div className="hp-review-main">
              {preview && view === 'table' ? (
                <div className="mes-card hp-table-card">
                  {campaigns.length === 0 ? (
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
                            <th>Cover</th>
                            <th>Demand</th>
                            <th>FG</th>
                            <th>WIP</th>
                            <th>Run-out</th>
                            <th>Est. days</th>
                            <th>Earliest due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaigns.map((campaign) => {
                            const rate = rateLabel(campaign);
                            const runOut = Number(campaign.run_out_days);
                            return (
                              <tr
                                key={campaign.master_record_id}
                                className={campaign.demand_rank === 1 ? 'is-focus-row' : ''}
                              >
                                <td>
                                  <strong>#{campaign.demand_rank}</strong>
                                </td>
                                <td>
                                  <div className="hp-component">
                                    <TruncatedText>
                                      {campaign.component_label || campaign.master_record_id}
                                    </TruncatedText>
                                    {rate ? <span className="hp-component-rate">{rate}</span> : null}
                                  </div>
                                </td>
                                <td>
                                  <CoverBadge state={partCover(campaign, horizonDays, riskIds)} />
                                </td>
                                <td>{qty(campaign.demand_qty)}</td>
                                <td>{qty(campaign.fg_stock)}</td>
                                <td>{qty(campaign.wip_stock)}</td>
                                <td>{Number.isFinite(runOut) ? `${runOut.toFixed(1)}d` : '—'}</td>
                                <td>{campaign.production_days || campaign.capacity?.productionDays || '—'}</td>
                                <td>{formatDisplayDate(campaign.earliest_due)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {preview && view === 'gantt' ? (
                <div className="mes-card hp-gantt-card">
                  <HorizonGantt
                    campaigns={campaigns}
                    horizonStart={form.horizon_start}
                    starvationIds={[...riskIds]}
                  />
                </div>
              ) : null}
            </div>

            {hasIssues ? (
              <aside className="mes-card hp-warn-panel" aria-label="Release warnings">
                <h2 className="hp-panel-title">Review before release</h2>
                <div className="hp-warn-list">
                  {blockers.map((blocker, index) => (
                    <AlertBanner key={`b-${index}`} tone="danger" title="Cannot release">
                      {blocker.reason}
                    </AlertBanner>
                  ))}
                  {warnings.map((warning, index) => (
                    <AlertBanner key={`w-${index}`} tone="amber" title={warningTitle(warning)}>
                      {warning.reason}
                    </AlertBanner>
                  ))}
                </div>
                {warnings.length && !blocked ? (
                  <label className="hp-ack">
                    <input
                      type="checkbox"
                      checked={ackWarnings}
                      onChange={(e) => setAckWarnings(e.target.checked)}
                    />
                    I understand these warnings and still want to release
                  </label>
                ) : null}
              </aside>
            ) : null}
          </div>

          {selectedWcWaves.length ? (
            <section className="hp-waves" aria-label="Earlier horizon waves">
              <h2 className="hp-panel-title">Earlier waves</h2>
              <ul className="hp-wave-list">
                {selectedWcWaves.slice(0, 12).map((wave) => (
                  <li key={wave.id}>
                    <span className="hp-wave-index">Wave {wave.horizon_index}</span>
                    <span className="hp-wave-window">
                      {formatDisplayDate(wave.horizon_start)} → {formatDisplayDate(wave.horizon_end)}
                    </span>
                    <StatusBadge status={wave.status}>{waveStatusLabel(wave.status)}</StatusBadge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
