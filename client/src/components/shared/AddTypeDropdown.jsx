import { useEffect, useRef, useState } from 'react';

export default function AddTypeDropdown({ buttonLabel, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handleClick(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="master-field-add-dropdown" ref={containerRef}>
      <button
        type="button"
        className="secondary-button master-field-add-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {buttonLabel}
        <span className="master-field-add-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="master-field-add-menu" role="menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              className="master-field-add-option"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
