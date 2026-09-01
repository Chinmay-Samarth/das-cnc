import { pdf } from '@react-pdf/renderer';
import api from '../api/client';
import PurchaseOrderPdfDocument from './PurchaseOrderPdfDocument';
import { downloadBlob, openPrintDialog } from '../utils/downloadPdf';

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

export async function regeneratePurchaseOrderPdf(po) {
  const company = po?.company || (await loadCompany());
  const blob = await pdf(<PurchaseOrderPdfDocument po={po} company={company} />).toBlob();
  return storePurchaseOrderPdf(po, blob, pdfFileName(po));
}

export async function printPurchaseOrderPdf(po) {
  const { blob, stored } = await generatePoPdf(po);
  await openPrintDialog(blob);
  return stored;
}

export async function downloadPurchaseOrderPdf(po) {
  const { blob, stored } = await generatePoPdf(po);
  downloadBlob(blob, `${pdfFileName(po)}.pdf`);
  return stored;
}

export function formatInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
