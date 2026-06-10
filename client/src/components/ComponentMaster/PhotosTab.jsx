import { useState } from 'react';
import api from '../../api/client';

export default function PhotosTab({ items, setItems, newKey }) {
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

  const addItem = () => {
    setItems((current) => [
      ...current,
      { _key: newKey(), name: '', file_url: '', file_name: '' },
    ]);
  };

  const handleUpload = async (key, file) => {
    if (!file) return;

    try {
      setUploadErrors((current) => ({ ...current, [key]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/components/upload/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setItems((current) =>
        current.map((item) =>
          item._key === key
            ? { ...item, file_url: data.url, file_name: data.fileName }
            : item
        )
      );
    } catch (err) {
      console.error('Photo upload failed:', err);
      setUploadErrors((current) => ({
        ...current,
        [key]: err.response?.data?.error || 'Unable to upload photo.',
      }));
    }
  };

  return (
    <div className="component-tab">
      <div className="component-photo-grid">
        {items.map((item) => (
          <div key={item._key} className="component-photo-card">
            <button
              type="button"
              className="icon-button component-photo-remove"
              onClick={() => removeItem(item._key)}
              aria-label="Remove photo"
            >
              ×
            </button>

            {item.file_url ? (
              <img src={item.file_url} alt={item.name || 'Component photo'} className="component-photo-preview" />
            ) : (
              <label className="component-photo-upload">
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    handleUpload(item._key, file);
                    event.target.value = '';
                  }}
                />
              </label>
            )}

            <input
              type="text"
              placeholder="Caption"
              value={item.name || ''}
              onChange={(event) => updateItem(item._key, 'name', event.target.value)}
            />

            {uploadErrors[item._key] ? (
              <p className="field-error">{uploadErrors[item._key]}</p>
            ) : null}
          </div>
        ))}

        <button type="button" className="component-photo-add" onClick={addItem}>
          + Add photo
        </button>
      </div>
    </div>
  );
}
