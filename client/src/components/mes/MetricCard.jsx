export default function MetricCard({ label, value, hint, icon: Icon, tone = 'neutral' }) {
  return (
    <div className={`mes-metric mes-metric-${tone}`}>
      <div className="mes-metric-top">
        <span className="mes-metric-label">{label}</span>
        {Icon ? (
          <span className="mes-metric-icon" aria-hidden>
            <Icon size={18} strokeWidth={1.75} />
          </span>
        ) : null}
      </div>
      <p className="mes-metric-value">{value}</p>
      {hint ? <p className="mes-metric-hint">{hint}</p> : null}
    </div>
  );
}
