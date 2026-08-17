import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SIZE_OPTIONS } from './widgetOrder';

function SizeGlyph({ size }) {
  const stroke = '#111827';
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

export default function WidgetSizePicker({
  size,
  allowedSizes,
  open,
  x = 0,
  y = 0,
  onChange,
  onClose,
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (!rootRef.current?.contains(event.target)) onClose?.();
    }
    function onKey(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const el = rootRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, y - rect.height);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, x, y]);

  if (!open || typeof document === 'undefined') return null;

  const options = SIZE_OPTIONS.filter((opt) => allowedSizes.includes(opt.id));

  return createPortal(
    <div
      className="mes-ios-size-menu is-context"
      role="listbox"
      aria-label="Widget size"
      ref={rootRef}
      style={{ left: `${x}px`, top: `${y}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {options.map((opt) => {
        const active = size === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="option"
            aria-selected={active}
            className={`mes-ios-size-option${active ? ' is-active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange?.(opt.id);
              onClose?.();
            }}
          >
            <span className="mes-ios-size-glyph">
              <SizeGlyph size={opt.id} />
            </span>
            <span className="mes-ios-size-copy">
              <strong>{opt.label}</strong>
              <em>{opt.hint}</em>
            </span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
