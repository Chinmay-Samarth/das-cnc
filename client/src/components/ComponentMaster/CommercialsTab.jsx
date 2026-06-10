export default function CommercialsTab({ items, setItems, newKey }) {
  const updateItem = (key, field, value) => {
    setItems((current) =>
      current.map((item) => (item._key === key ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (key) => {
    setItems((current) => current.filter((item) => item._key !== key));
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      { _key: newKey(), name: '', rate: '', moq: '' },
    ]);
  };

  return (
    <div className="component-tab">
      {items.length === 0 ? <p className="muted">No commercial rows yet.</p> : null}

      <div className="component-list">
        {items.map((item) => (
          <div key={item._key} className="component-list-row">
            <label>
              Name
              <input
                type="text"
                value={item.name || ''}
                onChange={(event) => updateItem(item._key, 'name', event.target.value)}
              />
            </label>
            <label>
              Rate
              <input
                type="number"
                value={item.rate ?? ''}
                onChange={(event) => updateItem(item._key, 'rate', event.target.value)}
              />
            </label>
            <label>
              MOQ
              <input
                type="number"
                value={item.moq ?? ''}
                onChange={(event) => updateItem(item._key, 'moq', event.target.value)}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              onClick={() => removeItem(item._key)}
              aria-label="Remove commercial row"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addItem}>
        Add row
      </button>
    </div>
  );
}
