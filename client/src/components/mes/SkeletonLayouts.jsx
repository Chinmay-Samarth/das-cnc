import { Skeleton, SkeletonCircle, SkeletonText } from './Skeleton';

function SkeletonPageHeader({ withActions = true }) {
  return (
    <header className="mes-page-header skeleton-page-header">
      <div className="mes-page-header-text">
        <Skeleton height={12} width={72} className="skeleton-eyebrow" />
        <Skeleton height={28} width="42%" className="skeleton-title" />
        <Skeleton height={14} width="28%" />
      </div>
      {withActions ? (
        <div className="mes-page-actions skeleton-page-actions">
          <Skeleton height={36} width={108} radius={10} />
          <Skeleton height={36} width={96} radius={10} />
        </div>
      ) : null}
    </header>
  );
}

function SkeletonTableRows({ rows = 7, cols = 5 }) {
  const columnCount = Math.max(2, Number(cols) || 5);
  const gridStyle = {
    gridTemplateColumns: `1.4fr repeat(${columnCount - 1}, minmax(0, 1fr))`,
  };
  return (
    <div className="skeleton-table" role="presentation">
      <div className="skeleton-table-head" style={gridStyle}>
        {Array.from({ length: columnCount }, (_, i) => (
          <Skeleton key={`h-${i}`} height={12} width={i === 0 ? '40%' : '70%'} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={`r-${row}`} className="skeleton-table-row" style={gridStyle}>
          {Array.from({ length: columnCount }, (_, col) => (
            <Skeleton
              key={`c-${row}-${col}`}
              height={14}
              width={col === 0 ? '55%' : `${58 + ((row + col) % 3) * 12}%`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** List / table pages — header, filters, rows. */
export function SkeletonList({
  rows = 7,
  cols = 5,
  showHeader = true,
  showFilters = true,
  embedded = false,
  className = '',
}) {
  const body = (
    <>
      {showFilters ? (
        <div className="skeleton-filters">
          <Skeleton height={38} width="min(220px, 40%)" radius={10} />
          <Skeleton height={38} width={120} radius={10} />
          <Skeleton height={38} width={100} radius={10} />
        </div>
      ) : null}
      <SkeletonTableRows rows={rows} cols={cols} />
    </>
  );

  if (embedded) {
    return (
      <div className={`skeleton-layout skeleton-list fade-up${className ? ` ${className}` : ''}`}>
        {body}
      </div>
    );
  }

  return (
    <div className={`skeleton-layout skeleton-list fade-up${className ? ` ${className}` : ''}`}>
      {showHeader ? <SkeletonPageHeader /> : null}
      <section className="mes-card list-page-card skeleton-card">{body}</section>
    </div>
  );
}

/** Detail pages — title, metrics, two-column fields. */
export function SkeletonDetail({
  showHeader = true,
  showMetrics = true,
  showTabs = true,
  className = '',
}) {
  return (
    <div className={`skeleton-layout skeleton-detail fade-up${className ? ` ${className}` : ''}`}>
      {showHeader ? <SkeletonPageHeader /> : null}
      {showTabs ? (
        <div className="skeleton-tabs">
          <Skeleton height={32} width={88} radius={999} />
          <Skeleton height={32} width={96} radius={999} />
          <Skeleton height={32} width={80} radius={999} />
        </div>
      ) : null}
      {showMetrics ? (
        <div className="skeleton-metrics">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton-metric-card">
              <Skeleton height={12} width="45%" />
              <Skeleton height={24} width="70%" />
              <Skeleton height={10} width="35%" />
            </div>
          ))}
        </div>
      ) : null}
      <section className="mes-card skeleton-card skeleton-detail-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton-field">
            <Skeleton height={10} width="38%" />
            <Skeleton height={16} width="82%" />
          </div>
        ))}
      </section>
    </div>
  );
}

/** Form / create-edit pages. */
export function SkeletonForm({
  showHeader = true,
  fields = 6,
  embedded = false,
  className = '',
}) {
  const body = (
    <>
      <div className="skeleton-form-fields">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="skeleton-form-field">
            <Skeleton height={11} width="32%" />
            <Skeleton height={40} width="100%" radius={10} />
          </div>
        ))}
      </div>
      <div className="skeleton-form-actions">
        <Skeleton height={40} width={96} radius={10} />
        <Skeleton height={40} width={120} radius={10} />
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className={`skeleton-layout skeleton-form fade-up${className ? ` ${className}` : ''}`}>
        {body}
      </div>
    );
  }

  return (
    <div className={`skeleton-layout skeleton-form fade-up${className ? ` ${className}` : ''}`}>
      {showHeader ? <SkeletonPageHeader withActions={false} /> : null}
      <section className="mes-card form-page-card skeleton-card">{body}</section>
    </div>
  );
}

