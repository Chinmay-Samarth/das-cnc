// =============================================================================
// MasterPage.jsx
// Shell page for any master — list, view, create, edit all in one.
//
// Panel states:
//   null              → list only
//   { mode: 'view', id }  → MasterDetail slide-over
//   { mode: 'edit', id }  → MasterForm slide-over (edit)
//   { mode: 'create' }    → MasterForm slide-over (new)
//
// Usage (React Router):
//   <Route path="/masters/:slug" element={<MasterPage />} />
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import MasterForm   from './MasterForm'
import MasterDetail from './MasterDetaisPage'
import api from '../api/client'
import { useNavigate } from 'react-router-dom'

const sortBy = (rows, key, asc) => {
  if (!key) return rows

  return [...rows].sort((a, b) => {
    const left = String(a.values?.[key] ?? '').toLowerCase()
    const right = String(b.values?.[key] ?? '').toLowerCase()

    if (left === right) return 0

    return asc
      ? left < right ? -1 : 1
      : left > right ? -1 : 1
  })
}

export default function MasterPage() {
  const { slug } = useParams()

  const [master,   setMaster]   = useState(null)
  const [records,  setRecords]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [panel,    setPanel]    = useState(null)   // null | { mode, id? }
  const [deleting, setDeleting] = useState(null)
  const [columns, setColumns] = useState([])

    
  const LIMIT = 20

  const navigate = useNavigate()
  // ── Load master meta ───────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/masters').then(res => {
      const m = res.data.find(m => m.slug === slug)
      setMaster(m || null)
    })
  }, [slug])

  // ── Load records ───────────────────────────────────────────────────────────
  const loadRecords = useCallback(() => {
    setLoading(true)
    api.get(`/masters/${slug}/record`, {

    }).then(res => {
      setRecords(res.data.records || [])
      setColumns(res.data.columns || [])
      setTotal(res.data.total || 0)
    }).finally(() => setLoading(false))
  }, [slug, page, search])

  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => { setPage(1) },   [search, slug])

  const filteredRecords = useMemo(()=>{
    const query = search.trim().toLowerCase()
    const matches = records.filter((record)=>{
      if(!query) return true;
      return Object.values(record.values || {}).join(' ').toLowerCase().includes(query)
    })

    return sortBy(matches, sortKey, sortAsc)
  }, [records, search, sortKey, sortAsc])

  

  const handleSort = (key) => {
    if (sortKey === key){
      setSortAsc((current) => !current)
    }
    else{
      setSortKey(key)
      setSortAsc(true)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id, e) {
    e.stopPropagation()
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    setDeleting(id)
    try {
      await api.delete(`/masters/${slug}/records/${id}`)
      if (panel?.id === id) setPanel(null)
      loadRecords()
    } finally {
      setDeleting(null)
    }
  }

  // ── After save ─────────────────────────────────────────────────────────────
  function handleSave(savedId) {
    loadRecords()
    // After creating/editing, go to the detail view
    if (savedId) setPanel({ mode: 'view', id: savedId })
    else         setPanel(null)
  }

  const totalPages = Math.ceil(total / LIMIT)
  const panelOpen  = Boolean(panel)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="app-shell">
      <style>{MP_STYLES}</style>
      

      {/* Page header */}
      <header className="app-header">
        <div className="header-title-block">
          <i className={`ti ${master?.icon || 'ti-database'}`} aria-hidden="true" />
          <h1>{master?.name || '…'}</h1>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div className="">
            <h2>{master?.name} List</h2>
            <p className="muted">Use the search field to filter.</p>
          </div>

          <div className="employees-action">
            <input
              type="search"
              placeholder="Search records…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="search-input"
              />
            <div className="add-record-div">
              <button
                className="primary-button "
                onClick={() => setPanel({ mode: 'create' })}
              >
                <i className="ti ti-plus" />
                New {master?.slug}
              </button>
              <button
                className="secondary-button "
                onClick={() => navigate(`/masters/config/${master?.id}`)}
              >
                <i className="ti ti-plus" />
                Configure {master?.slug}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading {master?.slug}</p>
        ) : (
          <div className="employees-table-wrap">
            <table className="employees-table">
              <thead>
                <tr>
                  {columns.map((c)=>(
                    <th key={c.id}
                    onClick={()=> handleSort(`${c.id}`)}>{c.label}
                    <span className="sort-indicator">{sortKey === `${c.id}` ? (sortAsc ? ' ▲' : ' ▼') : ''}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                  {filteredRecords.map((r)=>(
                    <tr
                    key={r.id}
                    role='button'
                    tabIndex={0}
                    onClick={()=> navigate(`/masters/${slug}/records/${r.id}`)}
                    onKeyDown={(event)=>{
                      if(event.key === "Enter" || event.key === " "){
                        navigate(`/masters/${slug}/records/${r.id}`)
                      }
                    }}
                    style={{ cursor: 'pointer' }}>
                      {columns.map((c)=>(
                        <td>{r.values[c.id]}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>



      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mp-pagination">
          <button
            className="mp-page-btn"
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            <i className="ti ti-chevron-left" />
          </button>
          <span className="mp-page-info">Page {page} of {totalPages}</span>
          <button
            className="mp-page-btn"
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            <i className="ti ti-chevron-right" />
          </button>
        </div>
      )}

      {/* Slide-over panel */}
      {panelOpen && (
        <>
          <div
            className="mp-overlay"
            onClick={() => setPanel(null)}
            aria-hidden="true"
          />
          <div className="mp-panel" role="dialog" aria-modal="true">
            <div className="mp-panel-inner">

              {panel.mode === 'view' && (
                <MasterDetail
                  slug={slug}
                  recordId={panel.id}
                  onEdit={() => setPanel({ mode: 'edit', id: panel.id })}
                  onBack={() => setPanel(null)}
                />
              )}

              {panel.mode === 'edit' && (
                <MasterForm
                  slug={slug}
                  recordId={panel.id}
                  onSave={() => { loadRecords(); setPanel({ mode: 'view', id: panel.id }) }}
                  onCancel={() => setPanel({ mode: 'view', id: panel.id })}
                />
              )}

              {panel.mode === 'create' && (
                <MasterForm
                  slug={slug}
                  onSave={() => { loadRecords(); setPanel(null) }}
                  onCancel={() => setPanel(null)}
                />
              )}

            </div>
          </div>
        </>
      )}
    </main>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MP_STYLES = `
.mp-root {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  font-family: inherit;
  color: var(--color-text-primary, #111);
  position: relative;
}

/* Header */
.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.mp-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mp-title i { font-size: 22px; color: var(--color-text-secondary, #555); }
.mp-title h1 { font-size: 20px; font-weight: 600; margin: 0; }
.mp-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-background-secondary, #f0f0f0);
  border-radius: 11px;
  color: var(--color-text-secondary, #666);
}
.mp-header-actions { display: flex; align-items: center; gap: 10px; }

/* Search */
.mp-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid var(--color-border-secondary, #ddd);
  border-radius: 7px;
  background: var(--color-background-primary, #fff);
}
.mp-search-wrap i { color: var(--color-text-tertiary, #aaa); font-size: 15px; }
.mp-search {
  border: none;
  outline: none;
  font-size: 13px;
  width: 200px;
  background: transparent;
  color: var(--color-text-primary, #111);
  font-family: inherit;
}

/* Buttons */
.mp-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.15s;
}
.mp-btn-primary:hover { background: #1d4ed8; }

/* Table */
.mp-table-wrap {
  border: 1px solid var(--color-border-tertiary, #e8e8e8);
  border-radius: 10px;
  overflow: hidden;
  min-height: 120px;
}
.mp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mp-table thead th {
  padding: 10px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #666);
  background: var(--color-background-secondary, #f7f7f7);
  border-bottom: 1px solid var(--color-border-tertiary, #e8e8e8);
}
.mp-row {
  cursor: pointer;
  transition: background 0.1s;
}
.mp-row td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-tertiary, #f0f0f0);
  vertical-align: middle;
}
.mp-row:last-child td { border-bottom: none; }
.mp-row:hover td { background: var(--color-background-secondary, #fafafa); }
.mp-row-active td { background: #eff6ff !important; }
.mp-row-label {
  font-size: 13px;
  font-weight: 500;
  color: #2563eb;
}
.mp-muted { color: var(--color-text-secondary, #888); font-size: 12px; }
.mp-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.mp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--color-text-secondary, #666);
  cursor: pointer;
  font-size: 15px;
  transition: background 0.1s, color 0.1s;
}
.mp-icon-btn:hover { background: var(--color-background-secondary, #f0f0f0); }
.mp-icon-btn.mp-danger:hover { background: #fef2f2; color: #c0392b; }
.mp-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* State box (loading / empty) */
.mp-state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--color-text-secondary, #888);
  font-size: 14px;
  text-align: center;
}
.mp-state-box p { margin: 0; }

/* Pagination */
.mp-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}
.mp-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-secondary, #ddd);
  border-radius: 6px;
  background: var(--color-background-primary, #fff);
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary, #555);
  transition: background 0.1s;
}
.mp-page-btn:hover:not(:disabled) { background: var(--color-background-secondary, #f0f0f0); }
.mp-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mp-page-info { font-size: 13px; color: var(--color-text-secondary, #666); }

/* Slide-over */
.mp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.30);
  z-index: 200;
  animation: mp-fade-in 0.15s ease;
}
.mp-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(760px, 96vw);
  background: var(--color-background-primary, #fff);
  z-index: 201;
  box-shadow: -6px 0 32px rgba(0,0,0,0.10);
  overflow-y: auto;
  animation: mp-slide-in 0.2s ease;
}
.mp-panel-inner { padding: 28px; }

@keyframes mp-fade-in  { from { opacity: 0 } to { opacity: 1 } }
@keyframes mp-slide-in { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes mp-spin     { to { transform: rotate(360deg) } }
.mp-spin { display: inline-block; animation: mp-spin 0.8s linear infinite; }

@media (max-width: 640px) {
  .mp-root { padding: 16px; }
  .mp-header { flex-direction: column; align-items: flex-start; }
  .mp-search { width: 140px; }
  .mp-panel { width: 100vw; }
}
`