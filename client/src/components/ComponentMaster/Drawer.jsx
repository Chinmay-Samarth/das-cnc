import { useEffect, useState } from 'react';
import api from '../../api/client';
import CategoriesTab from './CategoriesTab';
import CommercialsTab from './CommercialsTab';
import DrawingsTab from './DrawingsTab';
import InfoTab from './InfoTab';
import PhotosTab from './PhotosTab';
import StandardTab from './StandardTab';
import { getStandard, toStandardForm } from './utils';

const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'commercials', label: 'Commercials' },
  { id: 'standard', label: 'Standard' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'photos', label: 'Photos' },
  { id: 'categories', label: 'Categories' },
];

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stripKeys(items, fields) {
  return items.map((item) => {
    const payload = {};
    fields.forEach((field) => {
      payload[field] = item[field] ?? null;
    });
    return payload;
  });
}

const emptyInfo = () => ({
  name: '',
  code: '',
  size: '',
  used_for: '',
  specification: '',
});

const emptyStandard = () => ({
  minimum_quantity: '',
  maximum_quantity: '',
  location: '',
});

export default function ComponentDrawer({ componentId, onClose, onSaved }) {
  const isNew = !componentId;
  const [activeTab, setActiveTab] = useState('info');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const [info, setInfo] = useState(emptyInfo);
  const [commercials, setCommercials] = useState([]);
  const [standard, setStandard] = useState(emptyStandard);
  const [drawings, setDrawings] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    if (!componentId) {
      setInfo(emptyInfo());
      setCommercials([]);
      setStandard(emptyStandard());
      setDrawings([]);
      setPhotos([]);
      setCategories([]);
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    async function loadComponent() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get(`/components/${componentId}`);
        if (!mounted) return;

        const component = data.component;
        setInfo({
          name: component.name || '',
          code: component.code || '',
          size: component.size || '',
          used_for: component.used_for || '',
          specification: component.specification || '',
        });
        setCommercials((component.commercials || []).map((item) => ({ ...item, _key: newKey() })));
        setStandard(toStandardForm(getStandard(component)));
        setDrawings((component.drawings || []).map((item) => ({ ...item, _key: newKey() })));
        setPhotos((component.photos || []).map((item) => ({ ...item, _key: newKey() })));
        setCategories((component.categories || []).map((item) => ({ ...item, _key: newKey() })));
      } catch (err) {
        console.error('Failed to load component:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load component details.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadComponent();
    return () => {
      mounted = false;
    };
  }, [componentId]);

  const validate = () => {
    const nextErrors = {};
    if (!info.name.trim()) nextErrors.name = 'Name is required';
    if (!info.code.trim()) nextErrors.code = 'Code is required';
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setActiveTab('info');
      return;
    }

    try {
      setSaving(true);
      setError('');

      let savedComponentId = componentId;
      if (isNew) {
        const { data } = await api.post('/components', info);
        savedComponentId = data.component.id;
      } else {
        await api.put(`/components/${savedComponentId}`, info);
      }

      const standardPayload = {
        minimum_quantity: standard.minimum_quantity,
        maximum_quantity: standard.maximum_quantity,
        location: standard.location,
      };

      await Promise.all([
        api.put(`/components/${savedComponentId}/commercials`, stripKeys(commercials, ['name', 'rate', 'moq'])),
        api.put(`/components/${savedComponentId}/standard`, standardPayload),
        api.put(`/components/${savedComponentId}/drawings`, stripKeys(drawings, ['name', 'customer_specification', 'file_url', 'file_name'])),
        api.put(`/components/${savedComponentId}/photos`, stripKeys(photos, ['name', 'file_url', 'file_name'])),
        api.put(`/components/${savedComponentId}/categories`, stripKeys(categories, ['key', 'value_type', 'value', 'image_url'])),
      ]);

      onSaved(savedComponentId);
    } catch (err) {
      console.error('Failed to save component:', err);
      setError(err.response?.data?.error || 'Unable to save component.');
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = info.name.trim() || (isNew ? 'New component' : 'Component');
  const headerCode = info.code.trim();

  return (
    <>
      <button type="button" className="component-drawer-overlay" onClick={onClose} aria-label="Close drawer" />
      <aside className="component-drawer" aria-label="Component editor">
        <header className="component-drawer-header">
          <div>
            <h2>{headerTitle}</h2>
            {headerCode ? <p className="muted">{headerCode}</p> : null}
          </div>
          <div className="component-drawer-header-actions">
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </header>

        <nav className="component-drawer-tabs" aria-label="Component sections">
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
            <p className="muted">Loading component...</p>
          ) : (
            <>
              {activeTab === 'info' ? (
                <InfoTab info={info} setInfo={setInfo} fieldErrors={fieldErrors} />
              ) : null}
              {activeTab === 'commercials' ? (
                <CommercialsTab items={commercials} setItems={setCommercials} newKey={newKey} />
              ) : null}
              {activeTab === 'standard' ? (
                <StandardTab standard={standard} setStandard={setStandard} />
              ) : null}
              {activeTab === 'drawings' ? (
                <DrawingsTab items={drawings} setItems={setDrawings} newKey={newKey} />
              ) : null}
              {activeTab === 'photos' ? (
                <PhotosTab items={photos} setItems={setPhotos} newKey={newKey} />
              ) : null}
              {activeTab === 'categories' ? (
                <CategoriesTab items={categories} setItems={setCategories} newKey={newKey} />
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
