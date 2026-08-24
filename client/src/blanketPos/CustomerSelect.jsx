import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

/** Searchable customer picker for blanket PO setup */
export default function CustomerSelect({
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder = 'Search customer…',
}) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get('/customers/lookup', { params: { search: search.trim() } })
        .then(({ data }) => setOptions(Array.isArray(data) ? data : data?.results || []))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [open, search]);

  return (
    <div ref={wrapRef} className="bpo-picker">
      <button
        type="button"
        className={`bpo-picker-trigger${value ? ' has-value' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="bpo-picker-label">{label || (value ? 'Selected customer' : placeholder)}</span>
        <span className="bpo-picker-hint">{open ? 'Close' : 'Search'}</span>
      </button>
      {open && !disabled ? (
        <div className="bpo-picker-menu">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type customer name or GSTIN…"
          />
          {loading ? (
            <p className="muted bpo-picker-empty">Loading…</p>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={value === o.id ? 'is-selected' : undefined}
                onClick={() => {
                  onChange({ id: o.id, label: o.label });
                  setOpen(false);
                  setSearch('');
                }}
              >
                {o.label}
              </button>
            ))
          )}
          {!loading && !options.length ? (
            <p className="muted bpo-picker-empty">No customers found.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
