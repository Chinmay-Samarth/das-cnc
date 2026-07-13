export default function ProgressRing({ value = 0, max = 100, size = 52, stroke = 5, label }) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(1, Math.max(0, Number(value) / safeMax));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const text = label ?? `${Math.round(value)}/${Math.round(max)}`;

  return (
    <div className="mes-ring" style={{ width: size, height: size }} title={text}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          className="mes-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="mes-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="mes-ring-label">{text}</span>
    </div>
  );
}
