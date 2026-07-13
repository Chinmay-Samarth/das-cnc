import { AlertTriangle } from 'lucide-react';

export default function AlertBanner({ tone = 'danger', title, children, icon: Icon = AlertTriangle }) {
  return (
    <div className={`mes-alert mes-alert-${tone}`} role="alert">
      <span className="mes-alert-icon" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="mes-alert-body">
        {title ? <strong>{title}</strong> : null}
        {children ? <div className="mes-alert-msg">{children}</div> : null}
      </div>
    </div>
  );
}
