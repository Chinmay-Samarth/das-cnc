import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react';
import { ProgressBar } from '../components/mes';
import {
  INVOICE_UPLOAD_STAGES,
  isInvoiceUploadBusy,
  useInvoiceUploadQueue,
} from './InvoiceUploadQueueContext';

function isOnJobEditPath(pathname, search, job) {
  if (!job?.invoiceId) return false;
  if (!pathname.startsWith(`/invoices/${job.invoiceId}/review`)) return false;
  if (job.source === 'girn') {
    const params = new URLSearchParams(search);
    return params.get('context') === 'girn';
  }
  return true;
}

function JobStatusCard({ job, variant = 'floating', queueIndex, queueTotal, onOpen, onDismiss }) {
  const stage = INVOICE_UPLOAD_STAGES[job.status] || INVOICE_UPLOAD_STAGES.extracting;
  const busy = isInvoiceUploadBusy(job.status);
  const failed = job.status === 'error';
  const ready = job.status === 'needs_review' || job.status === 'done';
  const clickable = Boolean(onOpen && (job.editPath || ready || failed));
  const positionLabel =
    job.status === 'queued' && queueTotal > 1 && queueIndex != null
      ? `Queued · #${queueIndex} of ${queueTotal}`
      : job.label || stage.label;

  return (
    <div
      className={`invoice-upload-status invoice-upload-status--${variant}${failed ? ' is-error' : ''}${ready ? ' is-ready' : ''}${clickable ? ' is-clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => {
        if (clickable) onOpen?.(job);
      }}
      onKeyDown={(event) => {
        if (clickable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen?.(job);
        }
      }}
    >
      <div className="invoice-upload-status-top">
        <div className="invoice-upload-status-title">
          <FileText size={16} />
          <div>
            <strong>{job.fileName}</strong>
            <span className="muted">{positionLabel}</span>
          </div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="invoice-upload-status-dismiss"
            aria-label="Dismiss"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss(job.id);
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <ProgressBar value={job.pct ?? stage.pct} max={100} showLabel={false} />

      {failed && job.error ? <p className="invoice-upload-status-error">{job.error}</p> : null}
      {clickable && variant === 'floating' ? (
        <p className="invoice-upload-status-hint">
          {busy
            ? 'Click to return to edit window'
            : job.status === 'needs_review'
              ? 'Click to open review'
              : 'Click to open'}
        </p>
      ) : null}
      {busy && variant === 'inline' ? (
        <p className="invoice-upload-status-hint muted">
          You can leave this page — processing continues in the background.
        </p>
      ) : null}
    </div>
  );
}

/** Inline progress for the review / edit window. */
export function InvoiceUploadInlineStatus({ invoiceId }) {
  const { getJobByInvoiceId, dismissJob } = useInvoiceUploadQueue();
  const job = getJobByInvoiceId(invoiceId);

  if (!job || (!isInvoiceUploadBusy(job.status) && job.status !== 'error')) {
    return null;
  }

  return (
    <JobStatusCard
      job={job}
      variant="inline"
      onDismiss={job.status === 'error' ? dismissJob : undefined}
    />
  );
}

/** Right-edge collapsible OCR queue dock. */
export default function InvoiceUploadQueueStatus() {
  const navigate = useNavigate();
  const location = useLocation();
  const { jobs, dismissJob, queueSummary } = useInvoiceUploadQueue();
  const [expanded, setExpanded] = useState(false);

  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => !isOnJobEditPath(location.pathname, location.search, job)),
    [jobs, location.pathname, location.search]
  );

  const queuedOnly = useMemo(
    () => visibleJobs.filter((job) => job.status === 'queued'),
    [visibleJobs]
  );

  if (!visibleJobs.length) return null;

  function openJob(job) {
    if (job.editPath) {
      navigate(job.editPath);
      if (job.status === 'done' || job.status === 'error') {
        dismissJob(job.id);
      }
      return;
    }

    if (job.source === 'girn') {
      navigate(job.returnPath || '/girn/create');
    } else {
      navigate('/invoices');
    }
    if (job.status === 'done' || job.status === 'error') {
      dismissJob(job.id);
    }
  }

  const summaryParts = [];
  if (queueSummary.busy) summaryParts.push(`${queueSummary.busy} processing`);
  if (queueSummary.queued) summaryParts.push(`${queueSummary.queued} waiting`);
  if (queueSummary.ready) summaryParts.push(`${queueSummary.ready} ready`);
  if (queueSummary.failed) summaryParts.push(`${queueSummary.failed} failed`);

  const hasReady = visibleJobs.some(
    (job) => job.status === 'needs_review' || job.status === 'done'
  );
  const hasError = visibleJobs.some((job) => job.status === 'error');
  const tabTone = hasError ? 'is-error' : hasReady ? 'is-ready' : 'is-busy';

  return (
    <div
      className={`invoice-upload-queue-dock${expanded ? ' is-expanded' : ' is-collapsed'}`}
      aria-live="polite"
    >
      <button
        type="button"
        className={`invoice-upload-queue-tab ${tabTone}`}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse OCR queue' : 'Expand OCR queue'}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="invoice-upload-queue-tab-icon">
          {expanded ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </span>
        <span className="invoice-upload-queue-tab-label">OCR</span>
        <span className="invoice-upload-queue-tab-count">{visibleJobs.length}</span>
      </button>

      <div className="invoice-upload-queue-panel">
        <div className="invoice-upload-queue-summary">
          <div>
            <strong>OCR queue · {visibleJobs.length}</strong>
            <span className="muted">
              {summaryParts.join(' · ') || 'Working…'} · one at a time
            </span>
          </div>
          <button
            type="button"
            className="invoice-upload-status-dismiss"
            aria-label="Collapse queue"
            onClick={() => setExpanded(false)}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="invoice-upload-queue-list">
          {visibleJobs.map((job) => {
            const queueIndex =
              job.status === 'queued'
                ? queuedOnly.findIndex((item) => item.id === job.id) + 1
                : null;
            return (
              <JobStatusCard
                key={job.id}
                job={job}
                variant="floating"
                queueIndex={queueIndex || undefined}
                queueTotal={queuedOnly.length || undefined}
                onOpen={openJob}
                onDismiss={
                  job.status === 'done' || job.status === 'error' || job.status === 'needs_review'
                    ? dismissJob
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
