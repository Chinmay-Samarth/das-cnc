import { useRef, useState } from 'react';
import api from '../../api/client';

export default function AddInvoiceButton({ onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleClick = () => inputRef.current?.click();

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('invoice', file);

    try {
      setUploading(true);
      const {data} = await api.post('/invoices/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (onUploaded) onUploaded();
      console.log(data.doc)
    } catch (err) {
      console.error('Upload failed', err);
      alert(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button type="button" className="primary-button" onClick={handleClick} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Add Invoice'}
      </button>
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
