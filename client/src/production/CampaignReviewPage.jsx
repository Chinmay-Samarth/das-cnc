import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Factory,
  Layers,
  ListOrdered,
  Package,
  RefreshCw,
  Target,
  Warehouse,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import {
  PageHeader,
  EmptyState,
  MetricCard,
  StatusBadge,
  TruncatedText,
} from '../components/mes';
import { appAlert, appConfirm } from '../components/dialog';
import { formatDisplayDate } from '../utils/dateFormat';

function pctLabel(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n)}%`;
}

function qty(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN');
}

function waveStatusLabel(status) {
  if (status === 'planning') return 'Ready to release';
  if (status === 'in_progress') return 'In progress';
  return status || '—';
}

function CollapsibleSection({ id, title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="cr-collapse">
      <button
        type="button"
        className="cr-collapse-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cr-collapse-toggle-main">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="mes-section-title" style={{ fontSize: 14, margin: 0 }}>
            {title}
          </span>
        </span>
        {summary ? <span className="cr-collapse-summary muted">{summary}</span> : null}
      </button>
      {open ? (
        <div id={id} className="cr-collapse-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function CampaignDetail({ campaign }) {
  if (!campaign) {
    return (
      <EmptyState
        icon={Layers}
        title="Select a campaign"
        description="Pick a campaign from the queue to review demand, coverage, and the daily rope."
      />
    );
  }

  const demand = campaign.horizon_demand_qty ?? campaign.target_quantity;
  const schedules = campaign.coverage?.schedules || [];
  const cards = campaign.cards || [];
  const coverageSummary = `${pctLabel(campaign.coverage?.pct_covered)} · ${qty(campaign.coverage?.covered_qty)} / ${qty(campaign.coverage?.schedule_qty)}${schedules.length ? ` · ${schedules.length} schedules` : ''}`;
  const ropeSummary = cards.length
    ? `${cards.length} cards · ${campaign.open_card_count ?? 0} open${
        campaign.rope_end_date ? ` · ends ${formatDisplayDate(campaign.rope_end_date)}` : ''
      }`
    : 'No cards';

  return (
    <div className="cr-detail" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Rank #{campaign.demand_rank}
            </p>
            <h2 className="mes-section-title" style={{ margin: 0, fontSize: 18 }}>
              <TruncatedText>{campaign.component_label || 'Component'}</TruncatedText>
            </h2>
          </div>
          <StatusBadge status={campaign.status}>{campaign.status}</StatusBadge>
        </div>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          Rope ends {campaign.rope_end_date ? formatDisplayDate(campaign.rope_end_date) : '—'}
          {campaign.next_card_date ? ` · Next card ${formatDisplayDate(campaign.next_card_date)}` : ''}
          {campaign.open_card_count != null ? ` · ${campaign.open_card_count} open cards` : ''}
        </p>
      </div>

      <div className="mes-metric-grid" style={{ marginBottom: 0 }}>
        <MetricCard label="Demand" value={qty(demand)} hint="Horizon demand" icon={Target} />
        <MetricCard label="Good" value={qty(campaign.good_quantity)} tone="success" />
        <MetricCard
          label="Remaining"
          value={qty(campaign.remaining_qty)}
          tone={campaign.remaining_qty > 0 ? 'amber' : 'success'}
        />
        <MetricCard
          label="Complete"
          value={pctLabel(campaign.pct_complete)}
          hint={campaign.scrap_quantity ? `Scrap ${qty(campaign.scrap_quantity)}` : undefined}
        />
      </div>

      <div
        className="cr-progress"
        role="progressbar"
        aria-valuenow={campaign.pct_complete || 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="cr-progress-bar" style={{ width: `${Math.min(100, campaign.pct_complete || 0)}%` }} />
      </div>

      <section>
        <h3 className="mes-section-title" style={{ fontSize: 14, marginBottom: 8 }}>
          Capacity snapshot
        </h3>
        <div className="cr-capacity-row">
          <span>
            Est. hours <strong>{campaign.estimated_hours ?? '—'}</strong>
          </span>
          <span>
            Prod. days <strong>{campaign.production_days ?? '—'}</strong>
          </span>
          <span>
            Run-out <strong>{campaign.run_out_days != null ? Number(campaign.run_out_days).toFixed(1) : '—'}d</strong>
          </span>
          <span>
            FG <strong>{qty(campaign.fg_stock)}</strong>
          </span>
          <span>
            WIP <strong>{qty(campaign.wip_stock)}</strong>
          </span>
          <span>
            Setup <strong>{campaign.setup_time_minutes ?? '—'}m</strong>
          </span>
          <span>
            Run <strong>{campaign.run_time_per_unit_minutes ?? '—'}m/pc</strong>
          </span>
        </div>
      </section>

      <CollapsibleSection
        id={`cr-coverage-${campaign.id}`}
        title="Delivery coverage"
        summary={coverageSummary}
        defaultOpen={false}
      >
        {!schedules.length ? (
          <p className="muted" style={{ margin: 0 }}>
            No schedule coverage rows for this campaign.
          </p>
        ) : (
          <div className="data-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Due</th>
                  <th>Qty</th>
                  <th>Covered</th>
                  <th>Left</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td>{s.schedule_number || s.delivery_schedule_id?.slice(0, 8) || '—'}</td>
                    <td>{s.due_date ? formatDisplayDate(s.due_date) : '—'}</td>
                    <td>{qty(s.schedule_qty)}</td>
                    <td>{qty(s.covered_qty)}</td>
                    <td>{qty(s.remaining_qty)}</td>
                    <td>
                      {s.at_risk ? <StatusBadge status="overdue">At risk</StatusBadge> : null}
                      {!s.at_risk && s.remaining_qty <= 0 ? (
                        <StatusBadge status="completed">Met</StatusBadge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id={`cr-rope-${campaign.id}`}
        title="Daily rope"
        summary={ropeSummary}
        defaultOpen={false}
      >
        {!cards.length ? (
          <p className="muted" style={{ margin: 0 }}>
            No daily cards generated for this campaign yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cards.map((card) => (
              <Link
                key={card.id}
                to={`/production/cards/${card.id}`}
                className="mes-list-item"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="mes-list-item-top">
                  <span className="mes-list-item-title" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    Day {card.day_index ?? '—'}
                    {card.card_number ? ` · ${card.card_number}` : ''}
                  </span>
                  <StatusBadge status={card.status}>{card.status}</StatusBadge>
                </div>
                <p className="mes-list-item-sub" style={{ marginBottom: 0 }}>
                  {card.work_date ? formatDisplayDate(card.work_date) : '—'} · {qty(card.total_good_produced)} /{' '}
                  {qty(card.target_quantity)} good
                  {card.lot_minted_at ? ' · Lot minted' : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

export default function CampaignReviewPage() {
  const navigate = useNavigate();
  const { hasAccess } = useAuth();
  const canRerank = hasAccess('SUPERVISOR');
  const [searchParams, setSearchParams] = useSearchParams();
  const [workCenters, setWorkCenters] = useState([]);
  const [accessReady, setAccessReady] = useState(false);
  const [selectedWc, setSelectedWc] = useState('');
  const [review, setReview] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [loading, setLoading] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);
  const [rerankBusy, setRerankBusy] = useState(false);
  const [error, setError] = useState(null);

  const wcParam = searchParams.get('wc') || '';
  const waveParam = searchParams.get('wave') || '';
  const campaignParam = searchParams.get('campaign') || '';

  const selectWorkCenter = useCallback(
    (wcId) => {
      setSelectedWc(wcId);
      const next = { wc: wcId };
      if (waveParam) next.wave = waveParam;
      setSearchParams(next);
    },
    [setSearchParams, waveParam]
  );

  const clearWorkCenter = useCallback(() => {
    setSelectedWc('');
    setReview(null);
    setSelectedCampaignId('');
    setSearchParams({});
  }, [setSearchParams]);

  useEffect(() => {
    let mounted = true;
    async function loadWcs() {
      try {
        const { data } = await api.get('/work-centers');
        const raw = data.work_centers || data || [];
        const active = raw.filter((wc) => wc.is_active !== false);
        const centers = (active.length ? active : raw)
          .slice()
          .sort((a, b) => String(a.code || a.name || '').localeCompare(String(b.code || b.name || '')));
        if (!mounted) return;
        setWorkCenters(centers);

        if (wcParam && centers.some((wc) => wc.id === wcParam)) {
          setSelectedWc(wcParam);
        } else if (centers.length === 1) {
          setSelectedWc(centers[0].id);
          if (wcParam !== centers[0].id) setSearchParams({ wc: centers[0].id });
        } else if (wcParam && !centers.some((wc) => wc.id === wcParam)) {
          setSelectedWc('');
          setSearchParams({});
        }
      } catch {
        if (mounted) setWorkCenters([]);
      } finally {
        if (mounted) setAccessReady(true);
      }
    }
    loadWcs();
    return () => {
      mounted = false;
    };
  }, [wcParam, setSearchParams]);

  const loadReview = useCallback(async () => {
    if (!selectedWc) {
      setReview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (waveParam) params.wave_id = waveParam;
      const { data } = await api.get(`/campaigns/work-centers/${selectedWc}/wave-review`, { params });
      setReview(data);
      const camps = data.campaigns || [];
      const prefer =
        (campaignParam && camps.find((c) => c.id === campaignParam)?.id) ||
        camps.find((c) => c.status === 'active')?.id ||
        camps[0]?.id ||
        '';
      setSelectedCampaignId((prev) =>
        prev && camps.some((c) => c.id === prev) ? prev : prefer
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load campaign review');
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [selectedWc, waveParam, campaignParam]);

  useEffect(() => {
    if (!accessReady || !selectedWc) return;
    loadReview();
  }, [accessReady, selectedWc, loadReview]);

  const selectedCampaign = useMemo(
    () => (review?.campaigns || []).find((c) => c.id === selectedCampaignId) || null,
    [review, selectedCampaignId]
  );

  const queuedCount = review?.kpis?.queued_count || 0;
  const showLobby = accessReady && !selectedWc;
  const kpis = review?.kpis;
  const wave = review?.wave;

  function onSelectCampaign(id) {
    setSelectedCampaignId(id);
    const next = { wc: selectedWc };
    if (wave?.id) next.wave = wave.id;
    if (id) next.campaign = id;
    setSearchParams(next);
  }

  async function handleRefreshStock() {
    if (!selectedWc || stockBusy) return;
    setStockBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/campaigns/work-centers/${selectedWc}/wave-review/refresh-stock`, {
        wave_id: wave?.id || waveParam || undefined,
      });
      setReview(data);
      await appAlert({
        title: 'Stock refreshed',
        message: 'FG/WIP and run-out days updated for this wave.',
        tone: 'success',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to refresh stock');
    } finally {
      setStockBusy(false);
    }
  }

  async function handleRerank() {
    if (!selectedWc || !canRerank || rerankBusy || queuedCount < 1) return;
    const ok = await appConfirm({
      title: 'Re-rank queued campaigns?',
      message:
        'Live FG/WIP will be recomputed, then queued campaigns will be re-ordered by TOC priority. The active campaign stays on the floor.',
      confirmLabel: 'Re-rank queue',
    });
    if (!ok) return;

    setRerankBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/campaigns/work-centers/${selectedWc}/wave-review/rerank`, {
        wave_id: wave?.id || waveParam || undefined,
      });
      setReview(data);
      await appAlert({
        title: data.reranked === false ? 'Nothing to re-rank' : 'Queue re-ranked',
        message:
          data.reranked === false
            ? data.message || 'No queued campaigns.'
            : 'Queued campaigns reordered. Active campaign unchanged.',
        tone: 'success',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to re-rank queue');
    } finally {
      setRerankBusy(false);
    }
  }

  return (
    <div className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Shop floor"
        title="Campaigns"
        actions={
          selectedWc ? (
            <>
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={handleRefreshStock}
                disabled={loading || stockBusy || !wave}
              >
                <Warehouse size={15} />
                {stockBusy ? 'Refreshing…' : 'Refresh stock'}
              </button>
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={handleRerank}
                disabled={loading || rerankBusy || !wave || !canRerank || queuedCount < 1}
                title={!canRerank ? 'Manager access required' : queuedCount < 1 ? 'No queued campaigns' : undefined}
              >
                <ListOrdered size={15} />
                {rerankBusy ? 'Re-ranking…' : 'Re-rank queue'}
              </button>
              <button type="button" className="mes-btn mes-btn-secondary" onClick={loadReview} disabled={loading}>
                <RefreshCw size={15} />
                Refresh
              </button>
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={() => navigate(`/production/horizon-planner?wc=${selectedWc}`)}
              >
                <CalendarRange size={15} />
                Horizon
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
          title="No work centers"
          description="Create a work center before reviewing campaigns."
        />
      ) : null}

      {showLobby && workCenters.length > 0 ? (
        <section className="mes-card" style={{ padding: 16 }} aria-label="Work center lobby">
          <h2 className="mes-section-title" style={{ marginTop: 0, marginBottom: 6, fontSize: 16 }}>
            Choose a work center
          </h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            Review the current horizon wave — demand, coverage, FG/WIP buffer, and when each campaign rope ends.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workCenters.map((wc) => (
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
                </div>
                <p className="mes-list-item-meta" style={{ marginBottom: 0 }}>
                  {wc.code || '—'}
                  {wc.hours_per_day ? ` · ${wc.hours_per_day} h/day` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedWc ? (
        <>
          <div className="hp-wc-bar" style={{ marginBottom: 12 }}>
            {workCenters.length > 1 ? (
              <div className="mes-view-toggle hp-wc-chips" role="group" aria-label="Work center">
                {workCenters.map((wc) => (
                  <button
                    key={wc.id}
                    type="button"
                    className={`mes-view-toggle-btn${selectedWc === wc.id ? ' is-active' : ''}`}
                    onClick={() => selectWorkCenter(wc.id)}
                  >
                    {wc.code || wc.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {review?.work_center?.code ? `${review.work_center.code} — ` : ''}
                {review?.work_center?.name || workCenters[0]?.name || 'Work center'}
              </p>
            )}
            {workCenters.length > 1 ? (
              <button type="button" className="mes-btn mes-btn-secondary" onClick={clearWorkCenter}>
                All centers
              </button>
            ) : null}
          </div>

          {loading && !review ? <p className="muted">Loading wave review…</p> : null}

          {!loading && review && !wave ? (
            <EmptyState
              icon={Layers}
              title="No horizon wave yet"
              description="Release a wave from Horizon Planner to review campaigns for this work center."
              actionLabel="Open Horizon Planner"
              onAction={() => navigate(`/production/horizon-planner?wc=${selectedWc}`)}
            />
          ) : null}

          {wave ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <StatusBadge status={wave.status}>{waveStatusLabel(wave.status)}</StatusBadge>
                <span className="muted" style={{ fontSize: 13 }}>
                  Wave #{wave.horizon_index} · {formatDisplayDate(wave.horizon_start)}{' '}
                  <ArrowRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                  {formatDisplayDate(wave.horizon_end)}
                  {wave.hours_per_day ? ` · ${wave.hours_per_day} h/day` : ''}
                </span>
              </div>

              <div className="mes-metric-grid">
                <MetricCard
                  label="Days left"
                  value={kpis?.days_remaining != null ? String(kpis.days_remaining) : '—'}
                  hint="Working days to horizon end"
                  icon={CalendarRange}
                  tone={kpis?.days_remaining != null && kpis.days_remaining <= 5 ? 'amber' : 'neutral'}
                />
                <MetricCard label="Demand" value={qty(kpis?.demand_total)} icon={Target} />
                <MetricCard label="Good" value={qty(kpis?.good_total)} tone="success" icon={Package} />
                <MetricCard
                  label="Wave complete"
                  value={pctLabel(kpis?.pct_complete)}
                  hint={`${kpis?.active_count || 0} active · ${kpis?.queued_count || 0} queued · ${kpis?.completed_count || 0} done`}
                />
              </div>

              <div className="mes-split">
                <aside className="mes-split-list mes-card" style={{ padding: 12 }} aria-label="Campaign queue">
                  <h3 className="mes-section-title" style={{ fontSize: 14, margin: '4px 4px 12px' }}>
                    Campaign queue
                  </h3>
                  {!(review.campaigns || []).length ? (
                    <EmptyState
                      icon={Layers}
                      title="No campaigns in this wave"
                      description="This wave has no campaign rows."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {review.campaigns.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`mes-list-item${selectedCampaignId === c.id ? ' is-selected' : ''}`}
                          onClick={() => onSelectCampaign(c.id)}
                        >
                          <div className="mes-list-item-top">
                            <span className="mes-list-item-title">
                              #{c.demand_rank}{' '}
                              <TruncatedText>{c.component_label || 'Component'}</TruncatedText>
                            </span>
                            <StatusBadge status={c.status}>{c.status}</StatusBadge>
                          </div>
                          <p className="mes-list-item-sub" style={{ marginBottom: 0 }}>
                            {qty(c.good_quantity)} / {qty(c.target_quantity)} · {pctLabel(c.pct_complete)}
                            {c.run_out_days != null ? ` · RO ${Number(c.run_out_days).toFixed(1)}d` : ''}
                            {c.coverage ? ` · Cov ${pctLabel(c.coverage.pct_covered)}` : ''}
                          </p>
                          <p className="mes-list-item-meta" style={{ marginBottom: 0, marginTop: 4 }}>
                            FG {qty(c.fg_stock)} · WIP {qty(c.wip_stock)}
                            {c.production_days != null ? ` · ${c.production_days}d est` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </aside>

                <section className="mes-card" style={{ padding: 16 }} aria-label="Campaign detail">
                  <CampaignDetail key={selectedCampaign?.id || 'none'} campaign={selectedCampaign} />
                </section>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
