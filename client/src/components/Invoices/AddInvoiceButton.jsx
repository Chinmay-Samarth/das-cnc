import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { appAlert } from '../../components/dialog';
import { useInvoiceUploadQueue } from '../../invoices/InvoiceUploadQueueContext';

export default function AddInvoiceButton({ onUploaded }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const { jobs, enqueueUpload, enqueueUploads, dismissJob } = useInvoiceUploadQueue();
  const [pendingJobId, setPendingJobId] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const notifiedDoneRef = useRef(new Set());

  useEffect(() => {
    if (!pendingJobId || bulkMode) return;
    const job = jobs.find((j) => j.id === pendingJobId);
    if (!job) {
      setPendingJobId(null);
      return;
    }

    if (job.editPath) {
      setPendingJobId(null);
      navigate(job.editPath);
      return;
    }

    if (job.status === 'error') {
      setPendingJobId(null);
      appAlert({
        title: 'Upload failed',
        message: job.error || 'Upload failed',
        tone: 'danger',
      });
      dismissJob(job.id);
    }
  }, [jobs, pendingJobId, bulkMode, navigate, dismissJob]);

  // Refresh invoice list when a background job finishes (auto-accept or ready)
  useEffect(() => {
    if (!onUploaded) return;
    jobs.forEach((job) => {
      if (job.source !== 'invoices') return;
      if (job.status !== 'done' && job.status !== 'needs_review') return;
      if (!job.result?.invoice && !job.invoiceId) return;
      if (notifiedDoneRef.current.has(job.id)) return;
      notifiedDoneRef.current.add(job.id);
      onUploaded(job.result?.invoice || { id: job.invoiceId });
    });
  }, [jobs, onUploaded]);

  const handleChange = (e) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (!selected.length) return;

    if (selected.length === 1) {
      setBulkMode(false);
      const job = enqueueUpload({
        file: selected[0],
        source: 'invoices',
        returnPath: '/invoices',
      });
      if (job?.id) setPendingJobId(job.id);
      return;
    }

    setBulkMode(true);
    setPendingJobId(null);
    enqueueUploads({
      files: selected,
      source: 'invoices',
      returnPath: '/invoices',
    });
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button type="button" className="mes-btn mes-btn-primary" onClick={() => inputRef.current?.click()}>
        <Plus size={15} />
        Add invoices
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.jfif,.png,.gif,.webp,.bmp,.tif,.tiff,.pdf,image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
}
