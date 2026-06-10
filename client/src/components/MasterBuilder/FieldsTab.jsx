import { useState } from 'react';
import AddTypeDropdown from '../shared/AddTypeDropdown';
import { compareFields, emptyField, fieldTypeLabel, FIELD_TYPE_OPTIONS, labelToFieldKey } from './utils';

function TagInput({ options, onChange }) {
  const [draft, setDraft] = useState('');

  function addOption() {
    const value = draft.trim();
    if (!value || options.includes(value)) return;
    onChange([...options, value]);
    setDraft('');
  }

  return (
    <div className="tag-input">
      <div className="tag-list">
        {options.map((option) => (
          <span key={option} className="tag-chip">
            {option}
            <button
              type="button"
              className="tag-remove"
              onClick={() => onChange(options.filter((item) => item !== option))}
              aria-label={`Remove ${option}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          type="text"
          value={draft}
          placeholder="Add option"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addOption();
            }
          }}
        />
        <button type="button" className="secondary-button" onClick={addOption}>Add</button>
      </div>
    </div>
  );
}

export default function FieldsTab({ fields, setFields, allMasters, currentMasterId }) {
  const otherMasters = allMasters.filter((master) => master.id !== currentMasterId);

  function updateField(key, patch) {
    setFields((current) =>
      current.map((field) => (field._key === key ? { ...field, ...patch } : field))
    );
  }

  function handleLabelChange(key, label) {
    setFields((current) =>
      current.map((field) => {
        if (field._key !== key) return field;
        const next = { ...field, label };
        if (!field._keyManual) {
          next.field_key = labelToFieldKey(label);
        }
        return next;
      })
    );
  }

  function handleFieldKeyChange(key, fieldKey) {
    updateField(key, { field_key: fieldKey, _keyManual: true });
  }

  function moveField(key, direction) {
    setFields((current) => {
      const index = current.findIndex((field) => field._key === key);
      if (index < 0) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((field, sortOrder) => ({ ...field, sort_order: sortOrder }));
    });
  }

  function removeField(key) {
    setFields((current) =>
      current
        .filter((field) => field._key !== key)
        .map((field, sortOrder) => ({ ...field, sort_order: sortOrder }))
    );
  }

  function addField(type) {
    setFields((current) => [...current, emptyField(current.length, type)]);
  }

  return (
    <div className="master-builder-tab">
      {fields.length === 0 ? (
        <p className="muted">No fields yet. Use the add button below and pick a field type.</p>
      ) : null}

      <div className="master-field-list">
        {fields.map((field, index) => (
          <div key={field._key} className="master-field-row">
            <div className="master-field-reorder">
              <button
                type="button"
                className="icon-button"
                onClick={() => moveField(field._key, -1)}
                disabled={index === 0}
                aria-label="Move field up"
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => moveField(field._key, 1)}
                disabled={index === fields.length - 1}
                aria-label="Move field down"
              >
                ↓
              </button>
            </div>
      
              <label>
                <input
                  type="text"
                  value={field.label}
                  onChange={(event) => handleLabelChange(field._key, event.target.value)}
                  placeholder='KEY'
                  className='categories-key-input'
                  />
              </label>

              {/* Field Key */}
              {/* <label>
                <input
                type="text"
                value={field.field_key}
                onChange={(event) => handleFieldKeyChange(field._key, event.target.value)}
                hidden
                />
                </label> */}

              <div className="master-field-type-badge" title="Field type">
                <span className="master-field-type-value">{fieldTypeLabel(field.type)}</span>
              </div>

              <label className="master-field-checkbox">
                Required
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => updateField(field._key, { required: event.target.checked })}
                  className='h-12 w-12 accent-green-600 focus:ring-0 focus:outline-none'
                  />
              </label>
            

            {field.type === 'select' ? (
              <div className="master-field-extra">
                <span className="master-field-extra-label">Options</span>
                <TagInput
                  options={field.options}
                  onChange={(options) => updateField(field._key, { options })}
                />
              </div>
            ) : null}

            {field.type === 'relation' ? (
              <label>
                Related master
                <select
                  value={field.related_master_id || ''}
                  onChange={(event) =>
                    updateField(field._key, {
                      related_master_id: event.target.value || null,
                    })
                  }
                >
                  <option value="">Select master</option>
                  {otherMasters.map((master) => (
                    <option key={master.id} value={master.id}>
                      {master.icon ? `${master.icon} ` : ''}
                      {master.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <button
              type="button"
              className="master-field-remove"
              onClick={() => removeField(field._key)}
              aria-label="Remove field"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <AddTypeDropdown
        buttonLabel="+ Add field"
        options={FIELD_TYPE_OPTIONS}
        onSelect={addField}
      />

      {compareFields(fields).length === 0 && fields.length > 0 ? (
        <p className="muted">Add at least one number or date field to use rules.</p>
      ) : null}
    </div>
  );
}
