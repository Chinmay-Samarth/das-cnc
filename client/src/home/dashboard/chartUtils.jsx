const AXIS = '#94a3b8';
const GRID = '#e2e8f0';

export const CHART = {
  axis: AXIS,
  grid: GRID,
  good: '#047857',
  scrap: '#dc2626',
  billed: '#2563eb',
  paid: '#059669',
  po: '#6366f1',
  girn: '#0d9488',
  delivery: '#2563eb',
  running: '#047857',
  scheduled: '#2563eb',
  overdue: '#dc2626',
  campaignOk: '#047857',
  campaignRisk: '#d97706',
  campaignCritical: '#dc2626',
  ot: '#dc2626',
};

export function formatShortDate(ymd) {
  if (!ymd) return '';
  const str = String(ymd).slice(0, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const d = new Date(`${str}T00:00:00`);
  if (Number.isNaN(d.getTime())) return str;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

export function formatInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export function DashChartTooltip({ title, rows }) {
  return (
    <div className="emp-chart-tooltip">
      {title ? <p className="emp-chart-tooltip-title">{title}</p> : null}
      {(rows || []).map((row) => (
        <p key={row.label}>
          {row.color ? <span className="emp-chart-swatch" style={{ background: row.color }} /> : null}
          {row.label}: {row.value}
        </p>
      ))}
    </div>
  );
}
