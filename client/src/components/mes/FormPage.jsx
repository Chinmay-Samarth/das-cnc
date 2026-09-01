import PageHeader from './PageHeader';
import AlertBanner from './AlertBanner';

export default function FormPage({
  eyebrow,
  title,
  subtitle,
  error,
  children,
  wide = false,
}) {
  return (
    <main className={`mes-shell form-page${wide ? ' form-page-wide' : ''}`}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
      />
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      <section className="mes-card form-page-card">{children}</section>
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
