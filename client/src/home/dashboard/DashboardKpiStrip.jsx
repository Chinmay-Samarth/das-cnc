import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  ClipboardList,
  Factory,
  PackageCheck,
  PackageX,
  Plus,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { MetricCard } from '../../components/mes';
import { KPI_IDS } from './kpiTiles';

function buildCatalog(data) {
  const att = data?.attendance?.summary || {};
  const presentPct =
    att.total > 0 ? Math.round((Number(att.present || 0) / att.total) * 100) : 0;
  const running = data?.production?.counts?.running || 0;
  const schedules = data?.delivery_schedules?.count_7d || 0;
  const dispatchable = data?.dispatch?.counts?.dispatchable || 0;
  const p1 = data?.notifications_p1?.count || 0;
  const invP1 = data?.inventory_p1?.count || 0;
  const approvals =
    (data?.approvals?.dispatch_shortfall_pending || 0) + (data?.approvals?.girn_ready || 0);

  return {
    attendance: {
      label: 'Attendance',
      value: `${presentPct}%`,
      hint: `${att.present || 0} on duty · ${att.absent || 0} absent`,
      icon: CalendarCheck,
      tone: presentPct >= 90 ? 'success' : presentPct >= 75 ? 'amber' : 'danger',
      to: '/attendance',
    },
    running: {
      label: 'Running cards',
      value: running,
      hint: `${data?.production?.counts?.scheduled || 0} scheduled today`,
      icon: Factory,
      tone: running ? 'info' : 'neutral',
      to: '/production?status=RUNNING',
    },
    schedules: {
      label: 'Schedules (7d)',
      value: schedules,
      hint: 'Planned / released deliveries',
      icon: Truck,
      tone: 'neutral',
      to: '/delivery-schedules',
    },
    dispatch: {
      label: 'Dispatch ready',
      value: dispatchable,
      hint: `${data?.dispatch?.counts?.blocked || 0} blocked`,
      icon: PackageCheck,
      tone: dispatchable ? 'success' : 'neutral',
      to: '/production/dispatch',
    },
    approvals: {
      label: 'Approvals',
      value: approvals,
      hint: `${data?.approvals?.dispatch_shortfall_pending || 0} shortfall · ${data?.approvals?.girn_ready || 0} GIRN`,
      icon: ClipboardList,
      tone: approvals ? 'amber' : 'success',
      to: '/approvals',
    },
    p1: {
      label: 'P1 alerts',
      value: p1,
      hint: 'Unread critical alerts',
      icon: PackageX,
      tone: p1 ? 'danger' : 'success',
      to: '/notifications?priority=1',
    },
    inventory: {
      label: 'Inventory P1',
      value: invP1,
      hint: `${data?.inventory_p1?.insufficient_stock || 0} short · ${data?.inventory_p1?.reorder_purchase_required || 0} reorder`,
      icon: ShoppingCart,
      tone: invP1 ? 'danger' : 'success',
      to: '/notifications?category=inventory',
    },
  };
}

export default function DashboardKpiStrip({ data, editing, order, onChange }) {
  const navigate = useNavigate();
  const catalog = useMemo(() => buildCatalog(data), [data]);
  const [addOpen, setAddOpen] = useState(false);
  const visible = (order || []).filter((id) => catalog[id]);
  const hidden = KPI_IDS.filter((id) => !visible.includes(id));

  useEffect(() => {
    if (!addOpen) return undefined;
    function onDoc() {
      setAddOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [addOpen]);

  function hideTile(id) {
    if (visible.length <= 1) return;
    onChange?.(visible.filter((x) => x !== id));
  }

  function addTile(id) {
    if (visible.includes(id)) return;
    onChange?.([...visible, id]);
    setAddOpen(false);
  }

  function handleDrop(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const next = [...visible];
    const fromIdx = next.indexOf(fromId);
    const toIdx = next.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);
    onChange?.(next);
  }

  return (
    <div className={`mes-dashboard-kpis${editing ? ' is-editing' : ''}`}>
      {visible.map((id) => {
        const card = catalog[id];
        return (
          <div
            key={id}
            className="mes-kpi-tile"
            draggable={editing}
            onDragStart={(e) => {
              if (!editing) return;
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!editing) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (!editing) return;
              e.preventDefault();
              handleDrop(e.dataTransfer.getData('text/plain'), id);
            }}
          >
            {editing ? (
              <button
                type="button"
                className="mes-kpi-minus"
                aria-label={`Hide ${card.label}`}
                title="Hide tile"
                onClick={() => hideTile(id)}
                disabled={visible.length <= 1}
              >
                −
              </button>
            ) : null}
            <button
              type="button"
              className="mes-metric-btn"
              onClick={() => {
                if (!editing) navigate(card.to);
              }}
            >
              <MetricCard
                label={card.label}
                value={card.value}
                hint={card.hint}
                icon={card.icon}
                tone={card.tone}
              />
            </button>
          </div>
        );
      })}

      {editing && hidden.length ? (
        <div className="mes-kpi-add-wrap">
          <button
            type="button"
            className="mes-kpi-add"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setAddOpen((v) => !v)}
          >
            <Plus size={18} />
            Add tile
          </button>
          {addOpen ? (
            <div className="mes-kpi-add-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
              {hidden.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  onClick={() => addTile(id)}
                >
                  {catalog[id].label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
