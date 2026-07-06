import { useNavigate, useLocation } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <main className="app-shell employee-details-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Error</p>
          <h1>Page not found</h1>
          <p className="muted">
            The page <code style={{ fontSize: 13 }}>{location.pathname}</code> does not exist.
          </p>
        </div>
      </header>

      <section className="card form-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <p style={{ fontSize: 72, fontWeight: 700, color: '#d1d5db', margin: '0 0 16px', lineHeight: 1 }}>404</p>
        <p className="muted" style={{ marginBottom: 24, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
          The link may be broken or the page may have been moved. Use the buttons below to get back on track.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="primary-button" onClick={() => navigate('/home')}>
            <Home size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Go to Home
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Go Back
          </button>
        </div>
      </section>
    </main>
  );
}
