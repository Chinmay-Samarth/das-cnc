import { useState } from 'react';
import { Check, LayoutGrid, Pencil, RefreshCw } from 'lucide-react';
import { AlertBanner, EmptyState, PageHeader } from '../../components/mes';
import { formatDisplayDate } from '../../utils/dateFormat';
import useFactoryDashboard from './useFactoryDashboard';
import { allowedSizesFor, readLayout, saveLayout, resetLayout } from './widgetOrder';
import { readKpiOrder, saveKpiOrder, resetKpiOrder } from './kpiTiles';
import DashboardWidget from './DashboardWidget';
import DashboardKpiStrip from './DashboardKpiStrip';
import AttendanceHealthPanel from './AttendanceHealthPanel';
import ProductionPulsePanel from './ProductionPulsePanel';
import CampaignProgressPanel from './CampaignProgressPanel';
import DeliveryTimelinePanel from './DeliveryTimelinePanel';
import OutsourceDuePanel from './OutsourceDuePanel';
import DispatchReadyPanel from './DispatchReadyPanel';
import P1AlertsPanel from './P1AlertsPanel';
import ApprovalsShortcutPanel from './ApprovalsShortcutPanel';
import HorizonWavePanel from './HorizonWavePanel';
import WcHeatmapPanel from './WcHeatmapPanel';

export default function FactoryDashboardPage() {
  const { data, loading, error, reload } = useFactoryDashboard();
  const [layout, setLayout] = useState(readLayout);
  const [kpiOrder, setKpiOrder] = useState(readKpiOrder);
  const [editing, setEditing] = useState(false);

  function persist(next) {
    setLayout(next);
    saveLayout(next);
  }

  function handleDrop(fromId, toId) {
    persist(
      (() => {
        const next = [...layout];
        const fromIdx = next.findIndex((w) => w.id === fromId);
        const toIdx = next.findIndex((w) => w.id === toId);
        if (fromIdx < 0 || toIdx < 0) return layout;
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      })()
    );
  }

  function handleSizeChange(id, size) {
    if (!allowedSizesFor(id).includes(size)) return;
    persist(layout.map((w) => (w.id === id ? { ...w, size } : w)));
  }

  function handleResetLayout() {
    persist(resetLayout());
    const nextKpis = resetKpiOrder();
    setKpiOrder(nextKpis);
  }

  function persistKpis(next) {
    setKpiOrder(next);
    saveKpiOrder(next);
  }

  const widgets = {
    attendance: {
      title: 'Attendance health',
      to: '/attendance',
      body: <AttendanceHealthPanel attendance={data?.attendance} />,
    },
    production: {
      title: 'Production pulse',
      to: '/production?status=RUNNING',
      body: <ProductionPulsePanel production={data?.production} />,
    },
    campaigns: {
      title: 'Campaign progress',
      to: '/production/campaigns',
      body: <CampaignProgressPanel campaigns={data?.campaigns} />,
    },
    heatmap: {
      title: 'Work-center heatmap',
      to: '/production/work-centers',
      body: <WcHeatmapPanel workCenters={data?.work_centers} />,
    },
    delivery: {
      title: 'Weekly deliveries',
      to: '/delivery-schedules',
      body: <DeliveryTimelinePanel schedules={data?.delivery_schedules} />,
    },
    outsource: {
      title: 'Outsource due',
      to: '/production/outsource',
      body: <OutsourceDuePanel outsource={data?.outsource} />,
    },
    waves: {
      title: 'Horizon waves',
      to: '/production/horizon-planner',
      body: <HorizonWavePanel waves={data?.horizon_waves} />,
    },
    dispatch: {
      title: 'Ready for dispatch',
      to: '/production/dispatch',
      body: <DispatchReadyPanel dispatch={data?.dispatch} />,
    },
    alerts: {
      title: 'P1 alerts',
      to: '/notifications?priority=1',
      body: (
        <P1AlertsPanel alerts={data?.notifications_p1} inventory={data?.inventory_p1} />
      ),
    },
    approvals: {
      title: 'Approvals',
      to: '/approvals',
      body: <ApprovalsShortcutPanel approvals={data?.approvals} />,
    },
  };

  return (
    <main className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Factory"
        title="Home"
        subtitle={
          data?.date
            ? `Bird's-eye view · ${formatDisplayDate(data.date)}`
            : "Bird's-eye view of today's factory"
        }
        actions={
          <>
            <button
              type="button"
              className={` ${editing ? 'primary-button' : 'neutral-button'}`}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? <Check size={15} /> : <Pencil size={15} />}
              {editing ? 'Done' : 'Customize'}
            </button>
            <button
              type="button"
              className="neutral-button"
              onClick={handleResetLayout}
            >
              <LayoutGrid size={15} />
              Reset layout
            </button>
            <button
              type="button"
              className="neutral-button"
              onClick={() => reload()}
              disabled={loading}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </>
        }
      />

      {error ? <AlertBanner title="Unable to load dashboard">{error}</AlertBanner> : null}

      {loading && !data ? (
        <EmptyState title="Loading factory dashboard" description="Pulling live attendance, production, and supply signals." />
      ) : (
        <>
          {editing ? (
            <p className="mes-dash-edit-hint">
              Drag tiles to reorder. Hide with −, add from the plus card. Right-click a widget to change its size.
            </p>
          ) : null}
          <DashboardKpiStrip
            data={data}
            editing={editing}
            order={kpiOrder}
            onChange={persistKpis}
          />
          <div className="mes-dashboard-grid">
            {layout.map((item) => {
              const widget = widgets[item.id];
              if (!widget) return null;
              return (
                <DashboardWidget
                  key={item.id}
                  id={item.id}
                  size={item.size}
                  title={widget.title}
                  href={widget.to}
                  onDrop={handleDrop}
                  onSizeChange={handleSizeChange}
                >
                  {widget.body}
                </DashboardWidget>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
