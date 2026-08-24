import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appAlert } from '../components/dialog';
import { useInvoiceUploadQueue } from '../invoices/InvoiceUploadQueueContext';

export default function GIRNInvoiceUpload({ disabled = false, reviewReturnPath = '' }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const { jobs, enqueueUpload, dismissJob } = useInvoiceUploadQueue();
  const [pendingJobId, setPendingJobId] = useState(null);
  const [fileName, setFileName] = useState('');

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
        title: 'Extraction failed',
        message: job.error || 'Unable to extract invoice',
        tone: 'danger',
      });
      dismissJob(job.id);
    }
  }, [jobs, pendingJobId, navigate, dismissJob]);

  function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setFileName(file.name);
    const job = enqueueUpload({
      file,
      source: 'girn',
      returnPath: reviewReturnPath || '/girn/create',
    });
    if (job?.id) setPendingJobId(job.id);
  }

  const pendingJob = pendingJobId ? jobs.find((j) => j.id === pendingJobId) : null;
  const busy = Boolean(pendingJob && ['queued', 'uploading'].includes(pendingJob.status));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        type="button"
        className="neutral-button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Starting upload…' : 'Upload scanned invoice'}
      </button>
      {fileName && busy ? <p className="muted">{fileName}</p> : null}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Upload runs in the background. You can leave this page — a status bar will keep you updated.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled || busy}
      />
    </div>
  );
}
