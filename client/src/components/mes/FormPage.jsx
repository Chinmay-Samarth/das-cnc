import PageHeader from './PageHeader';
import AlertBanner from './AlertBanner';
import { SkeletonForm } from './SkeletonLayouts';

export default function FormPage({
  eyebrow,
  title,
  subtitle,
  error,
  children,
  wide = false,
  loading = false,
}) {
  return (
    <main className={`mes-shell form-page${wide ? ' form-page-wide' : ''}`}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
      />
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      <section className="mes-card form-page-card">
        {loading ? <SkeletonForm embedded showHeader={false} /> : children}
      </section>
    </main>
  );
}

export function FormActions({ saving, onCancel, saveLabel, cancelLabel = 'Cancel' }) {
  return (
    <div className="form-page-actions">
      {onCancel ? (
        <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </button>
      ) : null}
      <button type="submit" className="primary-button" disabled={saving}>
        {saveLabel}
      </button>
    </div>
  );
}
