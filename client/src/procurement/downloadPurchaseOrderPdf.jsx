import { pdf } from '@react-pdf/renderer';
import api from '../api/client';
import PurchaseOrderPdfDocument from './PurchaseOrderPdfDocument';

function pdfFileName(po) {
  return (po?.po_number || `draft-${po?.id || 'po'}`).replace(/[/\\]/g, '-');
}

async function loadCompany() {
  try {
    const { data } = await api.get('/sales-invoices/company-settings');
    return data?.company_settings || {};
  } catch {
    return {};
  }
}

async function storePurchaseOrderPdf(po, blob, fileName) {
  if (!po?.id) return po;
  const form = new FormData();
  form.append('pdf', blob, `${fileName}.pdf`);
  const { data } = await api.post(`/purchase-orders/${po.id}/pdf`, form);
  return data?.purchase_order || po;
}

async function generatePoPdf(po) {
  const company = po?.company || (await loadCompany());
  const blob = await pdf(<PurchaseOrderPdfDocument po={po} company={company} />).toBlob();
  const name = pdfFileName(po);
  let stored = po;
  try {
    stored = await storePurchaseOrderPdf(po, blob, name);
  } catch (err) {
    console.error('Failed to store purchase order PDF', err);
  }
  return { blob, stored };
}

function openPrintDialog(blob) {
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

export async function printPurchaseOrderPdf(po) {
  const { blob, stored } = await generatePoPdf(po);
  await openPrintDialog(blob);
  return stored;
}

export async function downloadPurchaseOrderPdf(po) {
  const { blob, stored } = await generatePoPdf(po);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pdfFileName(po)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return stored;
}

export function formatInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
