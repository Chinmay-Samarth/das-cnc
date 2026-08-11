import { pdf } from '@react-pdf/renderer';
import SalesInvoicePdfDocument from './SalesInvoicePdfDocument';

export async function downloadSalesInvoicePdf(invoice) {
  const blob = await pdf(<SalesInvoicePdfDocument invoice={invoice} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = (invoice?.invoice_number || `draft-${invoice?.id || 'invoice'}`).replace(
    /[/\\]/g,
    '-'
  );
  a.href = url;
  a.download = `${name}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

export function formatInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
