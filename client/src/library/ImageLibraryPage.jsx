import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search } from 'lucide-react';
import api from '../api/client';
import { EmptyState, PageHeader, StatusBadge } from '../components/mes';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import ImageLightbox from '../components/shared/ImageLightBox';

const KIND_OPTIONS = [
  { value: 'purchase_invoice', label: 'Purchase invoices' },
  { value: 'purchase_order', label: 'Purchase orders' },
  { value: 'sales_invoice', label: 'Sales invoices' },
  { value: 'employee', label: 'Employees' },
  { value: 'master', label: 'Master records' },
];

export default function ImageLibraryPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.get('/image-library', {
          params: { q: trimmed, kind: kind || undefined },
        });
        if (!cancelled) {
          setResults(data.results || []);
          setSearched(true);
        }
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setSearched(true);
          setError(err.response?.data?.error || 'Unable to search images.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind]);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Library"
        title="Images"
        subtitle="Search purchase invoices, purchase orders, sales invoices, employee documents, and master record files."
      />

      <section className="mes-card image-library-panel">
        <label className="image-library-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Invoice number, supplier, customer, employee name or code, master name"
            autoFocus
          />
        </label>

        <div className="mes-filters" style={{ marginBottom: 0 }}>
          <label>
            Type
            <FormSearchSelect
              value={kind}
              onChange={(value) => setKind(value || '')}
              options={KIND_OPTIONS}
              placeholder="All types"
              emptyMessage="No types"
            />
          </label>
        </div>

        {error ? <p className="image-library-error">{error}</p> : null}

        {loading ? <p className="muted">Searching…</p> : null}

        {!loading && !searched ? (
          <EmptyState
            title="Search stored files"
            description="Type at least two characters. Purchase and sales invoices match invoice number, supplier, or customer. Employees match name or employee code."
          />
        ) : null}

        {!loading && searched && results.length === 0 ? (
          <EmptyState title="No files found" description="Try another name, number, or type." />
        ) : null}

        {results.length ? (
          <div className="image-library-grid">
            {results.map((item) => (
              <article key={item.id} className="image-library-card">
                <button
                  type="button"
                  className="image-library-thumb"
                  onClick={() =>
                    item.isImage
                      ? setPreview(item)
                      : window.open(item.url, '_blank', 'noopener,noreferrer')
                  }
                >
                  {item.isImage ? (
                    <img src={item.url} alt={item.title} />
                  ) : (
                    <span className="image-library-file">
                      <FileText size={28} />
                      PDF
                    </span>
                  )}
                </button>
                <div className="image-library-body">
                  <StatusBadge status="draft">{item.kindLabel}</StatusBadge>
                  <h2>{item.title}</h2>
                  {item.subtitle ? <p>{item.subtitle}</p> : null}
                  <Link to={item.path}>Open record</Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {preview ? (
        <ImageLightbox
          src={preview.url}
          alt={preview.title}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </main>
  );
}
