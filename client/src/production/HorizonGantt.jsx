import { useMemo } from 'react';
import { Gantt, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

function parseYmd(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return new Date();
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addWorkingDays(fromStr, n) {
  const d = parseYmd(fromStr);
  let left = Math.max(0, n);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) left -= 1;
  }
  return d;
}

/**
 * Read-only MES-themed Gantt for horizon campaign queue.
 */
export default function HorizonGantt({ campaigns = [], horizonStart, starvationIds = [] }) {
  const tasks = useMemo(() => {
    const startBase = horizonStart || new Date().toISOString().slice(0, 10);
    return (campaigns || []).map((c, i) => {
      const start =
        c.planned_start
          ? parseYmd(c.planned_start)
          : addWorkingDays(startBase, c.start_offset_days || 0);
      const days = Math.max(1, Number(c.production_days || c.capacity?.productionDays || 1));
      const end = c.planned_end ? parseYmd(c.planned_end) : addWorkingDays(start.toISOString().slice(0, 10), days);
      const starved = starvationIds.includes(c.master_record_id);
      return {
        id: String(c.master_record_id || i),
        name: `#${c.demand_rank || i + 1} ${c.component_label || 'Component'}${
          Number.isFinite(c.run_out_days) ? ` (${Number(c.run_out_days).toFixed(0)}d)` : ''
        }`,
        start,
        end: end <= start ? addWorkingDays(start.toISOString().slice(0, 10), 1) : end,
        progress: 0,
        type: 'task',
        isDisabled: true,
        styles: {
          backgroundColor: starved ? 'var(--amber-text, #b45309)' : 'var(--blue-text, #1d4ed8)',
          backgroundSelectedColor: starved ? 'var(--amber-text, #b45309)' : 'var(--blue-text, #1d4ed8)',
          progressColor: 'var(--green-text, #15803d)',
          progressSelectedColor: 'var(--green-text, #15803d)',
        },
      };
    });
  }, [campaigns, horizonStart, starvationIds]);

  if (!tasks.length) {
    return <p className="muted" style={{ margin: 0 }}>No campaigns to chart.</p>;
  }

  return (
    <div className="horizon-gantt">
      <Gantt
        tasks={tasks}
        viewMode={ViewMode.Week}
        listCellWidth=""
        columnWidth={48}
        barFill={70}
        rowHeight={36}
        headerHeight={40}
        fontFamily="inherit"
        fontSize="12"
      />
    </div>
  );
}
