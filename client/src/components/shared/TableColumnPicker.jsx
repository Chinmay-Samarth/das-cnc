import { useEffect, useRef, useState } from 'react';
import { Check, Columns3 } from 'lucide-react';

/**
 * Dropdown checklist for choosing which table columns are visible.
 * Reuses the master-table (.mp-column-*) styles.
 */
export default function TableColumnPicker({
  columnGroups,
  visibleColumns,
  onToggle,
  onReset,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const totalColumns = columnGroups.reduce((sum, group) => sum + group.columns.length, 0);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (totalColumns <= 1) return null;

  return (
    <div className="mp-column-picker" ref={ref}>
      <button
        type="button"
        className="mes-btn mes-btn-secondary"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Columns3 size={16} />
        Columns
      </button>
      {open ? (
        <div className="mes-card mp-column-panel" role="dialog" aria-label="Choose table columns">
          <div className="mp-column-head">
            <div>
              <p className="mp-column-title">Columns</p>
              <p className="muted mp-column-hint">{visibleColumns.length} shown</p>
            </div>
            <button type="button" className="mp-column-reset" onClick={onReset}>
              Reset
            </button>
          </div>
          <div className="mp-column-groups">
            {columnGroups.map((group) => (
              <section key={group.name}>
                {columnGroups.length > 1 ? (
                  <p className="mp-column-section">{group.name}</p>
                ) : null}
                <div className="mp-column-list">
                  {group.columns.map((column) => {
                    const checked = visibleColumns.some((item) => item.id === column.id);
                    const onlyOne = checked && visibleColumns.length === 1;
                    return (
                      <label
                        key={column.id}
                        className={`mp-column-option${checked ? ' is-on' : ''}${onlyOne ? ' is-locked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="mp-column-input"
                          checked={checked}
                          disabled={onlyOne}
                          onChange={() => onToggle(column.id)}
                        />
                        <span className="mp-column-box" aria-hidden="true">
                          {checked ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <span className="mp-column-name">{column.label}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
