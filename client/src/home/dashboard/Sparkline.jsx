import { Line, LineChart, ResponsiveContainer } from 'recharts';

/** Tiny trend line for KPI tiles — always reserves height so tiles stay even */
export default function Sparkline({ data, color = '#2563eb' }) {
  const points = (data || [])
    .map((d) => ({
      v: typeof d === 'number' ? d : Number(d?.value) || 0,
    }))
    .filter((d) => Number.isFinite(d.v));

  const hasLine = points.length >= 2;

  return (
    <div className={`mes-kpi-spark${hasLine ? '' : ' is-empty'}`} aria-hidden>
      {hasLine ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
