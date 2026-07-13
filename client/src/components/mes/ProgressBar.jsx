export default function ProgressBar({ value = 0, max = 100, label, showLabel = true }) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (Number(value) / safeMax) * 100));
  return (
    <div className="mes-progress">
      {showLabel && label ? (
        <div className="mes-progress-label">
          <span>{label}</span>
          <span>
            {Math.round(value)} / {Math.round(max)}
          </span>
        </div>
      ) : null}
      <div className="mes-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="mes-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
