import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/authContext';
import Sidebar from './Sidebar';
import GlobalSearch from './GlobalSearch';
import GlobalBackButton from './GlobalBackButton';
import NotificationBell from './NotificationBell';
import AccountSettingsMenu from './AccountSettingsMenu';
import InvoiceUploadQueueStatus from '../../invoices/InvoiceUploadQueueStatus';

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isFloorOnly, defaultHomePath } = useAuth();
  const floorOnly = isFloorOnly();

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
        <Link to={defaultHomePath()} className="mobile-brand" aria-label="Go to home">
          <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo mobile-logo" />
        </Link>
        <div className="mobile-top-actions">
          <AccountSettingsMenu />
          {floorOnly ? null : <NotificationBell />}
        </div>
      </header>

      {mobileOpen ? (
        <button type="button" className="sidebar-overlay" onClick={closeMobileNav} aria-label="Close menu" />
      ) : null}

      <aside className={`app-sidebar${mobileOpen ? ' open' : ''}`}>
        <div className="sidebar-mobile-header">
          <Link to={defaultHomePath()} onClick={closeMobileNav} aria-label="Go to home">
            <img src="/dascnclogo1.png" alt="DAS CNC" className="brand-logo drawer-logo" />
          </Link>
          <button type="button" className="secondary-btn" onClick={closeMobileNav}>
            Close
          </button>
        </div>
        <Sidebar onNavigate={closeMobileNav} />
      </aside>

      <div className="app-main">
        <div className="app-top-chrome">
          <GlobalBackButton />
          {floorOnly ? (
            <AccountSettingsMenu />
          ) : (
            <>
              <GlobalSearch />
              <AccountSettingsMenu />
              <NotificationBell />
            </>
          )}
        </div>
        <Outlet />
      </div>

      <InvoiceUploadQueueStatus />
    </div>
  );
}
