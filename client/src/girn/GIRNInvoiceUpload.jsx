import { useRef, useState } from 'react';
import api from '../api/client';

const STAGES = {
  idle: { pct: 0, label: 'Ready' },
  uploading: { pct: 20, label: 'Uploading invoice...' },
  extracting: { pct: 70, label: 'Extracting invoice data...' },
  done: { pct: 100, label: 'Extraction complete' },
  error: { pct: 100, label: 'Extraction failed' },
};

export default function GIRNInvoiceUpload({ onExtracted, disabled = false }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [fileName, setFileName] = useState('');

  const current = STAGES[status] || STAGES.idle;
  const isIdle = status === 'idle';

  async function handleChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append('invoice', file);

    try {
      setFileName(file.name);
      setStatus('uploading');
      setTimeout(() => setStatus('extracting'), 250);

      const { data } = await api.post('/girn/extract-invoice', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setStatus('done');
      await onExtracted?.(data);
    } catch (err) {
      console.error('GIRN invoice extraction failed:', err);
      setStatus('error');
      alert(err.response?.data?.error || err.message || 'Unable to extract invoice');
    } finally {
      event.target.value = '';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isIdle ? (
        <button
          type="button"
          className="primary-button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Upload scanned invoice
        </button>
      ) : (
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
          {fileName ? <p className="muted" style={{ marginTop: 6 }}>{fileName}</p> : null}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  );
}

const styles = {
  progressWrap: { width: 'min(100%, 360px)' },
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
