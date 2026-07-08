export default function StatTile({ label, value, accent, subtext, fontSize = '50px' }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderLeft: `4px solid ${accent}`, borderRadius: '6px', padding: '24px 20px', background: '#fff' }}>
      <p className="text-xs uppercase font-bold" style={{ margin: 0, letterSpacing: '0.06em', color: '#6b7280' }}>{label}</p>
      <p className="font-bold" style={{ margin: '4px 0 0', fontSize: `${fontSize}`, lineHeight: 1, color: '#111827', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {value}
      </p>
      <p style={{margin: '0', fontSize: "13px", color: "#64748b" }}>{subtext}</p>
    </div>
  );
}
