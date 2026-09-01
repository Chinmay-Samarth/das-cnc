import { useNavigate, useLocation } from 'react-router-dom';
import { Home } from 'lucide-react';
import { useAuth } from '../auth/authContext';
import { EmptyState } from '../components/mes';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { defaultHomePath } = useAuth();

  return (
    <main className="mes-shell">
      <EmptyState
        title="Page not found"
        description={`The page ${location.pathname} does not exist. The link may be broken or the page may have been moved.`}
      />
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" className="primary-button" onClick={() => navigate(defaultHomePath())}>
          <Home size={16} />
          Go to Home
        </button>
      </div>
    </main>
  );
}
