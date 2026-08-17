import { useEffect, useRef, useState } from 'react';
import { SIZE_OPTIONS } from './widgetOrder';

function SizeGlyph({ size, active = false }) {
  const stroke = active ? '#111827' : '#111827';
  if (size === 'quarter') {
    return (
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <rect x="4" y="4" width="20" height="20" rx="6" fill="none" stroke={stroke} strokeWidth="1.7" />
        <rect x="16.5" y="7" width="4.5" height="4.5" rx="1.2" fill={stroke} />
      </svg>
    );
  }
  if (size === 'half') {
    return (
      <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden>
        <rect x="2" y="5" width="36" height="18" rx="6" fill="none" stroke={stroke} strokeWidth="1.7" />
        <rect x="30" y="8" width="4.5" height="4.5" rx="1.2" fill={stroke} />
        <rect x="8" y="17.5" width="18" height="1.6" rx="0.8" fill={stroke} opacity="0.35" />
      </svg>
    );
  }
  return (
    <svg width="32" height="36" viewBox="0 0 32 36" aria-hidden>
      <rect x="3" y="3" width="26" height="30" rx="7" fill="none" stroke={stroke} strokeWidth="1.7" />
      <rect x="20.5" y="6.5" width="4.5" height="4.5" rx="1.2" fill={stroke} />
      <rect x="8" y="16" width="16" height="1.6" rx="0.8" fill={stroke} opacity="0.35" />
      <rect x="8" y="21" width="13" height="1.6" rx="0.8" fill={stroke} opacity="0.28" />
      <rect x="8" y="26" width="10" height="1.6" rx="0.8" fill={stroke} opacity="0.2" />
    </svg>
  );
}

export default function WidgetSizePicker({ id, size, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onForeignOpen(event) {
      if (event.detail !== id) setOpen(false);
    }
    window.addEventListener('dash-size-picker', onForeignOpen);
    return () => window.removeEventListener('dash-size-picker', onForeignOpen);
  }, [id]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(event) {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('dash-size-picker', { detail: id }));
    setOpen((v) => !v);
  }

  return (
    <div className="mes-ios-size" ref={rootRef}>
      <button
        type="button"
        className={`mes-ios-size-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change widget size"
        title="Change widget size"
        onClick={toggle}
      >
        <SizeGlyph size={size} />
      </button>
      {open ? (
        <div className="mes-ios-size-menu" role="listbox" aria-label="Widget size">
          {SIZE_OPTIONS.map((opt) => {
            const active = size === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`mes-ios-size-option${active ? ' is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange?.(opt.id);
                  setOpen(false);
                }}
              >
                <span className="mes-ios-size-glyph">
                  <SizeGlyph size={opt.id} active={active} />
                </span>
                <span className="mes-ios-size-copy">
                  <strong>{opt.label}</strong>
                  <em>{opt.hint}</em>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
