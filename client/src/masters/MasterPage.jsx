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
import MasterDetail from './MasterDetailsPage'
import api from '../api/client'
import { appConfirm } from '../components/dialog'
import { useNavigate } from 'react-router-dom'
import {Plus, Settings, } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/mes'
import { sortBy } from '../utils/listHelpers'

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

    return sortBy(matches, sortKey, sortAsc, (row) => row.values?.[sortKey] ?? '')
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
    if (
      !(await appConfirm({
        title: 'Delete record',
        message: 'Delete this record? This cannot be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return
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
    <main className="mes-shell">
      <PageHeader
        title={master?.name || '…'}
        actions={
          <button
            className="neutral-button"
            onClick={() => navigate(`/masters/config/${master?.id}`)}
          >
            <Settings size={16} style={{ display: 'inline', marginRight: 4 }} />
            Configure {master?.slug}
          </button>
        }
      />

      <section className="mes-card list-page-card">
        <div className="section-header employees-header">
          <div>
            <h2>{master?.name} List</h2>
            <p className="muted">Use the search field to filter.</p>
          </div>

          <div className="employees-actions">
            <input
              type="search"
              placeholder="Search records…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
            <button
              className="primary-button"
              onClick={() => navigate(`/masters/${slug}/records/new`)}
            >
              <Plus size={16} style={{ display: 'inline', marginRight: 4 }} />
              New {master?.slug}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading {master?.slug}</p>
        ) : (
          <div className="employees-table-wrap">
            <table className="app-table">
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
                  variant="edit"
                  embedded
                  onSave={() => { loadRecords(); setPanel({ mode: 'view', id: panel.id }) }}
                  onCancel={() => setPanel({ mode: 'view', id: panel.id })}
                />
              )}

            </div>
          </div>
        </>
      )}
    </main>
  )
}