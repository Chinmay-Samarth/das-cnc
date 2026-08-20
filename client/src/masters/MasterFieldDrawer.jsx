import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import { FIELD_TYPES, cloneDeep, toSlug } from './masterBuilderUtils';

function OptionsEditor({ options, onChange }) {
  const [draft, setDraft] = useState('');

  function add() {
    const v = draft.trim();
    if (!v || options.includes(v)) return;
    onChange([...options, v]);
    setDraft('');
  }

  function remove(opt) {
    onChange(options.filter((o) => o !== opt));
  }

  return (
    <div className="tag-input mmb-options">
      <span className="mmb-field-label">Options</span>
      <div className="tag-list">
        {options.map((opt) => (
          <span key={opt} className="tag-chip">
            {opt}
            <button className="tag-remove" type="button" onClick={() => remove(opt)} title={`Remove "${opt}"`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Type an option and press Enter"
        />
        <button type="button" className="neutral-button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

export default function MasterFieldDrawer({ field, availableMasters, onSave, onClose }) {
  const [local, setLocal] = useState(() => cloneDeep(field));
  const [errors, setErrors] = useState({});
  const labelInputRef = useRef(null);

  useEffect(() => {
    labelInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function set(key, value) {
    setLocal((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'label') {
        next.slug = toSlug(value);
        next._slugManual = false;
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  function validate() {
    const errs = {};
    if (!local.label.trim()) errs.label = 'Label is required';
    if (!toSlug(local.label).trim()) errs.label = errs.label || 'Label must produce a valid slug';
    if ((local.field_type === 'select' || local.field_type === 'multi_select') && local.options.length === 0) {
      errs.options = 'Add at least one option';
    }
    if (local.field_type === 'relation' && !local.related_master_id) {
      errs.related_master_id = 'Select a related master';
    }
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    onSave(local);
  }

  const needsOptions = local.field_type === 'select' || local.field_type === 'multi_select';
  const needsRelation = local.field_type === 'relation';

  return createPortal(
    <div className="mmb-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="mmb-drawer" role="dialog" aria-modal="true" aria-label="Field editor">
        <div className="mmb-drawer-header">
          <div className="mmb-drawer-heading">
            <p className="mes-eyebrow">Field editor</p>
            <h2 className="mmb-drawer-title">{local.label || 'New field'}</h2>
          </div>
          <button type="button" className="neutral-button mmb-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mmb-drawer-body">
          <div className={`record-field-label${errors.label ? ' is-highlighted' : ''}`}>
            <span>
              Label <span className="mmb-req">*</span>
            </span>
            <input
              ref={labelInputRef}
              value={local.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder="e.g. Customer Name"
            />
            {errors.label ? <span className="mmb-error">{errors.label}</span> : null}
          </div>

          <div className="record-field-label">
            <span>Field type</span>
            <FormSearchSelect
              value={local.field_type}
              onChange={(value) => set('field_type', value)}
              options={FIELD_TYPES}
              searchable
              placeholder="Search field type…"
              clearable={false}
            />
          </div>

          {needsOptions ? (
            <div>
              <OptionsEditor
                options={local.options}
                onChange={(opts) => {
                  setLocal((p) => ({ ...p, options: opts }));
                  setErrors((e) => ({ ...e, options: null }));
                }}
              />
              {errors.options ? <span className="mmb-error">{errors.options}</span> : null}
            </div>
          ) : null}

          {needsRelation ? (
            <div className={`record-field-label${errors.related_master_id ? ' is-highlighted' : ''}`}>
              <span>
                Related master <span className="mmb-req">*</span>
              </span>
              <FormSearchSelect
                value={local.related_master_id ?? ''}
                onChange={(value) => set('related_master_id', value || null)}
                options={availableMasters.map((m) => ({ value: m.id, label: m.name }))}
                searchable
                placeholder="Search master…"
                emptyMessage="No masters found"
              />
              {errors.related_master_id ? (
                <span className="mmb-error">{errors.related_master_id}</span>
              ) : null}
            </div>
          ) : null}

          <label className="mmb-check">
            <input
              type="checkbox"
              checked={local.is_required}
              onChange={(e) => set('is_required', e.target.checked)}
            />
            <span>Required field</span>
          </label>
        </div>

        <div className="mmb-drawer-footer">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={handleSave}>
            Save field
          </button>
        </div>
      </aside>
    </div>,
    document.body
  );
}
