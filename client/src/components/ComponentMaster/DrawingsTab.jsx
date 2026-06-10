import { useState } from 'react';
import api from '../../api/client';

export default function DrawingsTab({ items, setItems, newKey }) {
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
      { _key: newKey(), name: '', customer_specification: '', file_url: '', file_name: '' },
    ]);
  };

  const handleUpload = async (key, file) => {
    if (!file) return;

    try {
      setUploadErrors((current) => ({ ...current, [key]: '' }));
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/components/upload/drawing', formData, {
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
      console.error('Drawing upload failed:', err);
      setUploadErrors((current) => ({
        ...current,
        [key]: err.response?.data?.error || 'Unable to upload drawing.',
      }));
    }
  };

  const clearFile = (key) => {
    setItems((current) =>
      current.map((item) =>
        item._key === key ? { ...item, file_url: '', file_name: '' } : item
      )
    );
  };

  return (
    <div className="component-tab">
      {items.length === 0 ? <p className="muted">No drawings yet.</p> : null}

      <div className="component-stack">
        {items.map((item) => (
          <div key={item._key} className="component-card">
            <div className="component-card-header">
              <strong>Drawing</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => removeItem(item._key)}
                aria-label="Remove drawing"
              >
                ×
              </button>
            </div>

            <label>
              Name
              <input
                type="text"
                value={item.name || ''}
                onChange={(event) => updateItem(item._key, 'name', event.target.value)}
              />
            </label>

            <label>
              Customer specification
              <textarea
                rows={3}
                value={item.customer_specification || ''}
                onChange={(event) =>
                  updateItem(item._key, 'customer_specification', event.target.value)
                }
              />
            </label>

            <div className="component-upload-block">
              <label className="file-input-label">
                Upload file
                <input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    handleUpload(item._key, file);
                    event.target.value = '';
                  }}
                />
              </label>

              {item.file_name ? (
                <div className="uploaded-file">
                  <a href={item.file_url} target="_blank" rel="noreferrer">
                    {item.file_name}
                  </a>
                  <button type="button" className="text-button" onClick={() => clearFile(item._key)}>
                    Remove file
                  </button>
                </div>
              ) : null}

              {uploadErrors[item._key] ? (
                <p className="field-error">{uploadErrors[item._key]}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addItem}>
        Add drawing
      </button>
    </div>
  );
}
