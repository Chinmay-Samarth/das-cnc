import { pdf } from '@react-pdf/renderer';
import api from '../api/client';
import SalesInvoicePdfDocument from './SalesInvoicePdfDocument';

function pdfFileName(invoice) {
  return (invoice?.invoice_number || `draft-${invoice?.id || 'invoice'}`).replace(
    /[/\\]/g,
    '-'
  );
}

async function storeSalesInvoicePdf(invoice, blob, fileName) {
  if (!invoice?.id) return invoice;
  const form = new FormData();
  form.append('pdf', blob, `${fileName}.pdf`);
  const { data } = await api.post(`/sales-invoices/${invoice.id}/pdf`, form);
  return data?.sales_invoice || invoice;
}

async function generateInvoicePdf(invoice) {
  const blob = await pdf(<SalesInvoicePdfDocument invoice={invoice} />).toBlob();
  const name = pdfFileName(invoice);
  let stored = invoice;
  try {
    stored = await storeSalesInvoicePdf(invoice, blob, name);
  } catch (err) {
    console.error('Failed to store sales invoice PDF', err);
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

export async function printSalesInvoicePdf(invoice) {
  const { blob, stored } = await generateInvoicePdf(invoice);
  await openPrintDialog(blob);
  return stored;
}

export async function downloadSalesInvoicePdf(invoice) {
  const { blob, stored } = await generateInvoicePdf(invoice);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pdfFileName(invoice)}.pdf`;
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
