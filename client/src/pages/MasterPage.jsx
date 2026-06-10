import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import RecordDrawer from '../components/MasterRecord/RecordDrawer';
import { formatDate } from '../components/MasterBuilder/utils';
import {
  formatPreviewFieldValue,
  loadRelatedRecordNamesBatch,
} from '../components/MasterRecord/displayUtils';

export default function MasterPage() {
  const { masterId } = useParams();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const previewFields = useMemo(() => {
    const fields = master?.master_fields || [];
    return [...fields]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .slice(0, 3);
  }, [master]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [masterRes, recordsRes] = await Promise.all([
        api.get(`/masters/${masterId}`),
        api.get(`/masters/${masterId}/records`),
      ]);

      const masterData = masterRes.data.master;
      setMaster(masterData);

      const baseRecords = recordsRes.data.records || [];
      const fields = [...(masterData.master_fields || [])]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .slice(0, 3);

      if (fields.length === 0 || baseRecords.length === 0) {
        setRecords(baseRecords.map((record) => ({ ...record, fieldValues: {} })));
        return;
      }

      const recordsWithValues = await Promise.all(
        baseRecords.map(async (record) => {
          try {
            const { data } = await api.get(`/masters/${masterId}/records/${record.id}`);
            return {
              ...record,
              record_values: data.record.record_values || [],
            };
          } catch {
            return { ...record, record_values: [] };
          }
        })
      );

      const relatedRecordNames = await loadRelatedRecordNamesBatch(
        masterData,
        recordsWithValues,
        fields
      );

      const enriched = recordsWithValues.map((record) => {
        const fieldValues = {};
        fields.forEach((field) => {
          const valueRow = record.record_values.find((item) => item.field_id === field.id);
          fieldValues[field.id] = formatPreviewFieldValue(field, valueRow, relatedRecordNames);
        });
        return { ...record, fieldValues };
      });

      setRecords(enriched);
    } catch (err) {
      console.error('Failed to load master page:', err);
      setError(err.response?.data?.error || 'Unable to load master.');
    } finally {
      setLoading(false);
    }
  }, [masterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [record.name, record.code].join(' ').toLowerCase().includes(query)
    );
  }, [records, search]);

  function openCreate() {
    setEditingRecordId(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingRecordId(null);
  }

  function handleSaved(savedRecordId) {
    closeDrawer();
    if (savedRecordId) {
      navigate(`/masters/${masterId}/records/${savedRecordId}`);
      return;
    }
    loadData();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleting(true);
      setDeleteError('');
      await api.delete(`/masters/${masterId}/records/${deleteTarget.id}`);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete record:', err);
      setDeleteError(err.response?.data?.error || 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !master) {
    return <main className="app-shell">Loading master…</main>;
  }

  if (error && !master) {
    return (
      <main className="app-shell">
        <p className="error-message">{error}</p>
        <Link to="/home">Back to Home</Link>
      </main>
    );
  }

  return (
    <main className="app-shell masters-page">
      <header className="app-header">
        <div className="header-title-block">
          <h1>
            {master.icon ? `${master.icon} ` : ''}
            {master.name}
          </h1>
          {master.description ? <p className="muted">{master.description}</p> : null}
        </div>
        <div className="masters-page-actions">
          <Link to={`/masters/${masterId}/configure`} className="secondary-button ">
            Configure master
          </Link>
          <button type="button" className="primary-button" onClick={openCreate}>
            + New record
          </button>
        </div>
      </header>

      <section className="card">
        <div className="section-header components-header">
          <div>
            <h2>Records</h2>
            <p className="muted">Search by name or code, then open a row to view full details.</p>
          </div>
          <input
            type="search"
            placeholder="Search records…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="search-input"
            aria-label="Search records"
          />
        </div>

        {error ? <p className="error-message">{error}</p> : null}
        {loading ? <p className="muted">Loading records…</p> : null}

        <div className="components-table-wrap">
          <table className="components-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Created</th>
                {previewFields.map((field) => (
                  <th key={field.id}>{field.label || field.field_key}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr
                  key={record.id}
                  className="components-row"
                  onClick={() => navigate(`/masters/${masterId}/records/${record.id}`)}
                >
                  <td>{record.name}</td>
                  <td>{record.code || '—'}</td>
                  <td>{formatDate(record.created_at)}</td>
                  {previewFields.map((field) => (
                    <td key={field.id}>{record.fieldValues?.[field.id] ?? '—'}</td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteError('');
                        setDeleteTarget(record);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={4 + previewFields.length} className="muted">
                    {records.length === 0
                      ? 'No records yet. Create your first record to get started.'
                      : 'No matching records found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen && master ? (
        <RecordDrawer
          masterId={masterId}
          master={master}
          recordId={editingRecordId}
          onClose={closeDrawer}
          onSaved={handleSaved}
        />
      ) : null}

      {deleteTarget ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-record-title">
            <h2 id="delete-record-title">Delete record</h2>
            <p className="muted">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>
              {deleteTarget.code ? ` (${deleteTarget.code})` : ''}? This action cannot be undone.
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
              <button type="button" className="danger-button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
