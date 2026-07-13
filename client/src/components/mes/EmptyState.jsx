import { Inbox } from 'lucide-react';

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}) {
  return (
    <div className="mes-empty">
      <div className="mes-empty-icon" aria-hidden>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <h3 className="mes-empty-title">{title}</h3>
      {description ? <p className="mes-empty-desc">{description}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="mes-btn mes-btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {actionLabel && actionHref && !onAction ? (
        <a className="mes-btn mes-btn-primary" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
    </div>
  );
}
