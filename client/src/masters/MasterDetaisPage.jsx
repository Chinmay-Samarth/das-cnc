// =============================================================================
// MasterDetail.jsx
// Read-only view of a single master record.
// Shows all sections as tabs, flat fields in a labelled grid,
// repeatable sections as read-only tables.
// Has an Edit button that swaps to MasterForm.
//
// Usage:
//   <MasterDetail slug="raw-material" recordId={id} onEdit={() => ...} onBack={() => ...} />
// =============================================================================

import { useState, useEffect } from 'react'
import api from '../api/client'
import { formatDisplayDate } from '../utils/dateFormat'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(field, cell) {
  if (!cell) return '—'

  if (field.field_type === 'file') {
    if (!cell.file_url) return '—'
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(cell.file_url)
    return isImage
      ? { type: 'image', url: cell.file_url }
      : { type: 'file', url: cell.file_url, name: 'View file' }
  }

  if (field.field_type === 'multi_file') {
    if (!cell.file_urls?.length) return '—'
    return { type: 'multi_file', files: cell.file_urls }
  }

  if (field.field_type === 'relation') {
    return cell._label || cell.linked_record_id || '—'
  }

  if (field.field_type === 'date' && cell.value) {
    return formatDisplayDate(cell.value)
  }

  return cell.value || '—'
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellValue({ formatted }) {
  if (typeof formatted === 'string' || formatted === '—') {
    return <span className={formatted === '—' ? 'md-empty' : ''}>{formatted}</span>
  }

  if (formatted.type === 'image') {
    return (
      <a href={formatted.url} target="_blank" rel="noreferrer">
        <img src={formatted.url} alt="attachment" className="md-thumb" />
      </a>
    )
  }

  if (formatted.type === 'file') {
    return (
      <a href={formatted.url} target="_blank" rel="noreferrer" className="md-file-link">
        <i className="ti ti-file-download" /> {formatted.name}
      </a>
    )
  }

  if (formatted.type === 'multi_file') {
    return (
      <div className="md-file-list">
        {formatted.files.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noreferrer" className="md-file-link">
            <i className="ti ti-file-download" /> {f.name || `File ${i + 1}`}
          </a>
        ))}
      </div>
    )
  }

  return <span>{String(formatted)}</span>
}

// ─── Flat section ─────────────────────────────────────────────────────────────

