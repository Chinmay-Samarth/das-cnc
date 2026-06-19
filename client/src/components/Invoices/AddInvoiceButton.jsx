import { useRef, useState } from 'react';
import api from '../../api/client';

const POLL_INTERVAL = 3000;
const MAX_POLLS = 40;

const STAGES = {
  idle: {pct:0, label:"Idle"},
  uploading: {pct:15, label: "Uploading.."},
  extracting: { pct: 55, label: 'Extracting data…' },
  saving:     { pct: 90, label: 'Saving…' },
  pending:    { pct: 100, label: 'Done ✓' },
  done:       { pct: 100, label: 'Done ✓' },
  error:      { pct: 100, label: 'Failed' },
}

export default function AddInvoiceButton({ onUploaded }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const handleClick = () => inputRef.current?.click();

  const pollInvoice = async (invoiceId) => {
    for (let i=0; i<MAX_POLLS; i++){
      await new Promise(r => setTimeout(r,POLL_INTERVAL))
      const {data} = await api.get(`/invoices/${invoiceId}`)
      const invoice = data.invoice;
      const nextStatus = invoice?.status ?? 'extracting';
      setStatus(nextStatus);
      if (nextStatus !== 'extracting' && nextStatus !== "saving") return invoice;
    }
    throw new Error('Processing timeout. Check back shortly.')
  }

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('invoice', file);

    try {
      setStatus('uploading');
      const {data} = await api.post('/invoices/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const invoiceId = data.id
      if(!invoiceId) throw new Error ('No invoice id returned from upload');

      setStatus(data.status ?? 'extracting')
      const finalInvoice = await pollInvoice(invoiceId);
      
      if(!finalInvoice){
        throw new Error('Invoice processing response unavailable')
      }

      if(finalInvoice.status === "error"){
        throw new Error('OCR Processing failed')
      }

      setStatus('done')
      if(onUploaded) await onUploaded(finalInvoice)
    } catch (err) {
      console.error('Upload failed', err);
      alert(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      e.target.value = '';
      setTimeout(() => setStatus('idle'), 1500); // reset button after brief feedback
    }
  };

  const isBusy = status ==='idle';
  const current = STAGES[status]

  return (
    <div style={{ display: 'inline-block', minWidth: isBusy ? 220 : 'auto' }}>
      {isBusy && (
        <button type="button" className="primary-button" onClick={handleClick} disabled={status ==='processing' || status==="uploading"}>
        Add Invoice
        </button>
      )}

      {!isBusy && (
        <div style={styles.progressWrap}>
          <div style={styles.progressLabel}>
            <span>{current.label}</span>
            <span>{current.pct}%</span>
          </div>
          <div style={styles.track}>
            <div
              style={{
                ...styles.fill,
                width: `${current.pct}%`,
                background: status === 'error' ? '#dc2626' : '#1d4ed8',
              }}
            />
          </div>
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

const styles = {
  progressWrap: { width: 220 },
  progressLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  track: {
    width: '100%',
    height: 6,
    borderRadius: 99,
    background: '#e5e7eb',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 99,
    transition: 'width 0.4s ease',
  },
};
