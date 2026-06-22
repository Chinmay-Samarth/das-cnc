// Calibrated dial-style gauge for an attendance score (0-100).
// Drawn as three fixed threshold zones (at-risk / needs attention / excellent)
// with a needle that rotates to the current score, similar to an instrument
// panel gauge. Pure SVG, no external charting library required.
//
// Thresholds (edit ZONES below to change them):
//   0-59   at risk            (red)
//   60-84  needs attention    (amber)
//   85-100 excellent          (green)

const ZONES = [
  { from: 0, to: 60, color: '#dc2626' },
  { from: 60, to: 85, color: '#d97706' },
  { from: 85, to: 100, color: '#059669' },
];

const NUMERIC_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function valueToAngle(value) {
  const clamped = Math.max(0, Math.min(100, value));
  return 180 + (clamped / 100) * 180;
}

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

export default function AttendanceGauge({ score = 0, size = 220 }) {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;

  const cx = 130;
  const cy = 128;
  const r = 88;
  const strokeWidth = 16;

  const needleAngle = valueToAngle(safeScore);
  const tip = polarToCartesian(cx, cy, 78, needleAngle);
  const baseLeft = polarToCartesian(cx, cy, 7, needleAngle - 90);
  const baseRight = polarToCartesian(cx, cy, 7, needleAngle + 90);

  const zoneLabel = safeScore >= 85 ? 'Excellent' : safeScore >= 60 ? 'Needs attention' : 'At risk';
  const zoneColor = safeScore >= 85 ? '#059669' : safeScore >= 60 ? '#d97706' : '#dc2626';

  return (
    <div style={{ width: size, flexShrink: 0 }} className="flex flex-col items-center">
      <svg viewBox="0 0 260 150" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {ZONES.map((zone) => (
          <path
            key={zone.from}
            d={describeArc(cx, cy, r, valueToAngle(zone.from), valueToAngle(zone.to))}
            fill="none"
            stroke={zone.color}
            strokeWidth={strokeWidth}
            opacity={0.92}
          />
        ))}

        {[0, 50, 100].map((tickValue) => {
          const pos = polarToCartesian(cx, cy, r + 18, valueToAngle(tickValue));
          return (
            <text
              key={tickValue}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fontFamily={NUMERIC_FONT}
              fill="#9ca3af"
            >
              {tickValue}
            </text>
          );
        })}

        <polygon
          points={`${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${baseLeft.x.toFixed(2)},${baseLeft.y.toFixed(2)} ${baseRight.x.toFixed(2)},${baseRight.y.toFixed(2)}`}
          fill="#111827"
        />
        <circle cx={cx} cy={cy} r="9" fill="#111827" />
        <circle cx={cx} cy={cy} r="3.5" fill="#ffffff" />

        <text
          x={cx}
          y={cy - 34}
          textAnchor="middle"
          fontSize="32"
          fontWeight="700"
          fontFamily={NUMERIC_FONT}
          fill="#111827"
        >
          {Math.round(safeScore)}%
        </text>
      </svg>

      <p
        className="text-xs uppercase font-medium"
        style={{ margin: '2px 0 0', letterSpacing: '0.08em', color: '#6b7280' }}
      >
        Attendance score
      </p>
      <p className="text-sm font-semibold" style={{ margin: '2px 0 0', color: zoneColor }}>
        {zoneLabel}
      </p>
    </div>
  );
}

