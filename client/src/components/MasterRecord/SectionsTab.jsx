import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { newKey } from '../MasterBuilder/utils';

function RelationSelect({ masterId, value, onChange, disabled }) {
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!masterId) {
      setRecords([]);
      setLoadError('');
      return undefined;
    }

    let mounted = true;

    async function loadRecords() {
      try {
        setLoading(true);
        setLoadError('');
        const { data } = await api.get(`/masters/${masterId}/records`);
        if (mounted) setRecords(data.records || []);
      } catch (err) {
        console.error('Failed to load related records:', err);
        if (mounted) {
          setRecords([]);
          setLoadError(err.response?.data?.error || 'Unable to load related records.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadRecords();
    return () => {
      mounted = false;
    };
  }, [masterId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [record.name, record.code].join(' ').toLowerCase().includes(query)
    );
  }, [records, search]);

  const selected = records.find((record) => record.id === value);

  return (
    <div className="relation-select">
      <input
        type="search"
        placeholder="Search records…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        disabled={disabled || loading || !masterId}
      />
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={disabled || loading || !masterId}
      >
        <option value="">{loading ? 'Loading records…' : 'Select record'}</option>
        {filtered.map((record) => (
          <option key={record.id} value={record.id}>
            {record.name}
            {record.code ? ` (${record.code})` : ''}
          </option>
        ))}
      </select>
      {loadError ? <p className="field-error">{loadError}</p> : null}
      {selected ? <p className="muted relation-selected">Selected: {selected.name}</p> : null}
    </div>
  );
}

function SectionCell({
  field,
  value,
  onChange,
  saving,
  onImageUpload,
  uploadError,
  uploading,
}) {
  if (field.type === 'text') {
    return (
      <input
        type="text"
        value={value?.value ?? ''}
        onChange={(event) => onChange({ value: event.target.value })}
        disabled={saving}
      />
    );
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={value?.value ?? ''}
        onChange={(event) => onChange({ value: event.target.value })}
        disabled={saving}
      />
    );
  }

  if (field.type === 'date') {
    return (
      <input
        type="date"
        value={value?.value ?? ''}
        onChange={(event) => onChange({ value: event.target.value })}
        disabled={saving}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <select
        value={value?.value ?? ''}
        onChange={(event) => onChange({ value: event.target.value })}
        disabled={saving}
      >
        <option value="">Select option</option>
        {(field.options || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'image') {
    return (
      <div className="record-field-image">
        {value?.image_url ? (
          <img src={value.image_url} alt={field.label || 'Section image'} className="category-thumb" />
        ) : null}
        <label className="file-input-label">
          {uploading ? 'Uploading…' : 'Upload image'}
          <input
            type="file"
            accept="image/*"
            disabled={saving || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              onImageUpload(file);
              event.target.value = '';
            }}
          />
        </label>
        {uploadError ? <p className="field-error">{uploadError}</p> : null}
      </div>
    );
  }

  if (field.type === 'relation') {
    return (
      <RelationSelect
        masterId={field.related_master_id}
        value={value?.related_record_id}
        onChange={(relatedRecordId) => onChange({ related_record_id: relatedRecordId })}
        disabled={saving}
      />
    );
  }

  return null;
}

function emptyRowValues(fields) {
  const values = {};
  fields.forEach((field) => {
    values[field.id] = { value: '', image_url: '', related_record_id: null };
  });
  return values;
}

export default function SectionsTab({
  masterSections,
  sectionRows,
  setSectionRows,
  saving,
  onImageUpload,
  uploadErrors = {},
  uploadingCells = {},
}) {
  const sortedSections = useMemo(
    () =>
      [...(masterSections || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [masterSections]
  );

  function addRow(section) {
    const sectionId = section.id;
    const fields = [...(section.master_section_fields || [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );

    setSectionRows((current) => {
      const rows = current[sectionId] || [];
      return {
        ...current,
        [sectionId]: [
          ...rows,
          {
            _key: newKey(),
            sort_order: rows.length,
            values: emptyRowValues(fields),
          },
        ],
      };
    });
  }

  function removeRow(sectionId, rowKey) {
    setSectionRows((current) => {
      const rows = (current[sectionId] || [])
        .filter((row) => row._key !== rowKey)
        .map((row, index) => ({ ...row, sort_order: index }));
      return { ...current, [sectionId]: rows };
    });
  }

  function updateCell(sectionId, rowKey, fieldId, patch) {
    setSectionRows((current) => ({
      ...current,
      [sectionId]: (current[sectionId] || []).map((row) => {
        if (row._key !== rowKey) return row;
        return {
          ...row,
          values: {
            ...row.values,
            [fieldId]: { ...row.values[fieldId], ...patch },
          },
        };
      }),
    }));
  }

  if (sortedSections.length === 0) {
    return (
      <p className="muted">
        No sections defined for this master. Add sections in the master configuration.
      </p>
    );
  }

  return (
    <div className="component-tab record-sections-tab">
      {sortedSections.map((section) => {
        const fields = [...(section.master_section_fields || [])].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );
        const rows = sectionRows[section.id] || [];

        return (
          <section key={section.id} className="record-section-block">
            <header className="record-section-header">
              <h3>{section.name}</h3>
            </header>

            {section.description ? <p className="muted">{section.description}</p> : null}

            {fields.length === 0 ? (
              <p className="muted">This section has no fields configured.</p>
            ) : (
              <div className="record-section-table-wrap">
                <table className="record-section-table border-separate border-spacing-x-4 border-spacing-y-4">
                  <thead>
                    <tr>
                      {fields.map((field) => (
                        <th className='font-bold text-lg' key={field.id}>{field.label || field.field_key}</th>
                      ))}
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        {/* <td colSpan={fields.length + 1} className="muted">
                          No rows yet. Use &quot;+ Add row&quot; to add one.
                        </td> */}
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row._key}>
                          {fields.map((field) => {
                            const cellKey = `${section.id}-${row._key}-${field.id}`;
                            return (
                              <td key={field.id}>
                                <SectionCell
                                  field={field}
                                  value={row.values[field.id]}
                                  onChange={(patch) =>
                                    updateCell(section.id, row._key, field.id, patch)
                                  }
                                  saving={saving}
                                  onImageUpload={(file) => onImageUpload(cellKey, file, (url, fileName) =>
                                    updateCell(section.id, row._key, field.id, {
                                      image_url: url,
                                      value: fileName || url,
                                    })
                                  )}
                                  uploadError={uploadErrors[cellKey]}
                                  uploading={uploadingCells[cellKey]}
                                />
                              </td>
                            );
                          })}
                          <td>
                            <button
                              type="button"
                              className="master-field-remove"
                              onClick={() => removeRow(section.id, row._key)}
                              aria-label="Remove row"
                              disabled={saving}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => addRow(section)}
                      disabled={saving || fields.length === 0}
                      >
                      + Add row
                    </button>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
