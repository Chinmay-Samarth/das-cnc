import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { newKey } from '../MasterBuilder/utils';
import CategoriesTab from './CategoriesTab';
import FieldsTab, { hasBlockingRules } from './FieldsTab';
import RuleOverridesTab from './RuleOverridesTab';
import SectionsTab from './SectionsTab';

const TABS = [
  { id: 'fields', label: 'Fields' },
  { id: 'sections', label: 'Sections' },
  { id: 'categories', label: 'Extra Fields' },
  { id: 'overrides', label: 'Rule Overrides' },
];

function stripKeys(items, fields) {
  return items.map((item) => {
    const payload = {};
    fields.forEach((field) => {
      payload[field] = item[field] ?? null;
    });
    return payload;
  });
}

function valuesFromRecord(recordValues) {
  const map = {};
  (recordValues || []).forEach((item) => {
    map[item.field_id] = {
      value: item.value ?? '',
      image_url: item.image_url || '',
      related_record_id: item.related_record_id || null,
    };
  });
  return map;
}

function overridesFromRecord(recordOverrides) {
  const map = {};
  (recordOverrides || []).forEach((item) => {
    map[item.rule_id] = item.threshold_value ?? '';
  });
  return map;
}

function sectionRowsFromRecord(recordSectionRows) {
  const map = {};
  (recordSectionRows || []).forEach((row) => {
    const sectionId = row.section_id;
    if (!map[sectionId]) map[sectionId] = [];

    const values = {};
    (row.record_section_values || []).forEach((item) => {
      values[item.section_field_id] = {
        value: item.value ?? '',
        image_url: item.image_url || '',
        related_record_id: item.related_record_id || null,
      };
    });

    map[sectionId].push({
      _key: newKey(),
      sort_order: row.sort_order ?? map[sectionId].length,
      values,
    });
  });

  Object.keys(map).forEach((sectionId) => {
    map[sectionId].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  });

  return map;
}

function sectionsToPayload(sectionRows) {
  return Object.entries(sectionRows).flatMap(([sectionId, rows]) =>
    rows.map(({ _key, sort_order, values }) => ({
      section_id: sectionId,
      sort_order,
      values: Object.entries(values).map(([sectionFieldId, value]) => ({
        section_field_id: sectionFieldId,
        value: value.value ?? null,
        image_url: value.image_url || null,
        related_record_id: value.related_record_id || null,
      })),
    }))
  );
}

