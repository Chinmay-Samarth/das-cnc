/** @typedef {'alert' | 'confirm' | 'prompt'} DialogKind */
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
      else if (options.kind === 'prompt') resolve(null);
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
