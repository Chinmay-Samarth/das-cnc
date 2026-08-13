import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../../api/client';
import { appAlert } from '../../components/dialog';
import { ProgressBar } from '../../components/mes';

const POLL_INTERVAL = 3000;
const MAX_POLLS = 40;

const STAGES = {
  idle: { pct: 0, label: 'Idle' },
  uploading: { pct: 15, label: 'Uploading…' },
  extracting: { pct: 55, label: 'Extracting data…' },
  saving: { pct: 90, label: 'Saving…' },
  pending: { pct: 100, label: 'Done' },
  done: { pct: 100, label: 'Done' },
  error: { pct: 100, label: 'Failed' },
};

export default function AddInvoiceButton({ onUploaded }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const handleClick = () => inputRef.current?.click();

  const pollInvoice = async (invoiceId) => {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      const { data } = await api.get(`/invoices/${invoiceId}`);
      const invoice = data.invoice;
      const nextStatus = invoice?.status ?? 'extracting';
      setStatus(nextStatus);
      if (nextStatus !== 'extracting' && nextStatus !== 'saving') return invoice;
    }
    throw new Error('Processing timeout. Check back shortly.');
  };

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('invoice', file);

    try {
      setStatus('uploading');
      const { data } = await api.post('/invoices/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const invoiceId = data.id;
      if (!invoiceId) throw new Error('No invoice id returned from upload');

      setStatus(data.status ?? 'extracting');
      const finalInvoice = await pollInvoice(invoiceId);

      if (!finalInvoice) {
        throw new Error('Invoice processing response unavailable');
      }

      if (finalInvoice.status === 'error') {
        throw new Error('OCR Processing failed');
      }

      setStatus('done');
      if (onUploaded) await onUploaded(finalInvoice);
    } catch (err) {
      console.error('Upload failed', err);
      setStatus('error');
      await appAlert({
        title: 'Upload failed',
        message: err.response?.data?.error || err.message || 'Upload failed',
        tone: 'danger',
      });
    } finally {
      e.target.value = '';
      setTimeout(() => setStatus('idle'), 1500);
    }
  };

  const isIdle = status === 'idle';
  const current = STAGES[status] || STAGES.idle;

  return (
    <div style={{ display: 'inline-block', minWidth: isIdle ? 'auto' : 200 }}>
      {isIdle ? (
        <button type="button" className="mes-btn mes-btn-primary" onClick={handleClick}>
          <Plus size={15} />
          Add invoice
        </button>
      ) : (
        <div style={{ minWidth: 200 }}>
          <p className="muted" style={{ margin: '0 0 4px', fontSize: 12 }}>
            {current.label}
          </p>
          <ProgressBar value={current.pct} max={100} showLabel={false} />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
}
