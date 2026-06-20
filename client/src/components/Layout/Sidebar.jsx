import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import { useMastersNav } from '../../context/MastersNavContext';

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/employees', label: 'Employees' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/customers', label: 'Customers'},
  { to: '/invoices', label: 'Invoices' },
  { to: '/components', label: 'Components' },
];

export default function Sidebar({ onNavigate }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { masters, loading } = useMastersNav();

  return (
    <>
      <div className="sidebar-brand">
        <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo sidebar-logo" />
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section-label">Navigation</p>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/home'}
            className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
            onClick={onNavigate}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-masters">
        <div className="sidebar-masters-header">
          <p className="sidebar-section-label">Masters</p>
          <NavLink
            to="/masters/new"
            className={({ isActive }) => `sidebar-add-master${isActive ? ' is-active' : ''}`}
            onClick={onNavigate}
          >
            + Add Master
          </NavLink>
        </div>

        <nav className="sidebar-masters-list">
          {loading ? (
            <p className="sidebar-muted">Loading masters…</p>
          ) : masters.length === 0 ? (
            <p className="sidebar-muted">No masters yet</p>
          ) : (
            masters.map((master) => (
              <NavLink
                key={master.id}
                to={`/masters/${master.id}`}
                className={({ isActive }) => {
                  const onMaster =
                    isActive || location.pathname.startsWith(`/masters/${master.id}/`);
                  return `sidebar-link sidebar-master-link${onMaster ? ' is-active' : ''}`;
                }}
                onClick={onNavigate}
              >
                {master.icon ? <span className="sidebar-master-icon">{master.icon}</span> : null}
                <span className="sidebar-master-name">{master.name}</span>
              </NavLink>
            ))
          )}
        </nav>
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-user">{user?.name}</span>
        <button type="button" className="secondary-btn sidebar-logout" onClick={logout}>
          Logout
        </button>
      </div>
    </>
  );
}
