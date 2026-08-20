import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  IndianRupee,
  PackageX,
  Plus,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { MetricCard } from '../../components/mes';
import { KPI_IDS } from './kpiTiles';
import Sparkline from './Sparkline';
import { formatInr, formatQty } from './chartUtils';

function buildCatalog(data) {
  const att = data?.attendance?.summary || {};
  const presentPct =
    att.total > 0 ? Math.round((Number(att.present || 0) / att.total) * 100) : 0;
  const kpis = data?.analytics?.kpis || {};
  const scrapPct = kpis.scrap_rate_pct ?? 0;
  const overdueQty = kpis.overdue_qty ?? 0;
  const revenueMtd = kpis.revenue_mtd ?? 0;
  const openPo = kpis.open_po_exposure ?? 0;

  return {
    revenue: {
      label: 'Revenue MTD',
      value: formatInr(revenueMtd),
      hint: 'Billed sales invoices',
      icon: IndianRupee,
      tone: revenueMtd > 0 ? 'success' : 'neutral',
      to: '/sales-invoices',
      spark: kpis.revenue_7d,
      sparkColor: '#2563eb',
    },
    scrap_rate: {
      label: 'Scrap rate',
      value: `${scrapPct}%`,
      hint: 'Last 14 days good vs scrap',
      icon: PackageX,
      tone: scrapPct >= 8 ? 'danger' : scrapPct >= 3 ? 'amber' : 'success',
      to: '/production',
      spark: kpis.scrap_spark,
      sparkColor: '#dc2626',
    },
    delivery_risk: {
      label: 'Overdue qty',
      value: formatQty(overdueQty),
      hint: 'Past-due delivery schedules',
      icon: Truck,
      tone: overdueQty > 0 ? 'danger' : 'success',
      to: '/delivery-schedules',
      spark: (data?.analytics?.delivery_series || data?.delivery_schedules?.delivery_series || [])
        .slice(0, 7)
        .map((d) => ({ value: d.qty })),
      sparkColor: '#d97706',
    },
    attendance: {
      label: 'Attendance',
      value: `${presentPct}%`,
      hint: `${att.present || 0} on duty · ${att.absent || 0} absent`,
      icon: CalendarCheck,
      tone: presentPct >= 90 ? 'success' : presentPct >= 75 ? 'amber' : 'danger',
      to: '/attendance',
      spark: null,
      sparkColor: '#047857',
    },
    open_po: {
      label: 'Open PO ₹',
      value: formatInr(openPo),
      hint: 'Draft + due + delivered exposure',
      icon: ShoppingCart,
      tone: openPo > 0 ? 'info' : 'neutral',
      to: '/purchase-orders',
      spark: (data?.analytics?.procurement_series || []).map((d) => ({ value: d.po_opened })),
      sparkColor: '#6366f1',
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
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                −
              </button>
            ) : null}
            <button
              type="button"
              className="mes-metric-btn mes-metric-btn-spark"
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
              <Sparkline data={card.spark} color={card.sparkColor} />
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
                  className="global-serach-result"
                >
                  <span className="global-search-result-title">{catalog[id].label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
