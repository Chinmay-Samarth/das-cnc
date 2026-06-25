import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import { useMastersNav } from '../../context/MastersNavContext';
import { useEffect, useState } from 'react';
import api from "../../api/client"

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/employees', label: 'Employees' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/customers', label: 'Customers'},
  { to: '/invoices', label: 'Invoices' },

];

export default function Sidebar({ onNavigate }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const [masters, setMasters] = useState([])

  useEffect(()=>{
    api.get('/masters/sidebar').then(res => {
      console.log(res.data)
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
        <span className="sidebar-user">{user?.name}</span>
        <button type="button" className="secondary-btn sidebar-logout" onClick={logout}>
          Logout
        </button>
      </div>
    </>
  );
}
