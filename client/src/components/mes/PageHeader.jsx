export default function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="mes-page-header">
      <div className="mes-page-header-text">
        {eyebrow ? <p className="mes-eyebrow">{eyebrow}</p> : null}
        <h1 className="mes-page-title">{title}</h1>
        {subtitle ? <p className="mes-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="mes-page-actions">{actions}</div> : null}
    </header>
  );
}
