import { useId } from 'react';

const NUMERIC_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function getHealthMeta(score, target) {
  const delta = score - target;
  let label = 'EXCELLENT';
  let labelColor = '#059669';

  if (score < 60) {
    label = 'AT RISK';
    labelColor = '#dc2626';
  } else if (score < 85) {
    label = 'NEEDS ATTENTION';
    labelColor = '#d97706';
  }

  let deltaText = null;
  if (delta < 0) {
    deltaText = `Score is ${Math.abs(Math.round(delta))}% lower than target`;
  } else if (delta > 0) {
    deltaText = `Score is ${Math.round(delta)}% above target`;
  } else {
    deltaText = 'Score meets target';
  }

  return { label, labelColor, deltaText };
}

export default function AttendanceGauge({
  score = 0,
  size = 220,
  target = 88,
  variant = 'default',
}) {
  const gradientId = `gauge-${useId().replace(/:/g, '')}`;
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const { label, labelColor, deltaText } = getHealthMeta(safeScore, target);

  const cx = 120;
  const cy = 118;
  const r = 82;
  const strokeWidth = 14;
  const arcLength = Math.PI * r;
  const filledLength = (safeScore / 100) * arcLength;

  const startAngle = 180;
  const endAngle = 0;

  const gauge = (
    <div className="attendance-gauge-visual" style={{ width: size }}>
      <svg viewBox="0 0 240 140" className="attendance-gauge-svg" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>

        <path
          d={describeArc(cx, cy, r, startAngle, endAngle)}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        <path
          d={describeArc(cx, cy, r, startAngle, endAngle)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filledLength} ${arcLength}`}
        />
      </svg>

      <div className="attendance-gauge-center">
        <p className="attendance-gauge-score" style={{ fontFamily: NUMERIC_FONT }}>
          {Math.round(safeScore)}%
        </p>
        <p className="attendance-gauge-label" style={{ color: labelColor }}>
          {label}
        </p>
        {variant === 'card' ? (
          <p className="attendance-gauge-delta">{deltaText}</p>
        ) : null}
      </div>
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="attendance-gauge-card">
        <p className="attendance-gauge-eyebrow">Attendance Health</p>
        {gauge}
      </div>
    );
  }

  return (
    <div className="attendance-gauge-inline">
      {gauge}
      <p className="attendance-gauge-caption">Attendance score</p>
    </div>
  );
}
