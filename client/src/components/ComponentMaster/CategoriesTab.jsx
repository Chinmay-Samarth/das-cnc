import { useState } from 'react';
import api from '../../api/client';
import AddTypeDropdown from '../shared/AddTypeDropdown';
import { CATEGORY_TYPE_OPTIONS, categoryTypeLabel, createEmptyCategory } from '../shared/categoryTypes';

export default function CategoriesTab({ items, setItems, newKey }) {
  const [uploadErrors, setUploadErrors] = useState({});

  const updateItem = (key, field, value) => {
    setItems((current) =>
      current.map((item) => (item._key === key ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (key) => {
    setItems((current) => current.filter((item) => item._key !== key));
    setUploadErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const addItem = (valueType) => {
    setItems((current) => [...current, createEmptyCategory(newKey, valueType)]);
  };

  const handleImageUpload = async (itemKey, file) => {
    if (!file) return;

    try {
      setUploadErrors((current) => ({ ...current, [itemKey]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/components/upload/category-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setItems((current) =>
        current.map((item) =>
          item._key === itemKey ? { ...item, image_url: data.url } : item
        )
      );
    } catch (err) {
      console.error('Category image upload failed:', err);
      setUploadErrors((current) => ({
        ...current,
        [itemKey]: err.response?.data?.error || 'Unable to upload image.',
      }));
    }
  };

  return (
    <div className="component-tab">
      {items.length === 0 ? (
        <p className="muted">No categories yet. Use the add button below and pick a type.</p>
      ) : null}

      <div className="component-list">
        {items.map((item) => (
          <div key={item._key} className="component-list-row component-category-row">
            <label>
              Key
              <input
                type="text"
                value={item.key || ''}
                onChange={(event) => updateItem(item._key, 'key', event.target.value)}
              />
            </label>

            <div className="master-field-type-badge" title="Category type">
              <span className="master-field-type-label">Type</span>
              <span className="master-field-type-value">{categoryTypeLabel(item.value_type)}</span>
            </div>

            <div className="component-category-value">
              {item.value_type === 'text' ? (
                <label>
                  Value
                  <input
                    type="text"
                    value={item.value || ''}
                    onChange={(event) => updateItem(item._key, 'value', event.target.value)}
                  />
                </label>
              ) : null}

              {item.value_type === 'number' ? (
                <label>
                  Value
                  <input
                    type="number"
                    value={item.value ?? ''}
                    onChange={(event) => updateItem(item._key, 'value', event.target.value)}
                  />
                </label>
              ) : null}

              {item.value_type === 'image' ? (
                <div className="component-category-image">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.key || 'Category image'} className="category-thumb" />
                  ) : null}
                  <label className="file-input-label">
                    Upload image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        handleImageUpload(item._key, file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {uploadErrors[item._key] ? (
                    <p className="field-error">{uploadErrors[item._key]}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="icon-button"
              onClick={() => removeItem(item._key)}
              aria-label="Remove category"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <AddTypeDropdown
        buttonLabel="+ Add category"
        options={CATEGORY_TYPE_OPTIONS}
        onSelect={addItem}
      />
    </div>
  );
}
