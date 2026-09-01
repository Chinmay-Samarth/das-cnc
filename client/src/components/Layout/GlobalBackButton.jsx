import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/authContext';
import { resolveParentPath } from '../../utils/parentRoute';

export default function GlobalBackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { defaultHomePath } = useAuth();

  const homePath = defaultHomePath();
  const parent = resolveParentPath(pathname, searchParams);
  if (!parent) return null;

  // Hide back when already on the user's effective home (e.g. floor users on /production/today)
  if (pathname === homePath) return null;

  const target = parent === '/home' && homePath !== '/home' ? homePath : parent;

  return (
    <button
      type="button"
      className="global-back-btn"
      onClick={() => navigate(target)}
      aria-label="Go back"
    >
      <ArrowLeft size={18} />
    </button>
  );
}
