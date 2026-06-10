export default function InfoTab({ info, setInfo, fieldErrors }) {
  const handleChange = (event) => {
    const { name, value } = event.target;
    setInfo((current) => ({ ...current, [name]: value }));
  };

  return (
    <div className="component-tab">
      <div className="component-form-grid">
        <label htmlFor="component-name">
          Name <span className="required-mark">*</span>
          <input
            id="component-name"
            type="text"
            name="name"
            value={info.name}
            onChange={handleChange}
            className={fieldErrors.name ? 'input-error' : ''}
          />
          {fieldErrors.name ? <span className="field-error">{fieldErrors.name}</span> : null}
        </label>

        <label htmlFor="component-code">
          Code <span className="required-mark">*</span>
          <input
            id="component-code"
            type="text"
            name="code"
            value={info.code}
            onChange={handleChange}
            className={fieldErrors.code ? 'input-error' : ''}
          />
          {fieldErrors.code ? <span className="field-error">{fieldErrors.code}</span> : null}
        </label>

        <label htmlFor="component-size">
          Size
          <input
            id="component-size"
            type="text"
            name="size"
            value={info.size}
            onChange={handleChange}
          />
        </label>

        <label htmlFor="component-used-for">
          Used for
          <input
            id="component-used-for"
            type="text"
            name="used_for"
            value={info.used_for}
            onChange={handleChange}
          />
        </label>
      </div>

      <label htmlFor="component-specification" className="component-full-width">
        Specification
        <textarea
          id="component-specification"
          name="specification"
          value={info.specification}
          onChange={handleChange}
          rows={5}
        />
      </label>
    </div>
  );
}
