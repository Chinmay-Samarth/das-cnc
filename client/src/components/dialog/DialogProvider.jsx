import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react';
import { registerDialogHost } from './dialogController';

const TONE_META = {
  info: { Icon: Info, className: 'is-info' },
  success: { Icon: CheckCircle2, className: 'is-success' },
  warning: { Icon: AlertTriangle, className: 'is-warning' },
  danger: { Icon: AlertTriangle, className: 'is-danger' },
};

function AppDialog({ item, onClose }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(item.defaultValue ?? '');
  const [formValues, setFormValues] = useState(() => ({ ...(item.defaultValues || {}) }));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setValue(item.defaultValue ?? '');
    setFormValues({ ...(item.defaultValues || {}) });
    setFormError('');
  }, [item.defaultValue, item.defaultValues, item.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (item.kind === 'prompt' && inputRef.current) {
        inputRef.current.focus();
        if (item.readOnly && inputRef.current.select) inputRef.current.select();
      }
    }, 0);
    return () => clearTimeout(t);
  }, [item.id, item.kind, item.readOnly]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (item.kind === 'alert') onClose(undefined);
        else if (item.kind === 'confirm') onClose(false);
        else onClose(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item.kind, onClose]);

  const tone = item.tone || (item.kind === 'confirm' ? 'danger' : 'info');
  const meta = TONE_META[tone] || TONE_META.info;
  const Icon = meta.Icon;

  function submitPrompt() {
    if (item.readOnly) {
      onClose(value);
      return;
    }
    onClose(value);
  }

  function submitForm() {
    const fields = item.fields || [];
    for (const f of fields) {
      if (!f.required) continue;
      const v = formValues[f.name];
      if (f.type === 'checklist') {
        if (!Array.isArray(v) || v.length === 0) {
          setFormError(`${f.label || f.name} is required`);
          return;
        }
        continue;
      }
      if (v == null || String(v).trim() === '') {
        setFormError(`${f.label || f.name} is required`);
        return;
      }
    }
    setFormError('');
    onClose({ ...formValues });
  }

  function toggleChecklistValue(fieldName, optionValue) {
    setFormValues((prev) => {
      const current = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      return { ...prev, [fieldName]: next };
    });
    setFormError('');
  }

  function setChecklistAll(fieldName, optionValues, selectAll) {
    setFormValues((prev) => ({
      ...prev,
      [fieldName]: selectAll ? [...optionValues] : [],
    }));
    setFormError('');
  }

  function formatChecklistAmount(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function handleBackdrop(e) {
    if (e.target !== e.currentTarget) return;
    if (item.kind === 'alert') onClose(undefined);
    else if (item.kind === 'confirm') onClose(false);
    else onClose(null);
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className={`app-dialog ${meta.className}${item.wide ? ' app-dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-dialog-icon" aria-hidden>
          <Icon size={22} strokeWidth={2} />
        </div>
        <div className="app-dialog-body">
          <h2 id="app-dialog-title" className="app-dialog-title">
            {item.title}
          </h2>
          {item.message ? <p className="app-dialog-message">{item.message}</p> : null}

          {item.kind === 'prompt' ? (
            item.multiline ? (
              <textarea
                ref={inputRef}
                className="app-dialog-input app-dialog-textarea"
                rows={item.rows || 4}
                value={value}
                readOnly={!!item.readOnly}
                placeholder={item.placeholder || ''}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <input
                ref={inputRef}
                className="app-dialog-input"
                type={item.inputType || 'text'}
                value={value}
                readOnly={!!item.readOnly}
                placeholder={item.placeholder || ''}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && item.kind === 'prompt' && !item.multiline) {
                    e.preventDefault();
                    submitPrompt();
                  }
                }}
              />
            )
          ) : null}

          {item.kind === 'form' ? (
            <div className="app-dialog-form">
              {(item.fields || []).map((field) => {
                if (field.type === 'checklist') {
                  const options = (field.options || []).map((opt) =>
                    typeof opt === 'string'
                      ? { value: opt, label: opt }
                      : { value: opt.value, label: opt.label, amount: opt.amount }
                  );
                  const selected = Array.isArray(formValues[field.name])
                    ? formValues[field.name]
                    : [];
                  const allValues = options.map((o) => o.value);
                  const allSelected =
                    allValues.length > 0 && allValues.every((v) => selected.includes(v));
                  const hasAmounts = options.some((o) => o.amount != null && o.amount !== '');
                  const selectedTotal = hasAmounts
                    ? options
                        .filter((o) => selected.includes(o.value))
                        .reduce((sum, o) => sum + Number(o.amount || 0), 0)
                    : null;

                  return (
                    <div key={field.name} className="app-dialog-field">
                      <div className="app-dialog-checklist-header">
                        <span className="app-dialog-field-label">
                          {field.label || field.name}
                          {field.required ? ' *' : ''}
                        </span>
                        <button
                          type="button"
                          className="app-dialog-checklist-toggle"
                          disabled={!!field.disabled || !allValues.length}
                          onClick={() =>
                            setChecklistAll(field.name, allValues, !allSelected)
                          }
                        >
                          {allSelected ? 'Clear' : 'Select all'}
                        </button>
                      </div>
                      <div className="app-dialog-checklist" role="group">
                        {options.length ? (
                          options.map((opt) => {
                            const checked = selected.includes(opt.value);
                            return (
                              <label key={opt.value} className="app-dialog-checklist-item">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!!field.disabled}
                                  onChange={() =>
                                    toggleChecklistValue(field.name, opt.value)
                                  }
                                />
                                <span className="app-dialog-checklist-label">{opt.label}</span>
                                {opt.amount != null && opt.amount !== '' ? (
                                  <span className="app-dialog-checklist-amount">
                                    ₹{formatChecklistAmount(opt.amount)}
                                  </span>
                                ) : null}
                              </label>
                            );
                          })
                        ) : (
                          <p className="app-dialog-checklist-empty">No options</p>
                        )}
                      </div>
                      {selectedTotal != null ? (
                        <p className="app-dialog-checklist-total">
                          Selected total:{' '}
                          <strong>₹{formatChecklistAmount(selectedTotal)}</strong>
                        </p>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <label key={field.name} className="app-dialog-field">
                    <span className="app-dialog-field-label">
                      {field.label || field.name}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.type === 'select' ? (
                      <select
                        className="app-dialog-input"
                        value={formValues[field.name] ?? ''}
                        disabled={!!field.disabled}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                      >
                        <option value="">{field.placeholder || 'Select…'}</option>
                        {(field.options || []).map((opt) => {
                          const val = typeof opt === 'string' ? opt : opt.value;
                          const lab = typeof opt === 'string' ? opt : opt.label;
                          return (
                            <option key={val} value={val}>
                              {lab}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <input
                        className="app-dialog-input"
                        type={field.type || 'text'}
                        value={formValues[field.name] ?? ''}
                        placeholder={field.placeholder || ''}
                        disabled={!!field.disabled}
                        readOnly={!!field.readOnly}
                        step={field.type === 'number' ? field.step || 'any' : undefined}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                      />
                    )}
                  </label>
                );
              })}
              {formError ? (
                <p className="app-dialog-form-error" style={{ color: '#b91c1c', margin: '8px 0 0' }}>
                  {formError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="app-dialog-actions">
          {item.kind === 'alert' || (item.kind === 'prompt' && item.readOnly) ? (
            <button
              type="button"
              className="mes-btn mes-btn-primary"
              onClick={() => onClose(item.kind === 'prompt' ? value : undefined)}
              autoFocus
            >
              {item.confirmLabel || 'OK'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                onClick={() => onClose(item.kind === 'confirm' ? false : null)}
              >
                {item.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className={`mes-btn ${tone === 'danger' ? 'mes-btn-danger' : 'mes-btn-primary'}`}
                onClick={() => {
                  if (item.kind === 'confirm') onClose(true);
                  else if (item.kind === 'form') submitForm();
                  else submitPrompt();
                }}
                autoFocus
              >
                {item.confirmLabel ||
                  (item.kind === 'confirm' ? 'Confirm' : item.kind === 'form' ? 'Submit' : 'Save')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const idRef = useRef(0);

  const enqueue = useCallback((item) => {
    const id = ++idRef.current;
    setQueue((q) => [...q, { ...item, id }]);
  }, []);

  useEffect(() => {
    registerDialogHost(enqueue);
    return () => registerDialogHost(null);
  }, [enqueue]);

  const current = queue[0] ?? null;

  function close(result) {
    if (!current) return;
    current.resolve(result);
    setQueue((q) => q.slice(1));
  }

  return (
    <>
      {children}
      {current ? <AppDialog key={current.id} item={current} onClose={close} /> : null}
    </>
  );
}
