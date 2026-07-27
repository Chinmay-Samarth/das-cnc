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

  useEffect(() => {
    setValue(item.defaultValue ?? '');
  }, [item.defaultValue, item.id]);

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

  function handleBackdrop(e) {
    if (e.target !== e.currentTarget) return;
    if (item.kind === 'alert') onClose(undefined);
    else if (item.kind === 'confirm') onClose(false);
    else onClose(null);
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className={`app-dialog ${meta.className}`}
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
                  else submitPrompt();
                }}
                autoFocus
              >
                {item.confirmLabel || (item.kind === 'confirm' ? 'Confirm' : 'Save')}
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
