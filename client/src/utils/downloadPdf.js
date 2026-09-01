export function openPrintDialog(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
    iframe.src = url;
    document.body.appendChild(iframe);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      URL.revokeObjectURL(url);
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.addEventListener?.('afterprint', cleanup, { once: true });
          iframe.contentWindow?.print();
          setTimeout(cleanup, 120000);
          resolve();
        } catch (err) {
          cleanup();
          reject(err);
        }
      }, 250);
    };

    iframe.onerror = () => {
      cleanup();
      reject(new Error('Unable to open print dialog'));
    };
  });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function storePdfBlob({ entityId, blob, fileName, uploadPath }) {
  if (!entityId) return null;
  const form = new FormData();
  form.append('pdf', blob, `${fileName}.pdf`);
  const { data } = await uploadPath(entityId, form);
  return data;
}
