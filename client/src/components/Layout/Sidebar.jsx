import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import { useEffect, useMemo, useState } from 'react';
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
  CalendarOff,
  Building2,
  Package,
  Warehouse,
  ClipboardList,
  Receipt,
  Wrench,
  PackageCheck,
  Send,
  ChevronDown,
  Database,
  Layers,
  IndianRupee,
  Plus,
} from 'lucide-react';

const STORAGE_KEY = 'das-sidebar-open-sections';

const NAV_SECTIONS = [
  {
    id: 'sourcing',
    label: 'Sourcing',
    items: [
      { to: '/blanket-pos', label: 'Blanket POs', icon: FileText },
      { to: '/delivery-schedules', label: 'Delivery Schedules', icon: Truck },
    ],
  },
  {
    id: 'shopfloor',
    label: 'Shop floor',
    items: [
      { to: '/production/horizon-planner', label: 'Horizon Planner', icon: Factory },
      { to: '/production/campaigns', label: 'Campaigns', icon: Layers },
      { to: '/production/today', label: 'My Today', icon: UserCheck, managerOnly: true },
      { to: '/production', label: 'Production', icon: Factory, end: true },
      { to: '/production/work-centers', label: 'WC Board', icon: LayoutGrid },
      { to: '/production/outsource', label: 'Outsourcing', icon: Send },
      { to: '/production/dispatch', label: 'Ready for Dispatch', icon: PackageCheck },
      {
        to: '/approvals',
        label: 'Approvals',
        icon: ClipboardList,
        adminOrSupervisorOnly: true,
      },
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
      { to: '/sales-invoices', label: 'Sales Invoices', icon: IndianRupee },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { to: '/leave-requests', label: 'Leave Requests', icon: CalendarOff },
      { to: '/employees', label: 'Employees', icon: Users },
    ],
  },
];

function readStoredOpen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isPathActive(pathname, to, end = false) {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function sectionHasActive(pathname, items) {
  return items.some((item) => isPathActive(pathname, item.to, item.end));
}

function NavItem({ item, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end || false}
      className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
      onClick={onNavigate}
    >
      {Icon ? <Icon size={16} className="sidebar-link-icon" aria-hidden /> : null}
      <span className="sidebar-link-label">{item.label}</span>
    </NavLink>
  );
}

function CollapsibleSection({ id, label, items, open, onToggle, onNavigate, headerAction }) {
  const panelId = `sidebar-section-${id}`;
  return (
    <div className={`sidebar-section${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="sidebar-section-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(id)}
      >
        <span className="sidebar-section-label">{label}</span>
        <span className="sidebar-section-actions">
          {headerAction}
          <ChevronDown size={14} className="sidebar-section-chevron" aria-hidden />
        </span>
      </button>
      <div id={panelId} className="sidebar-section-body" hidden={!open}>
        {items.map((item) => (
          <NavItem key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

export default function Sidebar({ onNavigate }) {
  const { user, logout, isFloorOnly, isAdmin, defaultHomePath } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [masters, setMasters] = useState([]);
  const [managesWorkCenter, setManagesWorkCenter] = useState(false);
  const [openSections, setOpenSections] = useState(() => readStoredOpen() || {});
  const floorOnly = isFloorOnly();

  useEffect(() => {
    if (floorOnly) {
      setMasters([]);
      return undefined;
    }
    api.get('/masters/sidebar').then((res) => {
      setMasters(res.data || []);
    });
  }, [floorOnly]);

  useEffect(() => {
    if (floorOnly) {
      setManagesWorkCenter(false);
      return undefined;
    }
    api
      .get('/campaigns/managed-work-centers')
      .then(({ data }) => {
        setManagesWorkCenter((data.work_centers || []).length > 0);
      })
      .catch(() => setManagesWorkCenter(false));
  }, [floorOnly]);

  const sections = useMemo(() => {
    if (floorOnly) {
      return [
        {
          id: 'shopfloor',
          label: 'Shop floor',
          items: [
            { to: '/production/today', label: 'My Today', icon: UserCheck },
            { to: '/leave-requests', label: 'Leave Request', icon: CalendarOff },
          ],
        },
      ];
    }

    const isReviewer =
      user?.accessLevel === 'ADMIN' || user?.accessLevel === 'SUPERVISOR';

    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.managerOnly && !managesWorkCenter) return false;
        if (item.adminOrSupervisorOnly && !isReviewer) return false;
        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [managesWorkCenter, floorOnly, user?.accessLevel]);

  const masterItems = useMemo(
    () =>
      floorOnly
        ? []
        : masters.map((m) => ({
            to: `/masters/${m.slug}`,
            label: m.name.replace(/\s*Master$/i, ''),
            icon: Database,
          })),
    [masters, floorOnly]
  );

  // Auto-open the section that owns the current route
  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const section of sections) {
        if (sectionHasActive(location.pathname, section.items) && !next[section.id]) {
          next[section.id] = true;
          changed = true;
        }
      }
      if (masterItems.length && sectionHasActive(location.pathname, masterItems) && !next.masters) {
        next.masters = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [location.pathname, sections, masterItems]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openSections));
    } catch {
      /* ignore */
    }
  }, [openSections]);

  function toggleSection(id) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const initials =
    user?.name
      ?.split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <>
      <div className="sidebar-brand">
        <NavLink
          to={defaultHomePath()}
          className="sidebar-brand-link"
          aria-label="Go to home"
          onClick={onNavigate}
        >
          <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo sidebar-logo" />
        </NavLink>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        {isAdmin() ? (
          <div className="sidebar-pin">
            <NavItem item={{ to: '/home', label: 'Home', icon: Home, end: true }} onNavigate={onNavigate} />
          </div>
        ) : null}

        <div className="sidebar-sections">
          {floorOnly ? (
            <div className="sidebar-pin">
              <NavItem
                item={{ to: '/production/today', label: 'My Today', icon: UserCheck }}
                onNavigate={onNavigate}
              />
              <NavItem
                item={{ to: '/leave-requests', label: 'Leave Request', icon: CalendarOff }}
                onNavigate={onNavigate}
              />
            </div>
          ) : (
            <>
              {sections.map((section) => (
                <CollapsibleSection
                  key={section.id}
                  id={section.id}
                  label={section.label}
                  items={section.items}
                  open={!!openSections[section.id]}
                  onToggle={toggleSection}
                  onNavigate={onNavigate}
                />
              ))}

              {masterItems.length || isAdmin() ? (
                <CollapsibleSection
                  id="masters"
                  label="Masters"
                  items={masterItems}
                  open={!!openSections.masters}
                  onToggle={toggleSection}
                  onNavigate={onNavigate}
                  headerAction={
                    isAdmin() ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="sidebar-section-plus"
                        aria-label="Add master"
                        title="Add master"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate('/masters/config/new');
                          onNavigate?.();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate('/masters/config/new');
                            onNavigate?.();
                          }
                        }}
                      >
                        <Plus size={14} />
                      </span>
                    ) : null
                  }
                />
              ) : null}
            </>
          )}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar" aria-hidden>
          {initials}
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
