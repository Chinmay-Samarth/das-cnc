import AddTypeDropdown from '../shared/AddTypeDropdown';
import { CATEGORY_TYPE_OPTIONS, categoryTypeLabel, createEmptyCategory } from '../shared/categoryTypes';

export default function CategoriesTab({
  items,
  setItems,
  newKey,
  onImageUpload,
  onRemoveItem,
  uploadErrors = {},
  uploadingItems = {},
}) {
  const updateItem = (key, field, value) => {
    setItems((current) =>
      current.map((item) => (item._key === key ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (key) => {
    setItems((current) => current.filter((item) => item._key !== key));
    onRemoveItem?.(key);
  };

  const addItem = (valueType) => {
    setItems((current) => [...current, createEmptyCategory(newKey, valueType)]);
  };

  return (
    <div className="component-tab">
      {items.length === 0 ? (
        <p className="muted">No categories yet. Use the add button below and pick a type.</p>
      ) : null}

      <div className="component-list">
        {items.map((item) => {
          const uploading = Boolean(uploadingItems[item._key]);

          return (
            <div key={item._key} className="component-list-row component-category-row">
              <label>
                <input
                  type="text"
                  value={item.key || ''}
                  onChange={(event) => updateItem(item._key, 'key', event.target.value)}
                  disabled={uploading}
                  placeholder='KEY'
                  className='categories-key-input'
                />
              </label>

              {/* <div className="master-field-type-badge" title="Category type">
                <span className="master-field-type-label">Type</span>
                <span className="master-field-type-value">{categoryTypeLabel(item.value_type)}</span>
                </div> */}

              <div className="component-category-value">
                {item.value_type === 'text' ? (
                  <label>
                    <input
                      type="text"
                      value={item.value || ''}
                      onChange={(event) => updateItem(item._key, 'value', event.target.value)}
                      disabled={uploading}
                      className='categories-value-input'
                      placeholder='Value'
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
                      disabled={uploading}
                    />
                  </label>
                ) : null}

                {item.value_type === 'image' ? (
                  <div className="component-category-image">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.key || 'Category image'} className="category-thumb" />
                    ) : null}
                    <label className="file-input-label">
                      {uploading ? 'Uploading…' : 'Upload image'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          onImageUpload(item._key, file);
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
                className="icon-button master-field-remove"
                onClick={() => removeItem(item._key)}
                aria-label="Remove category"
                disabled={uploading}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <AddTypeDropdown
        buttonLabel="+ Add Field"
        options={CATEGORY_TYPE_OPTIONS}
        onSelect={addItem}
      />
    </div>
  );
}
