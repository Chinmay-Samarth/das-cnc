import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { appAlert } from '../../components/dialog';
import { useInvoiceUploadQueue } from '../../invoices/InvoiceUploadQueueContext';

export default function AddInvoiceButton({ onUploaded }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const { jobs, enqueueUpload, dismissJob } = useInvoiceUploadQueue();
  const [pendingJobId, setPendingJobId] = useState(null);
  const notifiedDoneRef = useRef(new Set());

  useEffect(() => {
    if (!pendingJobId) return;
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
  }, [jobs, pendingJobId, navigate, dismissJob]);

  // Refresh invoice list when a background job auto-accepts
  useEffect(() => {
    if (!onUploaded) return;
    jobs.forEach((job) => {
      if (job.source !== 'invoices' || job.status !== 'done' || !job.result?.invoice) return;
      if (notifiedDoneRef.current.has(job.id)) return;
      notifiedDoneRef.current.add(job.id);
      onUploaded(job.result.invoice);
    });
  }, [jobs, onUploaded]);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const job = enqueueUpload({ file, source: 'invoices', returnPath: '/invoices' });
    if (job?.id) setPendingJobId(job.id);
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button type="button" className="mes-btn mes-btn-primary" onClick={() => inputRef.current?.click()}>
        <Plus size={15} />
        Add invoice
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
