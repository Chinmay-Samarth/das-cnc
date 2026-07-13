import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import {
  LogOut,
  Home,
  FileText,
  Truck,
  UserCheck,
  Factory,
  LayoutGrid,
  Users,
  CalendarCheck,
  Building2,
  Package,
  Warehouse,
  ClipboardList,
  Receipt,
  Wrench,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    id: 'home',
    label: null,
    items: [{ to: '/home', label: 'Home', icon: Home, end: true }],
  },
  {
    id: 'sourcing',
    label: 'Sourcing',
    items: [{ to: '/blanket-pos', label: 'Blanket POs', icon: FileText }],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    items: [{ to: '/delivery-schedules', label: 'Delivery Schedules', icon: Truck }],
  },
  {
    id: 'operator',
    label: 'Operator',
    items: [{ to: '/production/today', label: 'My Today', icon: UserCheck }],
  },
  {
    id: 'shopfloor',
    label: 'Shop floor',
    items: [
      { to: '/production', label: 'Production', icon: Factory, end: true },
      { to: '/production/work-centers', label: 'WC Board', icon: LayoutGrid },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { to: '/work-centers', label: 'Work Centers', icon: Wrench },
      { to: '/customers', label: 'Customers', icon: Building2 },
      { to: '/suppliers', label: 'Suppliers', icon: Package },
      { to: '/stock', label: 'Stock', icon: Warehouse },
      { to: '/girn', label: 'GIRN', icon: ClipboardList },
      { to: '/invoices', label: 'Invoices', icon: Receipt },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { to: '/employees', label: 'Employees', icon: Users },
    ],
  },
];

export default function Sidebar({ onNavigate }) {
  const { user, logout } = useAuth();
  const [masters, setMasters] = useState([]);

  useEffect(() => {
    api.get('/masters/sidebar').then((res) => {
      setMasters(res.data || []);
    });
  }, []);

  return (
    <>
      <div className="sidebar-brand">
        <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo sidebar-logo" />
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="sidebar-domain">
            {section.label ? <p className="sidebar-section-label">{section.label}</p> : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end || false}
                  className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
                  onClick={onNavigate}
                >
                  {Icon ? <Icon size={16} className="sidebar-link-icon" aria-hidden /> : null}
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}

        {masters.length ? (
          <div className="sidebar-domain">
            <p className="sidebar-section-label">Masters</p>
            {masters.map((m) => (
              <NavLink
                key={m.slug}
                to={`/masters/${m.slug}`}
                className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
                onClick={onNavigate}
              >
                <span>{m.name.replace(/\s*Master$/i, '')}</span>
              </NavLink>
            ))}
          </div>
        ) : null}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar">
          {user?.name
            ?.split(' ')
            .map((n) => n[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user">{user?.name}</span>
          <span className="sidebar-user-role">{user?.job_description || 'Worker'}</span>
        </div>
        <button type="button" className="logout-btn" onClick={logout} aria-label="Log out">
          <LogOut size={15} />
        </button>
      </div>
    </>
  );
}