/** Factory dashboard — KPI strip + widget cards. */
export function SkeletonDashboard({ showHeader = true, className = '' }) {
  return (
    <div className={`skeleton-layout skeleton-dashboard fade-up${className ? ` ${className}` : ''}`}>
      {showHeader ? <SkeletonPageHeader /> : null}
      <div className="skeleton-kpi-strip">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton-kpi">
            <Skeleton height={11} width="50%" />
            <Skeleton height={26} width="62%" />
          </div>
        ))}
      </div>
      <div className="skeleton-dash-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-widget">
            <div className="skeleton-widget-head">
              <Skeleton height={14} width="40%" />
              <Skeleton height={12} width={48} />
            </div>
            <Skeleton height={120} width="100%" radius={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Auth / role-gate loading. */
export function SkeletonAuth({ className = '' }) {
  return (
    <main className={`mes-shell mes-loading-shell${className ? ` ${className}` : ''}`}>
      <div className="skeleton-auth-card fade-up" role="status" aria-label="Loading">
        <SkeletonCircle size={48} />
        <Skeleton height={20} width="55%" />
        <SkeletonText lines={2} lastWidth="70%" />
        <div className="skeleton-auth-bar">
          <Skeleton height={8} width="100%" radius={999} />
        </div>
      </div>
    </main>
  );
}

/**
 * Invoice OCR review / edit — form column + tall PDF/media pane.
 * PDF sits on the left to match the live recheck layout.
 */
export function SkeletonInvoiceReview({
  showHeader = true,
  className = '',
  statusLabel = '',
}) {
  return (
    <div
      className={`skeleton-layout skeleton-invoice-review fade-up${className ? ` ${className}` : ''}`}
    >
      {showHeader ? <SkeletonPageHeader /> : null}
      {statusLabel ? (
        <div className="skeleton-review-status" role="status" aria-live="polite">
          <Skeleton height={12} width={12} circle />
          <span>{statusLabel}</span>
        </div>
      ) : null}
      <div className="skeleton-review-split skeleton-review-split-pdf-left">
        <section className="mes-card skeleton-card skeleton-review-media">
          <Skeleton height={16} width="45%" />
          <Skeleton height="100%" width="100%" radius={12} className="skeleton-review-media-frame" />
        </section>
        <section className="mes-card skeleton-card skeleton-review-form">
          <div className="skeleton-metrics skeleton-metrics-compact">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton-metric-card">
                <Skeleton height={10} width="50%" />
                <Skeleton height={20} width="65%" />
              </div>
            ))}
          </div>
          <div className="skeleton-form-fields">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton-form-field">
                <Skeleton height={11} width="28%" />
                <Skeleton height={38} width="100%" radius={10} />
              </div>
            ))}
          </div>
          <SkeletonTableRows rows={4} cols={4} />
        </section>
      </div>
    </div>
  );
}

/**
 * Saved invoice details — summary + line cards on the left, PDF on the right.
 */
export function SkeletonInvoiceDetails({ className = '' }) {
  return (
    <div
      className={`skeleton-layout skeleton-invoice-details fade-up${className ? ` ${className}` : ''}`}
    >
      <header className="skeleton-invoice-details-header">
        <div className="skeleton-invoice-details-title">
          <Skeleton height={28} width="38%" />
          <Skeleton height={22} width={72} radius={999} />
        </div>
        <div className="skeleton-page-actions">
          <Skeleton height={36} width={120} radius={10} />
          <Skeleton height={36} width={96} radius={10} />
          <Skeleton height={36} width={88} radius={10} />
        </div>
      </header>
      <div className="skeleton-review-split">
        <div className="skeleton-invoice-details-main">
          <section className="mes-card skeleton-card">
            <Skeleton height={14} width="30%" />
            <div className="skeleton-detail-grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton-field">
                  <Skeleton height={10} width="40%" />
                  <Skeleton height={16} width="78%" />
                </div>
              ))}
            </div>
          </section>
          <section className="mes-card skeleton-card">
            <Skeleton height={14} width="28%" />
            <SkeletonTableRows rows={4} cols={4} />
          </section>
          <section className="mes-card skeleton-card">
            <Skeleton height={14} width="24%" />
            <div className="skeleton-metrics skeleton-metrics-compact">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton-metric-card">
                  <Skeleton height={10} width="45%" />
                  <Skeleton height={18} width="60%" />
                </div>
              ))}
            </div>
          </section>
        </div>
        <section className="mes-card skeleton-card skeleton-review-media">
          <Skeleton height={16} width="40%" />
          <Skeleton height="100%" width="100%" radius={12} className="skeleton-review-media-frame" />
        </section>
      </div>
    </div>
  );
}
