import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

export default function EmployeeSelect({ value, onChange, disabled = false }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    api
      .get('/employees')
      .then(({ data }) => {
        if (!mounted) return;
        setEmployees(data.employees || []);
      })
      .catch((err) => console.error('Failed to load employees:', err))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = employees.find((e) => String(e.id) === String(value));

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((e) =>
      [e.full_name, e.employee_code, e.department, e.job_description]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [employees, search]);

  const displayLabel = selected
    ? `${selected.full_name}${selected.employee_code ? ` (${selected.employee_code})` : ''}`
    : '';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled || loading}
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
        <span style={{ color: displayLabel ? '#111827' : '#9ca3af' }}>
          {loading ? 'Loading employees...' : displayLabel || 'Select employee...'}
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
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 50,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="search"
              className="search-input"
              placeholder="Search by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <p className="muted" style={{ padding: '12px 16px', margin: 0 }}>
                No employees found.
              </p>
            ) : (
              filtered.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => {
                    onChange(employee.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    border: 'none',
                    background: String(value) === String(employee.id) ? '#eff6ff' : 'transparent',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 14 }}>{employee.full_name}</strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {[employee.full_name, employee.department].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