function FlatSectionView({ section, flatValues }) {
  const sectionData = flatValues[section.slug] || {}

  return (
    <div className="md-flat-grid">
      {section.fields.map(field => {
        const cell      = sectionData[field.slug]
        const formatted = formatValue(field, cell)
        const isFull    = ['textarea', 'file', 'multi_file'].includes(field.field_type)

        return (
          <div key={field.id} className={`md-field ${isFull ? 'md-full' : ''}`}>
            <div className="md-label">{field.label}</div>
            <div className="md-value">
              <CellValue formatted={formatted} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Repeatable section ───────────────────────────────────────────────────────

function RepeatableSectionView({ section, repeatableValues }) {
  const rows = repeatableValues[section.slug] || []

  if (rows.length === 0) {
    return (
      <div className="md-empty-section">
        <i className="ti ti-table-off" />
        <p>No {section.name.toLowerCase()} added yet.</p>
      </div>
    )
  }

  return (
    <div className="md-repeat-table-wrap">
      <table className="md-repeat-table">
        <thead>
          <tr>
            {section.fields.map(f => (
              <th key={f.id}>{f.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {section.fields.map(field => {
                const cell      = row[field.slug]
                const formatted = formatValue(field, cell)
                return (
                  <td key={field.id}>
                    <CellValue formatted={formatted} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MasterDetail({ slug, recordId, onEdit, onBack }) {
  const [schema,       setSchema]       = useState(null)
  const [flatValues,   setFlatValues]   = useState({})
  const [repValues,    setRepValues]    = useState({})
  const [activeTab,    setActiveTab]    = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  // ── Load schema + record together ──────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      api.get(`/masters/${slug}/schema`),
      api.get(`/masters/${slug}/records/${recordId}`)
    ]).then(([schemaRes, recordRes]) => {
      const { master, sections } = schemaRes.data
      setSchema({ master, sections })

      const { flat, repeatable } = recordRes.data

      // For relation fields, resolve labels via v_master_lookup
      // We'll store everything as-is and resolve labels lazily inline
      // (the API already returns linked_record_id; labels will show as IDs
      //  unless we do a second pass — handled below)
      setFlatValues(flat || {})
      setRepValues(repeatable || {})

      // Resolve relation labels for all relation fields
      resolveRelationLabels(sections, flat || {}, repeatable || {})
    }).catch(err => {
      setError(err?.response?.data?.error || 'Failed to load record.')
    }).finally(() => setLoading(false))
  }, [slug, recordId])

  // Resolve linked_record_id → label for relation fields
  async function resolveRelationLabels(sections, flat, repeatable) {
    const lookupCache = {} // slug → { id → label }

    async function getLabel(relatedSlug, recordId) {
      if (!relatedSlug || !recordId) return null
      if (!lookupCache[relatedSlug]) {
        try {
          const res = await api.get(`/masters/${relatedSlug}/lookup`)
          lookupCache[relatedSlug] = {}
          for (const item of res.data) {
            lookupCache[relatedSlug][item.record_id] = item.label
          }
        } catch { return recordId }
      }
      return lookupCache[relatedSlug]?.[recordId] || recordId
    }

    const updatedFlat = { ...flat }
    const updatedRep  = { ...repeatable }

    for (const section of sections) {
      const relFields = section.fields.filter(f => f.field_type === 'relation')
      if (!relFields.length) continue

      if (!section.is_repeatable) {
        for (const field of relFields) {
          const cell = updatedFlat[section.slug]?.[field.slug]
          if (cell?.linked_record_id) {
            const label = await getLabel(field.related_master_slug, cell.linked_record_id)
            updatedFlat[section.slug][field.slug] = { ...cell, _label: label }
          }
        }
      } else {
        const rows = updatedRep[section.slug] || []
        for (let ri = 0; ri < rows.length; ri++) {
          for (const field of relFields) {
            const cell = rows[ri][field.slug]
            if (cell?.linked_record_id) {
              const label = await getLabel(field.related_master_slug, cell.linked_record_id)
              updatedRep[section.slug][ri][field.slug] = { ...cell, _label: label }
            }
          }
        }
      }
    }

    setFlatValues({ ...updatedFlat })
    setRepValues({ ...updatedRep })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="md-loading">
        <i className="ti ti-loader-2 md-spin" /> Loading record…
      </div>
    )
  }

  if (error) {
    return (
      <div className="md-error">
        <i className="ti ti-alert-circle" /> {error}
      </div>
    )
  }

  if (!schema) return null

  const { master, sections } = schema

  return (
    <div className="md-root">
      <style>{MD_STYLES}</style>

      {/* Header */}
      <div className="md-header">
        <div className="md-header-left">
          {onBack && (
            <button className="md-back-btn" onClick={onBack} type="button">
              <i className="ti ti-arrow-left" />
            </button>
          )}
          <i className={`ti ${master.icon || 'ti-database'} md-master-icon`} aria-hidden="true" />
          <div>
            <div className="md-master-name">{master.name}</div>
            <div className="md-record-id">{recordId.slice(0, 8)}…</div>
          </div>
        </div>
        {onEdit && (
          <button className="md-edit-btn" onClick={onEdit} type="button">
            <i className="ti ti-edit" /> Edit
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="md-tabs" role="tablist">
        {sections.map((section, idx) => (
          <button
            key={section.id}
            role="tab"
            aria-selected={activeTab === idx}
            className={`md-tab ${activeTab === idx ? 'md-tab-active' : ''}`}
            onClick={() => setActiveTab(idx)}
            type="button"
          >
            {section.name}
            {section.is_repeatable && (
              <span className="md-tab-count">
                {(repValues[section.slug] || []).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {sections.map((section, idx) => (
        <div key={section.id} role="tabpanel" hidden={activeTab !== idx}>
          {section.is_repeatable
            ? <RepeatableSectionView section={section} repeatableValues={repValues} />
            : <FlatSectionView section={section} flatValues={flatValues} />
          }
        </div>
      ))}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MD_STYLES = `
.md-root {
  font-family: inherit;
  color: var(--color-text-primary, #111);
  max-width: 960px;
}

/* Header */
.md-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.md-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.md-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-secondary, #ddd);
  border-radius: 7px;
  background: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary, #555);
  transition: background 0.1s;
}
.md-back-btn:hover { background: var(--color-background-secondary, #f0f0f0); }
.md-master-icon {
  font-size: 22px;
  color: var(--color-text-secondary, #555);
}
.md-master-name {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}
.md-record-id {
  font-size: 11px;
  color: var(--color-text-tertiary, #aaa);
  font-family: monospace;
  margin-top: 2px;
}
.md-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 500;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.md-edit-btn:hover { background: #1d4ed8; }

/* Tabs */
.md-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-border-tertiary, #e0e0e0);
  margin-bottom: 24px;
  overflow-x: auto;
  scrollbar-width: none;
}
.md-tabs::-webkit-scrollbar { display: none; }
.md-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary, #666);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.md-tab:hover { color: var(--color-text-primary, #111); }
.md-tab-active {
  color: var(--color-text-primary, #111);
  border-bottom-color: #2563eb;
}
.md-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  background: var(--color-background-secondary, #eee);
  border-radius: 9px;
}
.md-tab-active .md-tab-count {
  background: #dbeafe;
  color: #1d4ed8;
}

/* Flat grid */
.md-flat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--color-border-tertiary, #e8e8e8);
  border-radius: 10px;
  overflow: hidden;
}
.md-field {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-tertiary, #f0f0f0);
  border-right: 1px solid var(--color-border-tertiary, #f0f0f0);
}
.md-field:nth-child(even) { border-right: none; }
.md-field:nth-last-child(-n+2) { border-bottom: none; }
.md-full {
  grid-column: 1 / -1;
  border-right: none;
}
.md-full:last-child { border-bottom: none; }
.md-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #888);
  margin-bottom: 4px;
}
.md-value {
  font-size: 14px;
  color: var(--color-text-primary, #111);
  line-height: 1.5;
  white-space: pre-wrap;
}
.md-empty { color: var(--color-text-tertiary, #bbb); }

/* File/image in detail */
.md-thumb {
  height: 60px;
  border-radius: 5px;
  border: 1px solid var(--color-border-tertiary, #e8e8e8);
  display: block;
  margin-top: 4px;
}
.md-file-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #2563eb;
  text-decoration: none;
}
.md-file-link:hover { text-decoration: underline; }
.md-file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Repeatable read-only table */
.md-repeat-table-wrap {
  border: 1px solid var(--color-border-tertiary, #e8e8e8);
  border-radius: 10px;
  overflow: hidden;
}
.md-repeat-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.md-repeat-table thead th {
  padding: 9px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #666);
  background: var(--color-background-secondary, #f7f7f7);
  border-bottom: 1px solid var(--color-border-tertiary, #e8e8e8);
}
.md-repeat-table tbody td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-tertiary, #f0f0f0);
  vertical-align: middle;
  color: var(--color-text-primary, #111);
}
.md-repeat-table tbody tr:last-child td { border-bottom: none; }
.md-repeat-table tbody tr:hover td {
  background: var(--color-background-secondary, #fafafa);
}

/* Empty section */
.md-empty-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  color: var(--color-text-tertiary, #aaa);
  font-size: 13px;
}
.md-empty-section i { font-size: 32px; opacity: 0.4; }
.md-empty-section p { margin: 0; }

/* Loading / error */
.md-loading, .md-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
}
.md-error { color: #c0392b; }
@keyframes md-spin { to { transform: rotate(360deg); } }
.md-spin { display: inline-block; animation: md-spin 0.8s linear infinite; }

/* Responsive */
@media (max-width: 640px) {
  .md-flat-grid { grid-template-columns: 1fr; }
  .md-full { grid-column: 1; }
  .md-field { border-right: none; }
  .md-field:nth-last-child(-n+2) { border-bottom: 1px solid var(--color-border-tertiary, #f0f0f0); }
  .md-field:last-child { border-bottom: none; }
}
`