export default function RecordDrawer({ masterId, master, recordId, onClose, onSaved }) {
  const isNew = !recordId;
  const fields = useMemo(
    () => [...(master.master_fields || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [master.master_fields]
  );
  const rules = master.master_rules || [];
  const masterSections = master.master_sections || [];

  const [activeTab, setActiveTab] = useState('fields');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [values, setValues] = useState({});
  const [categories, setCategories] = useState([]);
  const [sectionRows, setSectionRows] = useState({});
  const [overrides, setOverrides] = useState({});

  const [categoryUploadErrors, setCategoryUploadErrors] = useState({});
  const [uploadingCategories, setUploadingCategories] = useState({});
  const [fieldUploadErrors, setFieldUploadErrors] = useState({});
  const [uploadingFields, setUploadingFields] = useState({});
  const [sectionUploadErrors, setSectionUploadErrors] = useState({});
  const [uploadingSections, setUploadingSections] = useState({});

  useEffect(() => {
    if (!recordId) {
      setName('');
      setCode('');
      setValues({});
      setCategories([]);
      setSectionRows({});
      setOverrides({});
      setCategoryUploadErrors({});
      setUploadingCategories({});
      setFieldUploadErrors({});
      setUploadingFields({});
      setSectionUploadErrors({});
      setUploadingSections({});
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    async function loadRecord() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get(`/masters/${masterId}/records/${recordId}`);
        if (!mounted) return;

        const record = data.record;
        setName(record.name || '');
        setCode(record.code || '');
        setValues(valuesFromRecord(record.record_values));
        setCategories((record.record_categories || []).map((item) => ({ ...item, _key: newKey() })));
        setSectionRows(sectionRowsFromRecord(record.record_section_rows));
        setOverrides(overridesFromRecord(record.record_rule_overrides));
      } catch (err) {
        console.error('Failed to load record:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load record.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadRecord();
    return () => {
      mounted = false;
    };
  }, [masterId, recordId]);

  const blocked = useMemo(
    () => hasBlockingRules(fields, values, rules, overrides),
    [fields, values, rules, overrides]
  );

  async function handleCategoryImageUpload(itemKey, file) {
    if (!file) return;

    try {
      setUploadingCategories((current) => ({ ...current, [itemKey]: true }));
      setCategoryUploadErrors((current) => ({ ...current, [itemKey]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/masters/upload/category-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCategories((current) =>
        current.map((item) => (item._key === itemKey ? { ...item, image_url: data.url } : item))
      );
    } catch (err) {
      console.error('Category image upload failed:', err);
      setCategoryUploadErrors((current) => ({
        ...current,
        [itemKey]: err.response?.data?.error || 'Unable to upload image.',
      }));
    } finally {
      setUploadingCategories((current) => ({ ...current, [itemKey]: false }));
    }
  }

  async function handleSectionImageUpload(cellKey, file, onSuccess) {
    if (!file) return;

    try {
      setUploadingSections((current) => ({ ...current, [cellKey]: true }));
      setSectionUploadErrors((current) => ({ ...current, [cellKey]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/masters/upload/section-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSuccess(data.url, data.fileName);
    } catch (err) {
      console.error('Section image upload failed:', err);
      setSectionUploadErrors((current) => ({
        ...current,
        [cellKey]: err.response?.data?.error || 'Unable to upload image.',
      }));
    } finally {
      setUploadingSections((current) => ({ ...current, [cellKey]: false }));
    }
  }

  async function handleFieldImageUpload(fieldId, file) {
    if (!file) return;

    try {
      setUploadingFields((current) => ({ ...current, [fieldId]: true }));
      setFieldUploadErrors((current) => ({ ...current, [fieldId]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/masters/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setValues((current) => ({
        ...current,
        [fieldId]: {
          ...current[fieldId],
          image_url: data.url,
          value: data.fileName || data.url,
        },
      }));
    } catch (err) {
      console.error('Field image upload failed:', err);
      setFieldUploadErrors((current) => ({
        ...current,
        [fieldId]: err.response?.data?.error || 'Unable to upload image.',
      }));
    } finally {
      setUploadingFields((current) => ({ ...current, [fieldId]: false }));
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Record name is required.');
      setActiveTab('fields');
      return;
    }

    if (blocked) {
      setError('Resolve blocking rule violations before saving.');
      setActiveTab('fields');
      return;
    }

    try {
      setSaving(true);
      setError('');

      let savedRecordId = recordId;

      if (isNew) {
        const { data } = await api.post(`/masters/${masterId}/records`, {
          name: name.trim(),
          code: code.trim() || null,
        });
        savedRecordId = data.record.id;
      } else {
        await api.put(`/masters/${masterId}/records/${savedRecordId}`, {
          name: name.trim(),
          code: code.trim() || null,
        });
      }

      const valuesPayload = fields.map((field) => {
        const entry = values[field.id] || {};
        return {
          field_id: field.id,
          value: entry.value ?? null,
          image_url: entry.image_url || null,
          related_record_id: entry.related_record_id || null,
        };
      });

      const overridesPayload = Object.entries(overrides)
        .filter(([, thresholdValue]) => thresholdValue !== '' && thresholdValue != null)
        .map(([ruleId, thresholdValue]) => ({
          rule_id: ruleId,
          threshold_value: thresholdValue,
        }));

      const categoriesPayload = stripKeys(categories, ['key', 'value_type', 'value', 'image_url']);

      await Promise.all([
        api.put(`/masters/${masterId}/records/${savedRecordId}/values`, valuesPayload),
        api.put(`/masters/${masterId}/records/${savedRecordId}/sections`, sectionsToPayload(sectionRows)),
        api.put(`/masters/${masterId}/records/${savedRecordId}/categories`, categoriesPayload),
        api.put(`/masters/${masterId}/records/${savedRecordId}/overrides`, overridesPayload),
      ]);

      onSaved(savedRecordId);
    } catch (err) {
      console.error('Failed to save record:', err);
      setError(err.response?.data?.error || 'Unable to save record.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="component-drawer-overlay" onClick={onClose} aria-label="Close drawer" />
      <aside className="component-drawer record-drawer" aria-label="Record editor">
        <header className="component-drawer-header">
          <div className="record-drawer-title">
            <input
              type="text"
              className="record-drawer-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Record name"
              disabled={loading || saving}
            />
            <input
              type="text"
              className="record-drawer-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Code (optional)"
              disabled={loading || saving}
            />
          </div>
          <div className="component-drawer-header-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleSave}
              disabled={saving || loading || blocked}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </header>

        <nav className="component-drawer-tabs" aria-label="Record sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`component-drawer-tab${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="component-drawer-body">
          {error ? <p className="error-message">{error}</p> : null}
          {loading ? (
            <p className="muted">Loading record…</p>
          ) : (
            <>
              {activeTab === 'fields' ? (
                <FieldsTab
                  fields={fields}
                  values={values}
                  setValues={setValues}
                  rules={rules}
                  overrides={overrides}
                  saving={saving}
                  onImageUpload={handleFieldImageUpload}
                  uploadErrors={fieldUploadErrors}
                  uploadingFields={uploadingFields}
                />
              ) : null}
              {activeTab === 'sections' ? (
                <SectionsTab
                  masterSections={masterSections}
                  sectionRows={sectionRows}
                  setSectionRows={setSectionRows}
                  saving={saving}
                  onImageUpload={handleSectionImageUpload}
                  uploadErrors={sectionUploadErrors}
                  uploadingCells={uploadingSections}
                />
              ) : null}
              {activeTab === 'categories' ? (
                <CategoriesTab
                  items={categories}
                  setItems={setCategories}
                  newKey={newKey}
                  onImageUpload={handleCategoryImageUpload}
                  onRemoveItem={(itemKey) => {
                    setCategoryUploadErrors((current) => {
                      const next = { ...current };
                      delete next[itemKey];
                      return next;
                    });
                    setUploadingCategories((current) => {
                      const next = { ...current };
                      delete next[itemKey];
                      return next;
                    });
                  }}
                  uploadErrors={categoryUploadErrors}
                  uploadingItems={uploadingCategories}
                />
              ) : null}
              {activeTab === 'overrides' ? (
                <RuleOverridesTab rules={rules} overrides={overrides} setOverrides={setOverrides} />
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
