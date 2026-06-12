import { useState } from 'react';
import AddTypeDropdown from '../shared/AddTypeDropdown';
import {emptyField,emptySection,fieldTypeLabel,FIELD_TYPE_OPTIONS,labelToFieldKey,} from './utils';

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

function SectionFieldRow({ field, index, fieldCount, otherMasters, onUpdate, onMove, onRemove }) {
  function handleLabelChange(label) {
    const patch = { label };
    if (!field._keyManual) {
      patch.field_key = labelToFieldKey(label);
    }
    onUpdate(patch);
  }

  return (
    <div className="master-field-row">
      <div className="master-field-reorder">
        <button
          type="button"
          className="icon-button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Move field up"
        >
          ↑
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => onMove(1)}
          disabled={index === fieldCount - 1}
          aria-label="Move field down"
        >
          ↓
        </button>
      </div>

      <label>
        <input
          type="text"
          value={field.label}
          onChange={(event) => handleLabelChange(event.target.value)}
          placeholder="KEY"
          className="categories-key-input"
        />
      </label>

      <div className="master-field-type-badge" title="Field type">
        <span className="master-field-type-value">{fieldTypeLabel(field.type)}</span>
      </div>

      <label className="master-field-checkbox">
        Required
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => onUpdate({ required: event.target.checked })}
          className="h-12 w-12 accent-green-600 focus:ring-0 focus:outline-none"
        />
      </label>

      {field.type === 'select' ? (
        <div className="master-field-extra">
          <span className="master-field-extra-label">Options</span>
          <TagInput
            options={field.options}
            onChange={(options) => onUpdate({ options })}
          />
        </div>
      ) : null}

      {field.type === 'relation' ? (
        <label>
          Related master
          <select
            value={field.related_master_id || ''}
            onChange={(event) =>
              onUpdate({ related_master_id: event.target.value || null })
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
        onClick={onRemove}
        aria-label="Remove field"
      >
        ×
      </button>
    </div>
  );
}

export default function SectionsTab({ sections, setSections, allMasters, currentMasterId }) {
  const otherMasters = allMasters.filter((master) => master.id !== currentMasterId);

  function updateSection(sectionKey, patch) {
    setSections((current) =>
      current.map((section) =>
        section._key === sectionKey ? { ...section, ...patch } : section
      )
    );
  }

  function moveSection(sectionKey, direction) {
    setSections((current) => {
      const index = current.findIndex((section) => section._key === sectionKey);
      if (index < 0) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((section, sortOrder) => ({ ...section, sort_order: sortOrder }));
    });
  }

  function removeSection(sectionKey) {
    setSections((current) =>
      current
        .filter((section) => section._key !== sectionKey)
        .map((section, sortOrder) => ({ ...section, sort_order: sortOrder }))
    );
  }

  function addSection() {
    setSections((current) => [...current, emptySection(current.length)]);
  }

  function updateSectionField(sectionKey, fieldKey, patch) {
    setSections((current) =>
      current.map((section) => {
        if (section._key !== sectionKey) return section;
        return {
          ...section,
          fields: section.fields.map((field) =>
            field._key === fieldKey ? { ...field, ...patch } : field
          ),
        };
      })
    );
  }

  function moveSectionField(sectionKey, fieldKey, direction) {
    setSections((current) =>
      current.map((section) => {
        if (section._key !== sectionKey) return section;
        const index = section.fields.findIndex((field) => field._key === fieldKey);
        if (index < 0) return section;
        const target = index + direction;
        if (target < 0 || target >= section.fields.length) return section;

        const fields = [...section.fields];
        [fields[index], fields[target]] = [fields[target], fields[index]];
        return {
          ...section,
          fields: fields.map((field, sortOrder) => ({ ...field, sort_order: sortOrder })),
        };
      })
    );
  }

  function removeSectionField(sectionKey, fieldKey) {
    setSections((current) =>
      current.map((section) => {
        if (section._key !== sectionKey) return section;
        return {
          ...section,
          fields: section.fields
            .filter((field) => field._key !== fieldKey)
            .map((field, sortOrder) => ({ ...field, sort_order: sortOrder })),
        };
      })
    );
  }

  function addSectionField(sectionKey, type) {
    setSections((current) =>
      current.map((section) => {
        if (section._key !== sectionKey) return section;
        return {
          ...section,
          fields: [...section.fields, emptyField(section.fields.length, type)],
        };
      })
    );
  }

  return (
    <div className="master-builder-tab">
      {sections.length === 0 ? (
        <p className="muted">No sections yet. Add a section to define repeatable field groups.</p>
      ) : null}

      <div className="master-section-list">
        {sections.map((section, sectionIndex) => (
          <div key={section._key} className="master-section-card card">
            <header className="master-section-card-header">
              <div className="master-field-reorder">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => moveSection(section._key, -1)}
                  disabled={sectionIndex === 0}
                  aria-label="Move section up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => moveSection(section._key, 1)}
                  disabled={sectionIndex === sections.length - 1}
                  aria-label="Move section down"
                >
                  ↓
                </button>
              </div>

              <label className='master-section-name'>
                <input
                  type="text"
                  value={section.name}
                  onChange={(event) => updateSection(section._key, { name: event.target.value })}
                  placeholder="Section name"
                  className='categories-key-input'
                  required
                />
              </label>

              {/* <label>
                Description
                <input
                  type="text"
                  value={section.description}
                  onChange={(event) =>
                    updateSection(section._key, { description: event.target.value })
                  }
                  placeholder="Description (optional)"
                />
              </label> */}

              <button
                type="button"
                className="master-section-remove"
                onClick={() => removeSection(section._key)}
                aria-label="Remove section"
              >
                ×
              </button>
            </header>

            <div className="master-field-list master-section-list">
              {section.fields.map((field, fieldIndex) => (
                <SectionFieldRow
                  key={field._key}
                  field={field}
                  index={fieldIndex}
                  fieldCount={section.fields.length}
                  otherMasters={otherMasters}
                  onUpdate={(patch) => updateSectionField(section._key, field._key, patch)}
                  onMove={(direction) => moveSectionField(section._key, field._key, direction)}
                  onRemove={() => removeSectionField(section._key, field._key)}
                />
              ))}
            </div>

            <AddTypeDropdown
              buttonLabel="+ Add field"
              options={FIELD_TYPE_OPTIONS}
              onSelect={(type) => addSectionField(section._key, type)}
            />
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addSection}>
        + Add section
      </button>
    </div>
  );
}
