import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import api from '../api/client';

const InvoiceUploadQueueContext = createContext(null);

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // ~6 minutes — custom OCR can take 60–90s+ (cold start longer)

export const INVOICE_UPLOAD_STAGES = {
  queued: { pct: 5, label: 'Queued…' },
  uploading: { pct: 15, label: 'Uploading…' },
  extracting: { pct: 55, label: 'Extracting data…' },
  saving: { pct: 90, label: 'Saving…' },
  needs_review: { pct: 100, label: 'Ready for review' },
  done: { pct: 100, label: 'Complete' },
  error: { pct: 100, label: 'Failed' },
};

function buildEditPath({ invoiceId, source, returnPath }) {
  if (!invoiceId) return null;
  const params = new URLSearchParams();
  if (source === 'girn') {
    params.set('context', 'girn');
    params.set('return', returnPath || '/girn/create');
  }
  const qs = params.toString();
  return qs ? `/invoices/${invoiceId}/review?${qs}` : `/invoices/${invoiceId}/review`;
}

function createJobId() {
  return `inv-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function InvoiceUploadQueueProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  const processingRef = useRef(false);
  const pollTimersRef = useRef(new Map());

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    return () => {
      pollTimersRef.current.forEach((timer) => clearTimeout(timer));
      pollTimersRef.current.clear();
    };
  }, []);

  const patchJob = useCallback((jobId, patch) => {
    setJobs((prev) => {
      const next = prev.map((job) =>
        job.id === jobId ? { ...job, ...patch, updatedAt: Date.now() } : job
      );
      jobsRef.current = next;
      return next;
    });
  }, []);

  const dismissJob = useCallback((jobId) => {
    const timer = pollTimersRef.current.get(jobId);
    if (timer) {
      clearTimeout(timer);
      pollTimersRef.current.delete(jobId);
    }
    setJobs((prev) => {
      const target = prev.find((job) => job.id === jobId);
      if (target?.previewUrl) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          /* ignore */
        }
      }
      return prev.filter((job) => job.id !== jobId);
    });
  }, []);

  const pollUntilReady = useCallback(
    async (jobId, invoiceId) => {
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, POLL_INTERVAL_MS);
          pollTimersRef.current.set(jobId, timer);
        });
        pollTimersRef.current.delete(jobId);

        // Job may have been dismissed
        if (!jobsRef.current.some((j) => j.id === jobId)) return null;

        const { data } = await api.get(`/invoices/${invoiceId}`);
        const invoice = data.invoice;
        const nextStatus = invoice?.status ?? 'extracting';

        if (nextStatus === 'extracting' || nextStatus === 'saving') {
          patchJob(jobId, {
            status: nextStatus,
            pct: INVOICE_UPLOAD_STAGES[nextStatus]?.pct ?? 55,
            label: INVOICE_UPLOAD_STAGES[nextStatus]?.label ?? 'Processing…',
          });
          continue;
        }

        const needsReview =
          data.needs_review ||
          nextStatus === 'needs_review' ||
          invoice?.review_status === 'needs_review';

        return {
          invoice: { ...invoice, needs_review: needsReview },
          needs_review: needsReview,
          ocr_confidence_level: data.ocr_confidence_level,
          warning_count: data.warning_count,
        };
      }

      throw new Error('Processing timeout. Check back shortly.');
    },
    [patchJob]
  );

  const runJob = useCallback(
    async (job) => {
      const { id: jobId, file, source, returnPath } = job;
      try {
        patchJob(jobId, {
          status: 'uploading',
          pct: INVOICE_UPLOAD_STAGES.uploading.pct,
          label: INVOICE_UPLOAD_STAGES.uploading.label,
        });

        const form = new FormData();
        form.append('invoice', file);

        const { data } = await api.post('/invoices/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const invoiceId = data.id;
        if (!invoiceId) throw new Error('No invoice id returned from upload');

        const editPath = buildEditPath({ invoiceId, source, returnPath });

        patchJob(jobId, {
          invoiceId,
          editPath,
          status: data.status === 'saving' ? 'saving' : 'extracting',
          pct: INVOICE_UPLOAD_STAGES.extracting.pct,
          label: INVOICE_UPLOAD_STAGES.extracting.label,
        });

        const result = await pollUntilReady(jobId, invoiceId);
        if (!result) return;

        if (result.invoice?.status === 'error') {
          throw new Error('OCR processing failed');
        }

        const finalStatus = result.needs_review ? 'needs_review' : 'done';
        patchJob(jobId, {
          status: finalStatus,
          pct: 100,
          label: INVOICE_UPLOAD_STAGES[finalStatus].label,
          result,
          file: null,
        });
      } catch (err) {
        console.error('Invoice upload queue job failed', err);
        patchJob(jobId, {
          status: 'error',
          pct: 100,
          label: INVOICE_UPLOAD_STAGES.error.label,
          error: err.response?.data?.error || err.message || 'Upload failed',
          file: null,
        });
      }
    },
    [patchJob, pollUntilReady]
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      let next = jobsRef.current.find((j) => j.status === 'queued');
      while (next) {
        await runJob(next);
        next = jobsRef.current.find((j) => j.status === 'queued');
      }
    } finally {
      processingRef.current = false;
    }
  }, [runJob]);

  useEffect(() => {
    if (jobs.some((j) => j.status === 'queued')) {
      processQueue();
    }
  }, [jobs, processQueue]);

  const enqueueUpload = useCallback(
    ({ file, source = 'invoices', returnPath = '' }) => {
      if (!file) return null;

      const jobId = createJobId();
      let previewUrl = null;
      try {
        previewUrl = URL.createObjectURL(file);
      } catch {
        previewUrl = null;
      }

      const job = {
        id: jobId,
        invoiceId: null,
        fileName: file.name || 'Invoice',
        file,
        previewUrl,
        source,
        returnPath: returnPath || (source === 'girn' ? '/girn/create' : '/invoices'),
        editPath: null,
        status: 'queued',
        pct: INVOICE_UPLOAD_STAGES.queued.pct,
        label: INVOICE_UPLOAD_STAGES.queued.label,
        error: '',
        result: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setJobs((prev) => [...prev, job]);
      return job;
    },
    []
  );

  const getJobByInvoiceId = useCallback(
    (invoiceId) => jobs.find((j) => String(j.invoiceId) === String(invoiceId)) || null,
    [jobs]
  );

  const activeJobs = useMemo(
    () =>
      jobs.filter((j) =>
        ['queued', 'uploading', 'extracting', 'saving', 'needs_review', 'done', 'error'].includes(
          j.status
        )
      ),
    [jobs]
  );

  const value = useMemo(
    () => ({
      jobs: activeJobs,
      enqueueUpload,
      dismissJob,
      getJobByInvoiceId,
      patchJob,
    }),
    [activeJobs, enqueueUpload, dismissJob, getJobByInvoiceId, patchJob]
  );

  return (
    <InvoiceUploadQueueContext.Provider value={value}>
      {children}
    </InvoiceUploadQueueContext.Provider>
  );
}

export function useInvoiceUploadQueue() {
  const ctx = useContext(InvoiceUploadQueueContext);
  if (!ctx) {
    throw new Error('useInvoiceUploadQueue must be used within InvoiceUploadQueueProvider');
  }
  return ctx;
}

export function isInvoiceUploadBusy(status) {
  return ['queued', 'uploading', 'extracting', 'saving'].includes(status);
}
