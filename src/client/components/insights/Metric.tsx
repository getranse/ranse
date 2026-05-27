export function Metric({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
        {value}
      </div>
      {sublabel && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
