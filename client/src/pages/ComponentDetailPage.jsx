import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import ComponentDrawer from '../components/ComponentMaster/Drawer';
import { getStandard } from '../components/ComponentMaster/utils';

function DetailField({ label, value }) {
  return (
    <div className="component-detail-field">
      <p className="component-detail-label">{label}</p>
      <p className="component-detail-value">{value || '—'}</p>
    </div>
  );
}

export default function ComponentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [component, setComponent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadComponent = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get(`/components/${id}`);
      setComponent(data.component || null);
    } catch (err) {
      console.error('Failed to load component:', err);
      setError(err.response?.data?.error || 'Unable to load component details.');
      setComponent(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadComponent();
  }, [loadComponent]);

  const handleSaved = () => {
    setDrawerOpen(false);
    loadComponent();
  };

  const standard = component ? getStandard(component) : null;
  const commercials = component?.commercials || [];
  const drawings = component?.drawings || [];
  const photos = component?.photos || [];
  const categories = component?.categories || [];

  return (
    <main className="app-shell components-page component-detail-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Inventory management</p>
          <h1>{component?.name || 'Component details'}</h1>
          <p className="muted">
            {component?.code ? `Code: ${component.code}` : 'View all component information.'}
          </p>
        </div>
      </header>

      <section className="card form-card">
        <div className="component-detail-actions">
          <button type="button" className="secondary-button" onClick={() => navigate('/components')}>
            Back to list
          </button>
          {component ? (
            <button type="button" className="primary-button" onClick={() => setDrawerOpen(true)}>
              Edit component
            </button>
          ) : null}
        </div>

        {loading ? <p className="muted">Loading component...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}

        {!loading && !error && component ? (
          <div className="component-detail-sections">
            <section className="component-detail-section">
              <h2>Info</h2>
              <div className="component-detail-grid">
                <DetailField label="Name" value={component.name} />
                <DetailField label="Code" value={component.code} />
                <DetailField label="Size" value={component.size} />
                <DetailField label="Used for" value={component.used_for} />
              </div>
              <DetailField label="Specification" value={component.specification} />
            </section>

            <section className="component-detail-section">
              <h2>Commercials</h2>
              {commercials.length === 0 ? (
                <p className="muted">No commercial records.</p>
              ) : (
                <div className="components-table-wrap">
                  <table className="components-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Rate</th>
                        <th>MOQ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commercials.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name || '—'}</td>
                          <td>{item.rate ?? '—'}</td>
                          <td>{item.moq ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="component-detail-section">
              <h2>Standard</h2>
              {standard ? (
                <div className="component-detail-grid">
                  <DetailField label="Minimum quantity" value={standard.minimum_quantity} />
                  <DetailField label="Maximum quantity" value={standard.maximum_quantity} />
                  <DetailField label="Location" value={standard.location} />
                </div>
              ) : (
                <p className="muted">No standard record.</p>
              )}
            </section>

            <section className="component-detail-section">
              <h2>Drawings</h2>
              {drawings.length === 0 ? (
                <p className="muted">No drawings.</p>
              ) : (
                <div className="component-detail-stack">
                  {drawings.map((item) => (
                    <div key={item.id} className="component-detail-card">
                      <DetailField label="Name" value={item.name} />
                      <DetailField label="Customer specification" value={item.customer_specification} />
                      {item.file_url ? (
                        <div className="component-detail-field">
                          <p className="component-detail-label">File</p>
                          <a href={item.file_url} target="_blank" rel="noreferrer">
                            {item.file_name || 'View drawing'}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="component-detail-section">
              <h2>Photos</h2>
              {photos.length === 0 ? (
                <p className="muted">No photos.</p>
              ) : (
                <div className="component-photo-grid">
                  {photos.map((item) => (
                    <div key={item.id} className="component-photo-card">
                      {item.file_url ? (
                        <img
                          src={item.file_url}
                          alt={item.name || 'Component photo'}
                          className="component-photo-preview"
                        />
                      ) : (
                        <p className="muted">No image</p>
                      )}
                      <p className="component-detail-value">{item.name || '—'}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="component-detail-section">
              <h2>Categories</h2>
              {categories.length === 0 ? (
                <p className="muted">No categories.</p>
              ) : (
                <div className="component-detail-stack">
                  {categories.map((item) => (
                    <div key={item.id} className="component-detail-card component-detail-category">
                      <DetailField label="Key" value={item.key} />
                      <DetailField label="Type" value={item.value_type} />
                      {item.value_type === 'image' ? (
                        item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.key || 'Category image'}
                            className="category-thumb"
                          />
                        ) : (
                          <p className="muted">No image</p>
                        )
                      ) : (
                        <DetailField label="Value" value={item.value} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>

      {drawerOpen && component ? (
        <ComponentDrawer
          componentId={component.id}
          onClose={() => setDrawerOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}
