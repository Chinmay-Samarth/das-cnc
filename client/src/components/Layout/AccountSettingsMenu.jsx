import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Settings } from 'lucide-react';

/**
 * Compact account control next to the notification bell.
 */
export default function AccountSettingsMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div className="account-settings-menu" ref={rootRef}>
      <button
        type="button"
        className="notif-bell-btn account-settings-btn"
        aria-label="Account settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={18} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="account-settings-popover" role="menu">
          <button
            type="button"
            className="account-settings-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/account/settings');
            }}
          >
            <KeyRound size={15} />
            Change password
          </button>
        </div>
      ) : null}
    </div>
  );
}
