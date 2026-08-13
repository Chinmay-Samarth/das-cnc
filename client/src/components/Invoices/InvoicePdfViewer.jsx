import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Printer,
  Share2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { appPrompt } from '../dialog';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function InvoicePdfViewer({
  file,
  title = 'Invoice',
  emptyTitle = 'No PDF yet',
  emptyDescription = 'Generate the invoice PDF to preview it here.',
  emptyActionLabel,
  onEmptyAction,
  loading: externalLoading = false,
}) {
  const pdfPanelRef = useRef(null);
  const pdfScrollRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [pdfWidth, setPdfWidth] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const onDocLoad = useCallback(({ numPages: next }) => {
    setNumPages(next);
    setPageNumber(1);
  }, []);

  const pdfContainerRef = useCallback((node) => {
    pdfScrollRef.current = node;
    if (node) setPdfWidth(Math.max(240, node.getBoundingClientRect().width - 48));
  }, []);

  const startDrag = useCallback((clientX, clientY) => {
    dragRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    setIsDragging(true);
  }, []);

  const moveDrag = useCallback((clientX, clientY) => {
    if (!dragRef.current.active) return;
    setPan({
      x: dragRef.current.panX + (clientX - dragRef.current.startX),
      y: dragRef.current.panY + (clientY - dragRef.current.startY),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [scale, pageNumber, file]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === pdfPanelRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!isDragging) return undefined;
    const onMouseMove = (e) => moveDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, moveDrag, endDrag]);

  const printPdf = (url) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
    iframe.src = url;
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) document.body.removeChild(iframe);
      if (url.startsWith('blob:') && url !== file) URL.revokeObjectURL(url);
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(file, '_blank');
          setActionMessage('Opened PDF in a new tab — use Ctrl+P to print');
        }
        setTimeout(cleanup, 1000);
      }, 300);
    };

    iframe.onerror = () => {
      cleanup();
      window.open(file, '_blank');
      setActionMessage('Opened PDF in a new tab — use Ctrl+P to print');
    };
  };

  const handlePrint = async () => {
    if (!file) return;
    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      printPdf(URL.createObjectURL(blob));
    } catch {
      printPdf(file);
    }
  };

  const handleShare = async () => {
    if (!file || String(file).startsWith('blob:')) {
      setActionMessage('Download the PDF to share a stored copy');
      return;
    }
    const shareData = { title, text: title, url: file };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(file);
      setActionMessage('Link copied to clipboard');
    } catch {
      await appPrompt({
        title: 'Copy invoice link',
        message: 'Select and copy the link below.',
        defaultValue: file,
        readOnly: true,
        confirmLabel: 'Close',
      });
    }
  };

  const handleFullscreen = async () => {
    const panel = pdfPanelRef.current;
    if (!panel) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch (err) {
      console.error('Fullscreen failed', err);
      setActionMessage('Fullscreen is not supported in this browser');
    }
  };

  const showEmpty = !file && !externalLoading;

  return (
    <div ref={pdfPanelRef} className="invoice-pdf-panel">
      <div className="invoice-pdf-toolbar">
        <div className="invoice-pdf-toolbar-group">
          <button
            type="button"
            className="invoice-pdf-icon-btn"
            onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}
            aria-label="Zoom out"
            disabled={!file}
          >
            <ZoomOut size={15} />
          </button>
          <span className="invoice-pdf-toolbar-label">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="invoice-pdf-icon-btn"
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.25).toFixed(2)))}
            aria-label="Zoom in"
            disabled={!file}
          >
            <ZoomIn size={15} />
          </button>
        </div>
        <div className="invoice-pdf-toolbar-group">
          <button
            type="button"
            className="invoice-pdf-icon-btn"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={!file || pageNumber <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="invoice-pdf-toolbar-label">
            Page {pageNumber} of {numPages ?? '…'}
          </span>
          <button
            type="button"
            className="invoice-pdf-icon-btn"
            onClick={() => setPageNumber((p) => Math.min(numPages || 1, p + 1))}
            disabled={!file || !numPages || pageNumber >= numPages}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div
        ref={pdfContainerRef}
        className="invoice-pdf-area"
        style={{ cursor: file ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={(e) => {
          if (!file || e.button !== 0 || e.target.closest('button')) return;
          e.preventDefault();
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (!file || e.target.closest('button')) return;
          const touch = e.touches[0];
          if (!touch) return;
          startDrag(touch.clientX, touch.clientY);
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (!touch) return;
          e.preventDefault();
          moveDrag(touch.clientX, touch.clientY);
        }}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
      >
        {showEmpty ? (
          <div className="invoice-pdf-empty">
            <p className="invoice-pdf-empty-title">{emptyTitle}</p>
            <p className="invoice-pdf-empty-desc">{emptyDescription}</p>
            {emptyActionLabel && onEmptyAction ? (
              <button type="button" className="mes-btn mes-btn-primary" onClick={onEmptyAction}>
                {emptyActionLabel}
              </button>
            ) : null}
          </div>
        ) : externalLoading || !file ? (
          <div className="invoice-pdf-placeholder">Loading PDF…</div>
        ) : (
          <div
            className="invoice-pdf-canvas"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            <Document
              file={file}
              onLoadSuccess={onDocLoad}
              loading={<div className="invoice-pdf-placeholder">Loading…</div>}
              error={<div className="invoice-pdf-placeholder">Failed to load PDF.</div>}
            >
              {pdfWidth ? (
                <Page
                  pageNumber={pageNumber}
                  width={pdfWidth * scale}
                  renderTextLayer
                  renderAnnotationLayer
                />
              ) : null}
            </Document>
          </div>
        )}

        {actionMessage ? (
          <div className="invoice-pdf-toast" role="status">
            {actionMessage}
          </div>
        ) : null}

        {file ? (
          <div className="invoice-pdf-floating">
            <button type="button" className="invoice-pdf-floating-btn" onClick={handlePrint} aria-label="Print">
              <Printer size={16} />
            </button>
            <button type="button" className="invoice-pdf-floating-btn" onClick={handleShare} aria-label="Share">
              <Share2 size={16} />
            </button>
            <button
              type="button"
              className="invoice-pdf-floating-btn"
              onClick={handleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
