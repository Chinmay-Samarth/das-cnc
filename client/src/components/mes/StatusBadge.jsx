const TONE_MAP = {
  overdue: 'mes-badge-danger',
  OVERDUE: 'mes-badge-danger',
  cancelled: 'mes-badge-danger',
  inactive: 'mes-badge-danger',
  closed: 'mes-badge-danger',
  blocked: 'mes-badge-danger',

  completed: 'mes-badge-success',
  COMPLETED: 'mes-badge-success',
  active: 'mes-badge-success',
  received: 'mes-badge-success',
  released: 'mes-badge-success',

  ready: 'mes-badge-amber',
  READY: 'mes-badge-amber',
  planned: 'mes-badge-amber',
  draft: 'mes-badge-amber',
  pending: 'mes-badge-amber',
  unassigned: 'mes-badge-amber',
  on_hold: 'mes-badge-amber',

  running: 'mes-badge-info',
  RUNNING: 'mes-badge-info',
  assigned: 'mes-badge-info',
};

export default function StatusBadge({ status, children, className = '' }) {
  const label = children ?? status ?? '—';
  const tone = TONE_MAP[status] || 'mes-badge-neutral';
  return (
    <span className={`mes-badge ${tone} ${className}`.trim()}>
      {label}
    </span>
  );
}
