export default function StandardTab({ standard, setStandard }) {
  const handleChange = (event) => {
    const { name, value } = event.target;
    setStandard((current) => ({ ...current, [name]: value }));
  };

  return (
    <div className="component-tab">
      <div className="component-form-grid">
        <label htmlFor="standard-min-qty">
          Minimum quantity
          <input
            id="standard-min-qty"
            type="number"
            name="minimum_quantity"
            value={standard.minimum_quantity ?? ''}
            onChange={handleChange}
          />
        </label>

        <label htmlFor="standard-max-qty">
          Maximum quantity
          <input
            id="standard-max-qty"
            type="number"
            name="maximum_quantity"
            value={standard.maximum_quantity ?? ''}
            onChange={handleChange}
          />
        </label>
      </div>

      <label htmlFor="standard-location" className="component-full-width">
        Location
        <input
          id="standard-location"
          type="text"
          name="location"
          value={standard.location || ''}
          onChange={handleChange}
        />
      </label>
    </div>
  );
}
