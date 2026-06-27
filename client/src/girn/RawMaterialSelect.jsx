import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

const RAW_MATERIAL_SLUG = 'raw-material';

function cellValue(flat, sectionSlug, fieldSlug) {
  return flat?.[sectionSlug]?.[fieldSlug]?.value ?? null;
}

function findFieldValue(flat, sections, matchers) {
  for (const section of sections || []) {
    for (const field of section.fields || []) {
      const slug = field.slug.toLowerCase();
      const label = field.label.toLowerCase();
      const matched = matchers.some(
        (m) => slug === m || slug.includes(m) || label.includes(m)
      );
      if (matched) {
        const val = cellValue(flat, section.slug, field.slug);
        if (val != null && String(val).trim() !== '') return String(val).trim();
      }
    }
  }
  return null;
}

export function mapRawMaterialRecord(flat, sections, lookupLabel = '') {
  const rmId =
    findFieldValue(flat, sections, ['rm-id', 'rm_id', 'rm id']) ||
    lookupLabel ||
    '';

  return {
    rm_id: rmId,
    rm_code:
      findFieldValue(flat, sections, ['rm-code', 'rm_code', 'material-code', 'code']) ||
      '',
    grade: findFieldValue(flat, sections, ['grade']) || '',
    unit: findFieldValue(flat, sections, ['unit', 'uom']) || '',
    inventory_number:
      findFieldValue(flat, sections, ['inventory-number', 'inventory_number', 'inventory-no', 'inventory']) ||
      '',
  };
}

export async function fetchRawMaterialDetails(recordId) {
  const [schemaRes, recordRes] = await Promise.all([
    api.get(`/masters/${RAW_MATERIAL_SLUG}/schema`),
    api.get(`/masters/${RAW_MATERIAL_SLUG}/records/${recordId}`),
  ]);

  const sections = schemaRes.data?.sections || [];
  const flat = recordRes.data?.flat || {};

  return {
    sections,
    flat,
    mapped: mapRawMaterialRecord(flat, sections),
  };
}

export default function RawMaterialSelect({
  value,
  label = '',
  onChange,
  disabled = false,
}) {
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
        .get(`/masters/${RAW_MATERIAL_SLUG}/lookup`, {
          params: { search: search.trim() },
        })
        .then(({ data }) => setOptions(data || []))
        .catch((err) => {
          console.error('Failed to load raw materials:', err);
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

  async function handleSelect(option) {
    try {
      setLoading(true);
      const { mapped } = await fetchRawMaterialDetails(option.record_id);
      onChange({
        raw_material_id: option.record_id,
        raw_material_label: option.label,
        ...mapped,
      });
      setOpen(false);
      setSearch('');
    } catch (err) {
      console.error('Failed to load raw material record:', err);
      alert(err.response?.data?.error || 'Unable to load raw material details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
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
          {displayLabel || (value ? 'Linked raw material' : 'Search raw material by RM ID...')}
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
              placeholder="Search RM ID, code, or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p className="muted" style={{ padding: '12px 16px', margin: 0 }}>
                Searching...
              </p>
            ) : options.length === 0 ? (
              <div style={{ padding: '8px 12px' }}>
                <p className="muted" style={{ margin: '0 0 8px' }}>
                  No raw materials found.
                </p>
                {search.trim() ? (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ width: '100%' }}
                    onClick={() => {
                      onChange({
                        raw_material_id: null,
                        raw_material_label: `New: ${search.trim()}`,
                        rm_id: search.trim(),
                        rm_code: '',
                      });
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    Use RM ID &quot;{search.trim()}&quot; as new material
                  </button>
                ) : null}
              </div>
            ) : (
              options.map((option) => (
                <button
                  key={option.record_id}
                  type="button"
                  onClick={() => handleSelect(option)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    border: 'none',
                    background:
                      String(value) === String(option.record_id) ? '#eff6ff' : 'transparent',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 14, color: 'black' }}>{option.label}</strong>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Raw material master record</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
