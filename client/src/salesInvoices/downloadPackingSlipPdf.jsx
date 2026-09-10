import { pdf } from '@react-pdf/renderer';
import PackingSlipPdfDocument from './PackingSlipPdfDocument';
import { downloadBlob, openPrintDialog } from '../utils/downloadPdf';

function slipFileName(invoice) {
  const base = (invoice?.invoice_number || `draft-${invoice?.id || 'slip'}`).replace(
    /[/\\]/g,
    '-'
  );
  return `packing-slip-${base}`;
}

export async function printPackingSlipPdf(invoice) {
  const blob = await pdf(<PackingSlipPdfDocument invoice={invoice} />).toBlob();
  await openPrintDialog(blob);
  return invoice;
}

export async function downloadPackingSlipPdf(invoice) {
  const blob = await pdf(<PackingSlipPdfDocument invoice={invoice} />).toBlob();
  downloadBlob(blob, `${slipFileName(invoice)}.pdf`);
  return invoice;
}
