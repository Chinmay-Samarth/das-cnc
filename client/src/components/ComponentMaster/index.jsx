import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import ComponentDrawer from './Drawer';

export default function ComponentMaster() {
  const navigate = useNavigate();
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadComponents = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/components');
      setComponents(data.components || []);
    } catch (err) {
      console.error('Failed to load components:', err);
      setError(err.response?.data?.error || 'Unable to load components.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get('/components');
        if (!mounted) return;
        setComponents(data.components || []);
      } catch (err) {
        console.error('Failed to load components:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load components.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredComponents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return components;

    return components.filter((component) => {
      return [component.name, component.code]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [components, search]);

  const openCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
  };

  const handleSaved = (savedId) => {
    closeDrawer();
    loadComponents();
    if (savedId) {
      navigate(`/components/${savedId}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      setDeleteError('');
      await api.delete(`/components/${deleteTarget.id}`);
      setDeleteTarget(null);
      await loadComponents();
    } catch (err) {
      console.error('Failed to delete component:', err);
      setDeleteError(err.response?.data?.error || 'Unable to delete component.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="app-shell components-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Inventory management</p>
          <h1>Component Master</h1>
          <p className="muted">Manage components, specifications, and related records.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-header components-header">
          <div>
            <h2>Component list</h2>
            <p className="muted">Search by name or code, then open a row to view full details.</p>
          </div>

          <div className="components-actions">
            <input
              type="search"
              placeholder="Search components..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search components"
            />
            <button type="button" className="primary-button" onClick={openCreate}>
              New component
            </button>
          </div>
        </div>

        {error ? <p className="error-message">{error}</p> : null}
        {loading ? <p className="muted">Loading components...</p> : null}

        <div className="components-table-wrap">
          <table className="components-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Size</th>
                <th>Used for</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredComponents.map((component) => (
                <tr
                  key={component.id}
                  className="components-row"
                  onClick={() => navigate(`/components/${component.id}`)}
                >
                  <td>{component.code}</td>
                  <td>{component.name}</td>
                  <td>{component.size || '—'}</td>
                  <td>{component.used_for || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteError('');
                        setDeleteTarget(component);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filteredComponents.length === 0 ? (
                <tr>
                  <td colSpan="5" className="muted">
                    {components.length === 0
                      ? 'No components yet. Create your first component to get started.'
                      : 'No matching components found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? (
        <ComponentDrawer
          componentId={editingId}
          onClose={closeDrawer}
          onSaved={handleSaved}
        />
      ) : null}

      {deleteTarget ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-component-title">
            <h2 id="delete-component-title">Delete component</h2>
            <p className="muted">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong> ({deleteTarget.code})?
              This action cannot be undone.
            </p>
            {deleteError ? <p className="error-message">{deleteError}</p> : null}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
