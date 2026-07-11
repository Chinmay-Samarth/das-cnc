import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import { useMastersNav } from '../../context/MastersNavContext';
import { useEffect, useState } from 'react';
import api from "../../api/client"
import {LogOut} from 'lucide-react'

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/employees', label: 'Employees' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/customers', label: 'Customers'},
  { to: '/blanket-pos', label: 'Blanket POs' },
  { to: '/delivery-schedules', label: 'Delivery Schedules' },
  { to: '/production/today', label: 'My Today' },
  { to: '/production', label: 'Production' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/girn', label: 'GIRN' },
  { to: '/stock', label: 'Stock' },
  { to: '/work-centers', label: 'Work Centers' },
];

export default function Sidebar({ onNavigate }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const [masters, setMasters] = useState([])

  useEffect(()=>{
    api.get('/masters/sidebar').then(res => {
      setMasters(res.data)
    })
  },[])

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
        {masters.map((m)=>(
          <NavLink
          key={m.slug}
          to={`/masters/${m.slug}`}
          className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
          onClick={(onNavigate)}
          >
            {m.name.replace(/\s*Master$/i, "")}
          </NavLink>
        ))}
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
        <button type="button" className="logout-btn" onClick={logout}>
          {/* <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg> */}
            <LogOut size={15} />
        </button>
      </div>
    </>
  );
}
