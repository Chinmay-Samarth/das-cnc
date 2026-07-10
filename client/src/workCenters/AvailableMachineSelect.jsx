import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

/**
 * Picker for unassigned machine master records.
 * Uses GET /work-centers/available-machines
 */
export default function AvailableMachineSelect({ value, label = '', onChange, disabled = false }) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get('/work-centers/available-machines', {
          params: { search: search.trim() },
        })
        .then(({ data }) => {setOptions(data.machines || [])
          console.log (data.machines)
        })
        .catch((err) => {
          console.error('Failed to load available machines:', err);
          setOptions([]);
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, open]);

  const displayLabel = useMemo(() => {
    if (label) return label;
    const match = options.find((o) => String(o.record_id) === String(value));
    return match?.label || '';
  }, [label, options, value]);

  function handleSelect(option) {
    onChange({
      machine_record_id: option.record_id,
      label: option.label,
    });
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 200 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '8px 12px',
          border: '1px solid #d1d5db',
          borderRadius: 6,
          background: disabled ? '#f3f4f6' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 14,
        }}
      >
        <span style={{ color: displayLabel || value ? '#111827' : '#9ca3af' }}>
          {displayLabel || (value ? 'Selected machine' : 'Search available machines...')}
        </span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && !disabled ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 40,
            maxHeight: 260,
            overflow: 'auto',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search..."
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 14,
              }}
            />
          </div>
          {loading ? (
            <p className="muted" style={{ padding: 12, margin: 0 }}>
              Loading...
            </p>
          ) : options.length === 0 ? (
            <p className="muted" style={{ padding: 12, margin: 0 }}>
              No unassigned machines found.
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.record_id}
                type="button"
                onClick={() => handleSelect(option)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  background:
                    String(option.record_id) === String(value) ? '#335ccf' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: String(option.record_id)===String(value)?'white':'#1d4ed8',
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
