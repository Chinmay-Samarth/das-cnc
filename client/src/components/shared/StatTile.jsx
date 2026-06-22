export default function StatTile({ label, value, accent }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderTop: `3px solid ${accent}`, borderRadius: '10px', padding: '14px 20px', background: '#fafafa' }}>
      <p className="text-xs uppercase font-medium" style={{ margin: 0, letterSpacing: '0.06em', color: '#6b7280' }}>{label}</p>
      <p className="font-bold" style={{ margin: '4px 0 0', fontSize: '26px', lineHeight: 1, color: '#111827', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {value}
      </p>
    </div>
  );
}
