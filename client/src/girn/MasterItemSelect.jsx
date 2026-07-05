import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';
import { getCategoryConfig } from './girnCategoryConfig';

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

export function mapMasterRecord(flat, sections, category, lookupLabel = '') {
  const cfg = getCategoryConfig(category);
  const keyMatchers = cfg.keyFieldMatchers || ['code', 'id'];
  const codeMatchers = cfg.codeFieldMatchers || ['code'];

  const itemCode =
    findFieldValue(flat, sections, keyMatchers) ||
    lookupLabel ||
    '';

  return {
    item_code: itemCode,
    rm_id: itemCode,
    rm_code:
      findFieldValue(flat, sections, codeMatchers) ||
      '',
    grade: findFieldValue(flat, sections, ['grade']) || '',
    unit: findFieldValue(flat, sections, ['unit', 'uom']) || '',
    inventory_number:
      findFieldValue(flat, sections, ['inventory-number', 'inventory_number', 'inventory-no', 'inventory']) ||
      '',
    item_description:
      findFieldValue(flat, sections, ['description', 'name']) || '',
  };
}

export async function fetchMasterRecordDetails(masterSlug, recordId, category) {
  const [schemaRes, recordRes] = await Promise.all([
    api.get(`/masters/${masterSlug}/schema`),
    api.get(`/masters/${masterSlug}/records/${recordId}`),
  ]);

  const sections = schemaRes.data?.sections || [];
  const flat = recordRes.data?.flat || {};

  return {
    sections,
    flat,
    mapped: mapMasterRecord(flat, sections, category),
  };
}

export default function MasterItemSelect({
  masterSlug,
  category = 'raw_material',
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder,
}) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const cfg = getCategoryConfig(category);

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
    if (!open || !masterSlug) return undefined;

    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get(`/masters/${masterSlug}/lookup`, {
          params: { search: search.trim() },
        })
        .then(({ data }) => setOptions(data || []))
        .catch((err) => {
          console.error(`Failed to load ${masterSlug} records:`, err);
          setOptions([]);
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, open, masterSlug]);

  const displayLabel = useMemo(() => {
    if (label) return label;
    const match = options.find((o) => String(o.record_id) === String(value));
    return match?.label || '';
  }, [label, options, value]);

  async function handleSelect(option) {
    try {
      setLoading(true);
      const { mapped } = await fetchMasterRecordDetails(masterSlug, option.record_id, category);
      onChange({
        master_record_id: option.record_id,
        master_record_label: option.label,
        raw_material_id: category === 'raw_material' ? option.record_id : null,
        raw_material_label: category === 'raw_material' ? option.label : '',
        ...mapped,
      });
      setOpen(false);
      setSearch('');
    } catch (err) {
      console.error('Failed to load master record:', err);
      alert(err.response?.data?.error || 'Unable to load item details.');
    } finally {
      setLoading(false);
    }
  }

  const defaultPlaceholder = placeholder || `Search ${cfg.label.toLowerCase()}...`;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled || !masterSlug}
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
          {displayLabel || (value ? `Linked ${cfg.label.toLowerCase()}` : defaultPlaceholder)}
        </span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && !disabled && masterSlug ? (
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
              placeholder={`Search ${cfg.label.toLowerCase()}...`}
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
              <p className="muted" style={{ padding: '12px 16px', margin: 0 }}>
                No matching master records found. Create the item in the master first, then link it here.
              </p>
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
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{cfg.label} master record</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
