import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Truck } from 'lucide-react';
import { EmptyState, StatusBadge, TruncatedText } from '../../components/mes';
import {
  formatDueLabel,
  formatScheduleLabel,
  isoWeekdayFromDate,
  weekdayShort,
} from '../../blanketPos/scheduleLabels';

function formatQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function carrierLabel(status) {
  if (status === 'released') return 'Released';
  if (status === 'planned') return 'Planned';
  return status || '—';
}

function dayNum(ymd) {
  const d = Number(String(ymd || '').slice(8, 10));
  return Number.isFinite(d) ? d : '';
}

export default function DeliveryTimelinePanel({ schedules }) {
  const navigate = useNavigate();
  const week = schedules?.week || [];
  const upcoming = schedules?.upcoming || [];
  const [selectedDate, setSelectedDate] = useState(null);

  const byDate = useMemo(() => {
    const map = {};
    for (const s of upcoming) {
      const key = String(s.due_date || '').slice(0, 10);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [upcoming]);

  useEffect(() => {
    if (!week.length) {
      setSelectedDate(null);
      return;
    }
    setSelectedDate((prev) => {
      if (prev && week.some((d) => d.date === prev)) return prev;
      const withItems = week.find((d) => (byDate[d.date] || []).length);
      return withItems?.date || week[0].date;
    });
  }, [week, byDate]);

  const selectedItems = selectedDate ? byDate[selectedDate] || [] : [];
  const selectedQty = selectedItems.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const planned = upcoming.filter((s) => s.status === 'planned').length;
  const released = upcoming.filter((s) => s.status === 'released').length;

  if (!week.length) {
    return <EmptyState title="No weekly deliveries" description="Nothing planned in the next 7 days." />;
  }

  return (
    <div className="mes-dash-weekcal">
      <div className="mes-cal-kpis mes-dash-weekcal-kpis">
        <div className="mes-cal-kpi">
          <span>Schedules</span>
          <strong>{schedules.count_7d || 0}</strong>
        </div>
        <div className="mes-cal-kpi is-amber">
          <span>Planned</span>
          <strong>{planned}</strong>
        </div>
        <div className="mes-cal-kpi is-green">
          <span>Released</span>
          <strong>{released}</strong>
        </div>
        <div className="mes-cal-kpi">
          <span>Total qty</span>
          <strong>{formatQty(schedules.qty_7d)}</strong>
        </div>
      </div>

      <div className="mes-cal-legend mes-dash-weekcal-legend" aria-label="Status legend">
        <span className="mes-cal-legend-item is-planned">Planned</span>
        <span className="mes-cal-legend-item is-released">Released</span>
      </div>

      <div className="mes-dash-weekcal-scroll">
        <div className="mes-cal-weekdays">
          {week.map((d) => (
            <div key={`h-${d.date}`} className="mes-cal-weekday">
              {weekdayShort(isoWeekdayFromDate(d.date)) || '—'}
            </div>
          ))}
        </div>
        <div className="mes-cal-grid mes-dash-weekcal-grid">
          {week.map((cell) => {
            const dayItems = byDate[cell.date] || [];
            const isToday = cell.date === week[0]?.date;
            const isSelected = cell.date === selectedDate;
            const dayQty = dayItems.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
            const visible = dayItems.slice(0, 3);
            const overflow = dayItems.length - visible.length;

            return (
              <button
                key={cell.date}
                type="button"
                className={[
                  'mes-cal-day',
                  isToday ? 'is-today' : '',
                  isSelected ? 'is-selected' : '',
                  dayItems.length ? 'has-items' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedDate(cell.date)}
              >
                <div className="mes-cal-day-head">
                  <span className="mes-cal-day-num">{dayNum(cell.date)}</span>
                  {dayItems.length ? (
                    <span className="mes-cal-day-qty">{formatQty(dayQty)}</span>
                  ) : null}
                </div>
                {dayItems.length ? (
                  <div className="mes-cal-day-events">
                    {visible.map((s) => (
                      <span
                        key={s.id}
                        className={`mes-cal-event is-${s.status || 'planned'}`}
                        title={`${formatScheduleLabel(s)} · qty ${formatQty(s.quantity)}`}
                      >
                        <span className="mes-cal-event-label">
                          {s.customer_name || s.schedule_number || 'Delivery'}
                        </span>
                        <span className="mes-cal-event-qty">{formatQty(s.quantity)}</span>
                      </span>
                    ))}
                    {overflow > 0 ? <span className="mes-cal-more">+{overflow} more</span> : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mes-dash-weekcal-side">
        <div className="mes-cal-side-head">
          <p className="mes-cal-side-eyebrow">Day board</p>
          <h2>{selectedDate ? formatDueLabel(selectedDate) : 'Select a day'}</h2>
          <p className="mes-cal-side-sub">
            {selectedDate
              ? `${selectedItems.length} ${selectedItems.length === 1 ? 'schedule' : 'schedules'} · qty ${formatQty(selectedQty)}`
              : 'Pick a date to inspect deliveries.'}
          </p>
        </div>

        {!selectedItems.length ? (
          <div className="mes-cal-side-empty">
            <Truck size={28} strokeWidth={1.5} />
            <p>No deliveries due</p>
            <span>Nothing planned for this day.</span>
          </div>
        ) : (
          <div className="mes-dash-weekcal-list">
            {selectedItems.map((s) => (
              <article key={s.id} className={`mes-cal-item is-${s.status || 'planned'}`}>
                <div className="mes-cal-item-top">
                  <div className="mes-cal-item-id">
                    <Package size={14} aria-hidden />
                    <span>{s.schedule_number || 'Schedule'}</span>
                  </div>
                  <StatusBadge status={s.status}>{carrierLabel(s.status)}</StatusBadge>
                </div>
                <h3 className="mes-cal-item-title">
                  <TruncatedText>{s.component_label || formatScheduleLabel(s)}</TruncatedText>
                </h3>
                <p className="mes-cal-item-meta">
                  <TruncatedText>
                    {[s.customer_name, s.blanket_number].filter(Boolean).join(' · ') || '—'}
                  </TruncatedText>
                </p>
                <div className="mes-cal-item-foot">
                  <span className="mes-cal-item-qty">
                    Qty <strong>{formatQty(s.quantity)}</strong>
                  </span>
                  {s.blanket_po_id ? (
                    <button
                      type="button"
                      className="mes-btn mes-btn-secondary"
                      onClick={() => navigate(`/blanket-pos/${s.blanket_po_id}`)}
                    >
                      PO
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
