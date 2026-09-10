/** @typedef {'alert' | 'confirm' | 'prompt' | 'form'} DialogKind */
/** @typedef {'info' | 'success' | 'warning' | 'danger'} DialogTone */

/** @type {((item: object) => void) | null} */
let enqueueDialog = null;

export function registerDialogHost(host) {
  enqueueDialog = host;
}

function enqueue(options) {
  return new Promise((resolve) => {
    if (!enqueueDialog) {
      if (options.kind === 'confirm') resolve(false);
      else if (options.kind === 'prompt' || options.kind === 'form') resolve(null);
      else resolve(undefined);
      return;
    }
    enqueueDialog({ ...options, resolve });
  });
}

function normalizeOpts(input, defaults) {
  if (typeof input === 'string') return { ...defaults, message: input };
  return { ...defaults, ...input };
}

/** @param {string | { title?: string, message: string, tone?: DialogTone, confirmLabel?: string }} input */
export function appAlert(input) {
  return enqueue(
    normalizeOpts(input, {
      kind: 'alert',
      title: 'Notice',
      tone: 'info',
      confirmLabel: 'OK',
    })
  );
}

/** @param {string | { title?: string, message: string, tone?: DialogTone, confirmLabel?: string, cancelLabel?: string }} input */
export function appConfirm(input) {
  return enqueue(
    normalizeOpts(input, {
      kind: 'confirm',
      title: 'Confirm',
      tone: 'danger',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    })
  );
}

/**
 * @param {string | {
 *   title?: string,
 *   message?: string,
 *   defaultValue?: string,
 *   placeholder?: string,
 *   multiline?: boolean,
 *   rows?: number,
 *   inputType?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   readOnly?: boolean,
 * }} input
 */
export function appPrompt(input) {
  return enqueue(
    normalizeOpts(input, {
      kind: 'prompt',
      title: 'Input required',
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
      defaultValue: '',
      multiline: false,
      rows: 4,
      inputType: 'text',
      readOnly: false,
    })
  );
}

/**
 * Multi-field dialog. Resolves to values object or null on cancel.
 * fields: [{
 *   name, label,
 *   type?: 'text'|'date'|'number'|'select'|'checklist',
 *   required?,
 *   options?: string[] | { value, label, amount? }[],
 *   defaultValue?, placeholder?
 * }]
 * checklist defaultValue / resolved value is an array of selected option values.
 */
export function appForm(input = {}) {
  const opts = typeof input === 'string' ? { message: input } : input;
  const fields = Array.isArray(opts.fields) ? opts.fields : [];
  const defaults = {};
  for (const f of fields) {
    if (f.type === 'checklist') {
      defaults[f.name] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : [];
    } else {
      defaults[f.name] = f.defaultValue ?? '';
    }
  }
  const hasChecklist = fields.some((f) => f.type === 'checklist');
  return enqueue({
    kind: 'form',
    title: opts.title || 'Form',
    message: opts.message || '',
    tone: opts.tone || 'info',
    confirmLabel: opts.confirmLabel || 'Submit',
    cancelLabel: opts.cancelLabel || 'Cancel',
    fields,
    defaultValues: defaults,
    wide: Boolean(opts.wide || hasChecklist),
  });
}
