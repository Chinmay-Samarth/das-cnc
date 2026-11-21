import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { useAuth } from '../auth/authContext';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { defaultHomePath } = useAuth();
  const homePath =
    typeof defaultHomePath === 'function'
      ? defaultHomePath() || '/auth/login'
      : '/auth/login';

  return (
    <main className="mes-shell">
      <section className="not-found-page fade-up" role="alert">
        <div className="not-found-code" aria-hidden="true">
          404
        </div>
        <h1 className="not-found-title">Page not found</h1>
        <p className="not-found-description">
          We couldn&apos;t find <code className="not-found-path">{location.pathname}</code>. The
          link may be broken or the page may have been moved.
        </p>
        <div className="not-found-actions">
          <button type="button" className="mes-btn mes-btn-primary" onClick={() => navigate(homePath)}>
            <Home size={16} />
            Go home
          </button>
          <button type="button" className="mes-btn mes-btn-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            Go back
          </button>
        </div>
      </section>
    </main>
  );
}
