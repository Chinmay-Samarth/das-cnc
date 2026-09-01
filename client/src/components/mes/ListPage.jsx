import PageHeader from './PageHeader';
import AlertBanner from './AlertBanner';

export default function ListPage({
  eyebrow,
  title,
  subtitle,
  actions,
  error,
  filters,
  children,
}) {
  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        actions={actions}
      />
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      <section className="mes-card list-page-card">
        {filters ? <div className="list-page-filters">{filters}</div> : null}
        {children}
      </section>
    </main>
  );
}
