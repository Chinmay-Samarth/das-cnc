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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MasterForm   from './MasterForm'
import MasterDetail from './MasterDetailsPage'
import api from '../api/client'
import { appConfirm } from '../components/dialog'
import { Check, Columns3, Plus, Settings } from 'lucide-react'
import { EmptyState, ListPage } from '../components/mes'
import { getVisiblePages, sortBy } from '../utils/listHelpers'
import { formatDisplayDate } from '../utils/dateFormat'

function columnStorageKey(slug) {
  return `das-cnc-master-columns:${slug}`
}

function defaultColumnIds(available) {
  return available.slice(0, 3).map((column) => column.id)
}

function readSavedColumnIds(slug, available) {
  const known = new Set(available.map((column) => column.id))
  try {
    const raw = JSON.parse(localStorage.getItem(columnStorageKey(slug)) || 'null')
    if (Array.isArray(raw)) {
      const kept = raw.filter((id) => known.has(id))
      if (kept.length) return kept
    }
  } catch {
    /* ignore a bad saved list */
  }
  return defaultColumnIds(available)
}

function displayCell(column, value) {
  if (value == null || value === '') return '—'
  if (column.field_type === 'date') return formatDisplayDate(value)
  return String(value)
}

export default function MasterPage() {
  const { slug } = useParams()

  const [master,   setMaster]   = useState(null)
  const [records,  setRecords]  = useState([])
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [panel,    setPanel]    = useState(null)   // null | { mode, id? }
  const [deleting, setDeleting] = useState(null)
  const [columns, setColumns] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [columnOpen, setColumnOpen] = useState(false)
  const columnRef = useRef(null)

    
  const PAGE_SIZE = 20

  const navigate = useNavigate()
  // ── Load master meta ───────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/masters').then(res => {
      const m = res.data.find(m => m.slug === slug)
      setMaster(m || null)
    })
  }, [slug])

  // ── Load every field so the column picker is not limited to the current table ─
  useEffect(() => {
    let mounted = true
    api.get(`/masters/${slug}/schema`).then((res) => {
      if (!mounted) return
      const sections = res.data?.sections || []
      const catalog = []
      for (const section of sections) {
        for (const field of section.fields || []) {
          if (!field?.id) continue
          catalog.push({
            id: field.id,
            label: field.label,
            field_type: field.field_type,
            section: section.name,
            repeatable: Boolean(section.is_repeatable),
          })
        }
      }
      if (catalog.length) setColumns(catalog)
    }).catch(() => {
      /* the record list still supplies whatever columns it can */
    })
    return () => {
      mounted = false
    }
  }, [slug])

  // ── Load records ───────────────────────────────────────────────────────────
  const loadRecords = useCallback(() => {
    setLoading(true)
    api.get(`/masters/${slug}/record`).then(res => {
      setRecords(res.data.records || [])
      setColumns((current) => (current.length ? current : res.data.columns || []))
    }).finally(() => setLoading(false))
  }, [slug])

  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => { setPage(1) },   [search, slug])
  useEffect(() => { setColumnOpen(false) }, [slug])

  const columnKey = columns.map((column) => column.id).join(',')
  useEffect(() => {
    if (!columnKey) {
      setSelectedIds([])
      return
    }
    setSelectedIds(readSavedColumnIds(slug, columns))
  }, [slug, columnKey, columns])

  const filteredRecords = useMemo(()=>{
    const query = search.trim().toLowerCase()
    const matches = records.filter((record)=>{
      if(!query) return true;
      return Object.values(record.values || {}).join(' ').toLowerCase().includes(query)
    })

    return sortBy(matches, sortKey, sortAsc, (row) => row.values?.[sortKey] ?? '')
  }, [records, search, sortKey, sortAsc])

  const visibleColumns = useMemo(() => {
    const chosen = new Set(selectedIds)
    const shown = columns.filter((column) => chosen.has(column.id))
    return shown.length ? shown : columns.slice(0, 3)
  }, [columns, selectedIds])

  const columnGroups = useMemo(() => {
    const groups = []
    for (const column of columns) {
      const name = column.section || 'Fields'
      let group = groups.find((item) => item.name === name)
      if (!group) {
        group = { name, columns: [] }
        groups.push(group)
      }
      group.columns.push(column)
    }
    return groups
  }, [columns])

  useEffect(() => {
    if (!columnOpen) return undefined
    function onPointerDown(event) {
      if (!columnRef.current?.contains(event.target)) setColumnOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [columnOpen])

  function persistColumns(ids) {
    localStorage.setItem(columnStorageKey(slug), JSON.stringify(ids))
    setSelectedIds(ids)
    setPage(1)
  }

  function toggleColumn(id) {
    const has = selectedIds.includes(id)
    if (has && selectedIds.length === 1) return
    const next = has ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]
    persistColumns(next)
  }

  function resetColumns() {
    persistColumns(defaultColumnIds(columns))
  }

  

  const handleSort = (key) => {
    setPage(1)
    if (sortKey === key){
      setSortAsc((current) => !current)
    }
    else{
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageRecords = filteredRecords.slice(pageStart, pageStart + PAGE_SIZE)
  const visiblePages = getVisiblePages(currentPage, totalPages)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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

  const panelOpen  = Boolean(panel)
  const masterName = master?.name || 'Records'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <ListPage
      eyebrow="Masters"
      title={masterName}
      subtitle="Search and open a record."
      actions={
        master ? (
          <button
            type="button"
            className="mes-btn mes-btn-secondary"
            onClick={() => navigate(`/masters/config/${master.id}`)}
          >
            <Settings size={16} />
            Configure
          </button>
        ) : null
      }
      filters={
        <div className="employees-actions">
          <input
            type="search"
            placeholder="Search records…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            aria-label={`Search ${masterName}`}
          />
          {columns.length > 1 ? (
            <div className="mp-column-picker" ref={columnRef}>
              <button
                type="button"
                className="mes-btn mes-btn-secondary"
                aria-expanded={columnOpen}
                aria-haspopup="dialog"
                onClick={() => setColumnOpen((open) => !open)}
              >
                <Columns3 size={16} />
                Columns
              </button>
              {columnOpen ? (
                <div className="mes-card mp-column-panel" role="dialog" aria-label="Choose table columns">
                  <div className="mp-column-head">
                    <div>
                      <p className="mp-column-title">Columns</p>
                      <p className="muted mp-column-hint">{visibleColumns.length} shown</p>
                    </div>
                    <button type="button" className="mp-column-reset" onClick={resetColumns}>
                      Reset
                    </button>
                  </div>
                  <div className="mp-column-groups">
                    {columnGroups.map((group) => (
                      <section key={group.name}>
                        {columnGroups.length > 1 ? (
                          <p className="mp-column-section">{group.name}</p>
                        ) : null}
                        <div className="mp-column-list">
                          {group.columns.map((column) => {
                            const checked = visibleColumns.some((item) => item.id === column.id)
                            const onlyOne = checked && visibleColumns.length === 1
                            return (
                              <label key={column.id} className={`mp-column-option${checked ? ' is-on' : ''}${onlyOne ? ' is-locked' : ''}`}>
                                <input
                                  type="checkbox"
                                  className="mp-column-input"
                                  checked={checked}
                                  disabled={onlyOne}
                                  onChange={() => toggleColumn(column.id)}
                                />
                                <span className="mp-column-box" aria-hidden="true">
                                  {checked ? <Check size={12} strokeWidth={3} /> : null}
                                </span>
                                <span className="mp-column-name">{column.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="primary-button"
            onClick={() => navigate(`/masters/${slug}/records/new`)}
          >
            <Plus size={16} />
            New {masterName}
          </button>
        </div>
      }
    >
      {loading ? <p className="muted">Loading {masterName}…</p> : null}
      {!loading && filteredRecords.length === 0 ? (
        <EmptyState
          title={`No ${masterName} found`}
          description="Create a record or adjust your search."
        />
      ) : null}
      {!loading && filteredRecords.length > 0 ? (
        <div className="employees-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.id} onClick={() => handleSort(`${c.id}`)}>
                    {c.label}
                    <span className="sort-indicator">
                      {sortKey === `${c.id}` ? (sortAsc ? ' ▲' : ' ▼') : ''}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRecords.map((r) => (
                <tr
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/masters/${slug}/records/${r.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/masters/${slug}/records/${r.id}`)
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {visibleColumns.map((c) => {
                    const value = r.values?.[c.id]
                    return <td key={c.id}>{displayCell(c, value)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && filteredRecords.length > 0 ? (
        <div className="attendance-pagination">
          <span className="attendance-page-summary">
            Showing {pageStart + 1} to {Math.min(pageStart + PAGE_SIZE, filteredRecords.length)} of {filteredRecords.length} records
          </span>
          {totalPages > 1 ? (
            <div className="attendance-page-controls">
              <button
                type="button"
                className="attendance-page-nav"
                disabled={currentPage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              {visiblePages.map((pageNumber, index) => {
                const previousPage = visiblePages[index - 1]
                const needsEllipsis = index > 0 && pageNumber - previousPage > 1
                return (
                  <span key={pageNumber} className="attendance-page-number-wrap">
                    {needsEllipsis ? <span className="attendance-page-ellipsis">...</span> : null}
                    <button
                      type="button"
                      className={`attendance-page-number${currentPage === pageNumber ? ' active' : ''}`}
                      onClick={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  </span>
                )
              })}
              <button
                type="button"
                className="attendance-page-nav"
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </ListPage>

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
    </>
  )
}