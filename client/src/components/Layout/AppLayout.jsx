import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  function closeMobileNav() {
    setMobileOpen(false);
  }

  return (
    <div className="app-layout">
      <header className="mobile-top-bar">
        <button
          type="button"
          className="menu-btn burger-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <span />
          <span />
          <span />
        </button>
        <strong className="mobile-brand">
          <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo mobile-logo" />
        </strong>
      </header>

      {mobileOpen ? (
        <button type="button" className="sidebar-overlay" onClick={closeMobileNav} aria-label="Close menu" />
      ) : null}

      <aside className={`app-sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="sidebar-mobile-header">
          <strong>
            <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo drawer-logo" />
          </strong>
          <button type="button" className="secondary-btn" onClick={closeMobileNav}>
            Close
          </button>
        </div>
        <Sidebar onNavigate={closeMobileNav}  />
      </aside>

      <div className="app-main">
        <Outlet />
      </div>
    </div>
  );
}
