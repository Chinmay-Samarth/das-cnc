import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { evaluateRules } from '../MasterBuilder/utils';

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

export default function FieldsTab({
  fields,
  values,
  setValues,
  rules,
  overrides,
  saving,
  onImageUpload,
  uploadErrors = {},
  uploadingFields = {},
}) {
  const flatValues = useMemo(() => {
    const map = {};
    Object.entries(values).forEach(([fieldId, entry]) => {
      map[fieldId] = entry?.value ?? '';
    });
    return map;
  }, [values]);

  const triggeredRules = useMemo(
    () => evaluateRules(fields, flatValues, rules, overrides),
    [fields, flatValues, rules, overrides]
  );

  const alertRules = triggeredRules.filter((rule) => rule.action_type === 'alert');
  const highlightFieldIds = new Set(
    triggeredRules
      .filter((rule) => rule.action_type === 'highlight')
      .map((rule) => rule.condition_field_id)
  );
  const blockRules = triggeredRules.filter((rule) => rule.action_type === 'block');

  function updateValue(fieldId, patch) {
    setValues((current) => ({
      ...current,
      [fieldId]: { ...current[fieldId], ...patch },
    }));
  }

  const sortedFields = [...fields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return (
    <div className="component-tab record-fields-tab">
      {alertRules.length > 0 ? (
        <div className="rule-banner rule-banner-alert" role="alert">
          {alertRules.map((rule) => (
            <p key={rule.id}>{rule.action_message || rule.name}</p>
          ))}
        </div>
      ) : null}

      {blockRules.length > 0 ? (
        <div className="rule-banner rule-banner-block" role="alert">
          {blockRules.map((rule) => (
            <p key={rule.id}>{rule.action_message || rule.name}</p>
          ))}
        </div>
      ) : null}

      {sortedFields.length === 0 ? <p className="muted">No fields configured for this master.</p> : null}

      <div className="record-fields-form">
        {sortedFields.map((field) => {
          const entry = values[field.id] || {};
          const highlighted = highlightFieldIds.has(field.id);
          const uploading = Boolean(uploadingFields[field.id]);

          return (
            <label
              key={field.id}
              className={`record-field-label${highlighted ? ' is-highlighted' : ''}`}
            >
              <div className="record-field-label-required">

              {field.label || field.field_key}
              {field.required ? <span className="required-mark"> *</span> : null}
              </div>

              {field.type === 'text' ? (
                <input
                  type="text"
                  value={entry.value ?? ''}
                  onChange={(event) => updateValue(field.id, { value: event.target.value })}
                  disabled={saving}
                />
              ) : null}

              {field.type === 'number' ? (
                <input
                  type="number"
                  value={entry.value ?? ''}
                  onChange={(event) => updateValue(field.id, { value: event.target.value })}
                  disabled={saving}
                />
              ) : null}

              {field.type === 'date' ? (
                <input
                  type="date"
                  value={entry.value ?? ''}
                  onChange={(event) => updateValue(field.id, { value: event.target.value })}
                  disabled={saving}
                />
              ) : null}

              {field.type === 'select' ? (
                <select
                  value={entry.value ?? ''}
                  onChange={(event) => updateValue(field.id, { value: event.target.value })}
                  disabled={saving}
                >
                  <option value="">Select option</option>
                  {(field.options || []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : null}

              {field.type === 'image' ? (
                <div className="record-field-image">
                  {entry.image_url ? (
                    <img src={entry.image_url} alt={field.label || 'Field image'} className="category-thumb" />
                  ) : null}
                  <label className="file-input-label">
                    {uploading ? 'Uploading…' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={saving || uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        onImageUpload(field.id, file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {uploadErrors[field.id] ? (
                    <p className="field-error">{uploadErrors[field.id]}</p>
                  ) : null}
                </div>
              ) : null}

              {field.type === 'relation' ? (
                <RelationSelect
                  masterId={field.related_master_id}
                  value={entry.related_record_id}
                  onChange={(relatedRecordId) =>
                    updateValue(field.id, { related_record_id: relatedRecordId })
                  }
                  disabled={saving}
                />
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function hasBlockingRules(fields, values, rules, overrides) {
  const flatValues = {};
  Object.entries(values).forEach(([fieldId, entry]) => {
    flatValues[fieldId] = entry?.value ?? '';
  });
  return evaluateRules(fields, flatValues, rules, overrides).some(
    (rule) => rule.action_type === 'block'
  );
}
