// =============================================================================
// MasterForm.jsx
// Generic form renderer for all dynamic masters.
// Reads schema from /api/masters/:slug/schema and renders tabs, flat fields,
// and repeatable section tables. Handles all field types including file uploads
// and relation dropdowns.
//
// Usage:
//   <MasterForm slug="raw-material" recordId={id} onSave={handleSave} />
//   recordId = undefined → create mode
//   recordId = uuid      → edit mode
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'   // your existing axios instance

// ─── Constants ───────────────────────────────────────────────────────────────

const FIELD_TYPES_WITH_FULL_WIDTH = ['textarea']

// ─── Utility ─────────────────────────────────────────────────────────────────

function buildEmptyFlat(sections) {
  const flat = {}
  for (const s of sections) {
    if (s.is_repeatable) continue
    flat[s.slug] = {}
    for (const f of s.fields) flat[s.slug][f.slug] = ''
  }
  return flat
}

function buildEmptyRepeatable(sections) {
  const rep = {}
  for (const s of sections) {
    if (!s.is_repeatable) continue
    rep[s.slug] = []
  }
  return rep
}

function buildEmptyRow(fields) {
  const row = {}
  for (const f of fields) row[f.slug] = ''
  return row
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Relation field — searchable dropdown backed by /api/masters/:slug/lookup
function RelationField({ field, value, onChange, disabled }) {
  const [options, setOptions] = useState([])
  const [search, setSearch]   = useState('')
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const wrapRef = useRef(null)

  // Load initial label when editing
  useEffect(() => {
    if (!value) { setSelectedLabel(''); return }
    api.get(`/masters/${field.related_master_slug}/lookup?search=`)
      .then(res => {
        const match = res.data.find(o => o.record_id === value)
        if (match) setSelectedLabel(match.label)
      })
  }, [value, field.related_master_slug])

  // Search on type
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const timer = setTimeout(() => {
      api.get(`/masters/${field.related_master_slug}/lookup?search=${encodeURIComponent(search)}`)
        .then(res => setOptions(res.data))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [search, open, field.related_master_slug])

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        className={`mf-relation-trigger ${disabled ? 'mf-disabled' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
      >
        <span className={selectedLabel ? '' : 'mf-placeholder'}>
          {selectedLabel || `Select ${field.label}…`}
        </span>
        <i className="ti ti-chevron-down" aria-hidden="true" />
      </div>
      {open && (
        <div className="mf-dropdown">
          <div className="mf-dropdown-search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              autoFocus
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="mf-dropdown-list">
            {loading && <div className="mf-dropdown-hint">Loading…</div>}
            {!loading && options.length === 0 && (
              <div className="mf-dropdown-hint">No results</div>
            )}
            {options.map(opt => (
              <div
                key={opt.record_id}
                className={`mf-dropdown-item ${value === opt.record_id ? 'mf-active' : ''}`}
                onClick={() => {
                  onChange(opt.record_id)
                  setSelectedLabel(opt.label)
                  setOpen(false)
                  setSearch('')
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// File field — single file upload with preview/remove
function FileField({ field, value, onChange, disabled, existingUrl }) {
  const inputRef = useRef(null)
  const isImage  = existingUrl && /\.(png|jpg|jpeg|gif|webp)$/i.test(existingUrl)

  return (
    <div className="mf-file-field">
      {existingUrl && (
        <div className="mf-file-existing">
          {isImage
            ? <img src={existingUrl} alt="attachment" className="mf-file-thumb" />
            : <a href={existingUrl} target="_blank" rel="noreferrer" className="mf-file-link">
                <i className="ti ti-file" /> View existing file
              </a>
          }
        </div>
      )}
      <div
        className={`mf-file-drop ${disabled ? 'mf-disabled' : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        {value
          ? <><i className="ti ti-check" /> {value.name}</>
          : <><i className="ti ti-upload" /> {existingUrl ? 'Replace file' : 'Choose file'}</>
        }
      </div>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={e => onChange(e.target.files[0] || null)}
      />
      {value && (
        <button type="button" className="mf-file-clear" onClick={() => onChange(null)}>
          <i className="ti ti-x" /> Remove
        </button>
      )}
    </div>
  )
}

// Multi-file field
function MultiFileField({ field, value = [], onChange, disabled, existingUrls = [] }) {
  const inputRef = useRef(null)

  function addFiles(e) {
    const newFiles = Array.from(e.target.files)
    onChange([...value, ...newFiles])
    e.target.value = ''
  }

  function removeNew(idx) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <div className="mf-multifile-field">
      {existingUrls.map((f, i) => (
        <div key={i} className="mf-multifile-item mf-existing">
          <i className="ti ti-file" />
          <a href={f.url} target="_blank" rel="noreferrer">{f.name || 'File ' + (i + 1)}</a>
          <span className="mf-badge">saved</span>
        </div>
      ))}
      {value.map((f, i) => (
        <div key={i} className="mf-multifile-item">
          <i className="ti ti-file" />
          <span>{f.name}</span>
          <button type="button" className="mf-icon-btn" onClick={() => removeNew(i)}>
            <i className="ti ti-x" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mf-file-drop mf-compact"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <i className="ti ti-plus" /> Add files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={addFiles}
      />
    </div>
  )
}

// Single field renderer — dispatches to the right input type
function FieldInput({ field, value, onChange, disabled, existingFile }) {
  switch (field.field_type) {
    case 'textarea':
      return (
        <textarea
          className="mf-input"
          rows={3}
          placeholder={field.placeholder || ''}
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          className="mf-input"
          placeholder={field.placeholder || ''}
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          className="mf-input"
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      )
    case 'select':
      return (
        <select
          className="mf-input mf-select"
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options || []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    case 'relation':
      return (
        <RelationField
          field={field}
          value={value || ''}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'file':
      return (
        <FileField
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          existingUrl={existingFile?.url || (typeof existingFile === 'string' ? existingFile : null)}
        />
      )
    case 'multi_file':
      return (
        <MultiFileField
          field={field}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          disabled={disabled}
          existingUrls={Array.isArray(existingFile) ? existingFile : []}
        />
      )
    default:
      return (
        <input
          type="text"
          className="mf-input"
          placeholder={field.placeholder || ''}
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      )
  }
}

// Flat section — renders a 2-col grid of labelled fields
function FlatSection({ section, values, onChange, disabled, existingFiles }) {
  return (
    <div className="mf-flat-section">
      {section.fields.map(field => (
        <div
          key={field.id}
          className={`mf-field-wrap ${FIELD_TYPES_WITH_FULL_WIDTH.includes(field.field_type) || field.field_type === 'file' || field.field_type === 'multi_file' ? 'mf-full' : ''}`}
        >
          <label className="mf-label">
            {field.label}
            {field.is_required && <span className="mf-required">*</span>}
          </label>
          <FieldInput
            field={field}
            value={values?.[field.slug]}
            onChange={val => onChange(section.slug, field.slug, val)}
            disabled={disabled}
            existingFile={existingFiles?.[field.slug]}
          />
        </div>
      ))}
    </div>
  )
}

// Repeatable section — renders rows as a table
function RepeatableSection({ section, rows, onRowChange, onAddRow, onRemoveRow, disabled, existingFiles }) {
  return (
    <div className="mf-repeat-section">
      {rows.length > 0 && (
        <div className="mf-repeat-table">
          {/* Header */}
          <div className="mf-repeat-header" style={{ gridTemplateColumns: `${section.fields.map(() => '1fr').join(' ')} 36px` }}>
            {section.fields.map(f => (
              <div key={f.id} className="mf-repeat-th">
                {f.label}
                {f.is_required && <span className="mf-required">*</span>}
              </div>
            ))}
            <div />
          </div>

          {/* Rows */}
          {rows.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="mf-repeat-row"
              style={{ gridTemplateColumns: `${section.fields.map(() => '1fr').join(' ')} 36px` }}
            >
              {section.fields.map(field => (
                <div key={field.id} className="mf-repeat-cell">
                  <FieldInput
                    field={field}
                    value={row[field.slug]}
                    onChange={val => onRowChange(section.slug, rowIdx, field.slug, val)}
                    disabled={disabled}
                    existingFile={existingFiles?.[rowIdx]?.[field.slug]}
                  />
                </div>
              ))}
              <div className="mf-repeat-cell mf-center">
                <button
                  type="button"
                  className="mf-icon-btn mf-danger"
                  disabled={disabled}
                  onClick={() => onRemoveRow(section.slug, rowIdx)}
                  title="Remove row"
                >
                  <i className="ti ti-trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="mf-add-row-btn"
        disabled={disabled}
        onClick={() => onAddRow(section.slug, section.fields)}
      >
        <i className="ti ti-plus" />
        Add {section.name.replace(/s$/, '')}
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MasterForm({ slug, recordId, onSave, onCancel }) {
  const isEdit = Boolean(recordId)

  const [schema,     setSchema]     = useState(null)   // { master, sections }
  const [activeTab,  setActiveTab]  = useState(0)
  const [flat,       setFlat]       = useState({})     // { section_slug: { field_slug: value } }
  const [repeatable, setRepeatable] = useState({})     // { section_slug: [ rowObj ] }
  const [fileMap,    setFileMap]    = useState({})     // { section_slug: { field_slug: File } }
                                                        // or { section_slug: { rowIdx: { field_slug: File } } }
  const [existingFiles, setExistingFiles] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [errors,     setErrors]     = useState({})

  // ── Load schema ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    api.get(`/masters/${slug}/schema`).then(res => {
      const { master, sections } = res.data
      setSchema({ master, sections })
      if (!isEdit) {
        setFlat(buildEmptyFlat(sections))
        setRepeatable(buildEmptyRepeatable(sections))
      }
    }).finally(() => setLoading(false))
  }, [slug])

  // ── Load record for edit ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isEdit || !schema) return
    api.get(`/masters/${slug}/records/${recordId}`).then(res => {
      const { flat: rFlat, repeatable: rRep } = res.data

      // Hydrate flat state
      const flatState = buildEmptyFlat(schema.sections)
      const existingF = {}
      for (const [sSlug, fields] of Object.entries(rFlat || {})) {
        if (!flatState[sSlug]) flatState[sSlug] = {}
        for (const [fSlug, v] of Object.entries(fields)) {
          if (v.file_url) {
            flatState[sSlug][fSlug] = null  // file fields start null (user re-uploads or keeps)
            if (!existingF[sSlug]) existingF[sSlug] = {}
            existingF[sSlug][fSlug] = v.file_url
          } else if (v.file_urls) {
            flatState[sSlug][fSlug] = []
            if (!existingF[sSlug]) existingF[sSlug] = {}
            existingF[sSlug][fSlug] = v.file_urls
          } else if (v.linked_record_id) {
            flatState[sSlug][fSlug] = v.linked_record_id
          } else {
            flatState[sSlug][fSlug] = v.value || ''
          }
        }
      }

      // Hydrate repeatable state
      const repState = buildEmptyRepeatable(schema.sections)
      const existingR = {}
      for (const [sSlug, rows] of Object.entries(rRep || {})) {
        repState[sSlug] = rows.map((row, ri) => {
          const out = {}
          for (const [k, v] of Object.entries(row)) {
            if (k === 'row_id' || k === 'row_order') continue
            if (v?.file_url) {
              out[k] = null
              if (!existingR[sSlug]) existingR[sSlug] = {}
              if (!existingR[sSlug][ri]) existingR[sSlug][ri] = {}
              existingR[sSlug][ri][k] = v.file_url
            } else if (v?.file_urls) {
              out[k] = []
              if (!existingR[sSlug]) existingR[sSlug] = {}
              if (!existingR[sSlug][ri]) existingR[sSlug][ri] = {}
              existingR[sSlug][ri][k] = v.file_urls
            } else if (v?.linked_record_id) {
              out[k] = v.linked_record_id
            } else {
              out[k] = v?.value || ''
            }
          }
          return out
        })
      }

      setFlat(flatState)
      setRepeatable(repState)
      setExistingFiles({ ...existingF, ...existingR })
    })
  }, [isEdit, recordId, schema])

  // ── Field change handlers ───────────────────────────────────────────────────
  const handleFlatChange = useCallback((sectionSlug, fieldSlug, value) => {
    setFlat(prev => ({
      ...prev,
      [sectionSlug]: { ...prev[sectionSlug], [fieldSlug]: value }
    }))
    // if it's a File object, stash in fileMap
    if (value instanceof File || (Array.isArray(value) && value[0] instanceof File)) {
      setFileMap(prev => ({
        ...prev,
        [sectionSlug]: { ...(prev[sectionSlug] || {}), [fieldSlug]: value }
      }))
    }
  }, [])

  const handleRowChange = useCallback((sectionSlug, rowIdx, fieldSlug, value) => {
    setRepeatable(prev => {
      const rows = [...(prev[sectionSlug] || [])]
      rows[rowIdx] = { ...rows[rowIdx], [fieldSlug]: value }
      return { ...prev, [sectionSlug]: rows }
    })
    if (value instanceof File || (Array.isArray(value) && value[0] instanceof File)) {
      setFileMap(prev => {
        const sec = { ...(prev[sectionSlug] || {}) }
        sec[`${rowIdx}__${fieldSlug}`] = value
        return { ...prev, [sectionSlug]: sec }
      })
    }
  }, [])

  const handleAddRow = useCallback((sectionSlug, fields) => {
    setRepeatable(prev => ({
      ...prev,
      [sectionSlug]: [...(prev[sectionSlug] || []), buildEmptyRow(fields)]
    }))
  }, [])

  const handleRemoveRow = useCallback((sectionSlug, rowIdx) => {
    setRepeatable(prev => {
      const rows = [...(prev[sectionSlug] || [])]
      rows.splice(rowIdx, 1)
      return { ...prev, [sectionSlug]: rows }
    })
  }, [])

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate() {
    const errs = {}
    for (const section of schema.sections) {
      if (section.is_repeatable) continue
      for (const field of section.fields) {
        if (!field.is_required) continue
        const val = flat[section.slug]?.[field.slug]
        if (!val || (typeof val === 'string' && !val.trim())) {
          errs[`${section.slug}__${field.slug}`] = `${field.label} is required`
        }
      }
    }
    return errs
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      // jump to first tab with an error
      const errKey = Object.keys(errs)[0]
      const errSectionSlug = errKey.split('__')[0]
      const tabIdx = schema.sections.findIndex(s => s.slug === errSectionSlug)
      if (tabIdx >= 0) setActiveTab(tabIdx)
      return
    }
    setErrors({})
    setSaving(true)

    try {
      // Build FormData — JSON payload + files
      const formData = new FormData()

      // Strip File objects from flat before serialising
      const flatPayload = {}
      for (const [sSlug, fields] of Object.entries(flat)) {
        flatPayload[sSlug] = {}
        for (const [fSlug, val] of Object.entries(fields)) {
          if (val instanceof File || (Array.isArray(val) && val[0] instanceof File)) continue
          flatPayload[sSlug][fSlug] = val
        }
      }

      const repPayload = {}
      for (const [sSlug, rows] of Object.entries(repeatable)) {
        repPayload[sSlug] = rows.map(row => {
          const out = {}
          for (const [k, v] of Object.entries(row)) {
            if (v instanceof File || (Array.isArray(v) && v[0] instanceof File)) continue
            out[k] = v
          }
          return out
        })
      }

      formData.append('data', JSON.stringify({ flat: flatPayload, repeatable: repPayload }))

      // Attach files — flat: file__sectionSlug__fieldSlug
      for (const [sSlug, fields] of Object.entries(fileMap)) {
        for (const [key, fileVal] of Object.entries(fields)) {
          if (key.includes('__')) {
            // repeatable: key = "rowIdx__fieldSlug"
            const [rowIdx, fSlug] = key.split('__')
            if (Array.isArray(fileVal)) {
              fileVal.forEach(f => formData.append(`file__${sSlug}__${rowIdx}__${fSlug}`, f))
            } else if (fileVal) {
              formData.append(`file__${sSlug}__${rowIdx}__${key.split('__')[1]}`, fileVal)
            }
          } else {
            // flat
            if (Array.isArray(fileVal)) {
              fileVal.forEach(f => formData.append(`file__${sSlug}__${key}`, f))
            } else if (fileVal) {
              formData.append(`file__${sSlug}__${key}`, fileVal)
            }
          }
        }
      }

      if (isEdit) {
        await api.put(`/masters/${slug}/records/${recordId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      } else {
        await api.post(`/masters/${slug}/records`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }

      onSave?.()
    } catch (err) {
      console.error(err)
      setErrors({ _form: err?.response?.data?.error || 'Failed to save. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mf-loading">
        <i className="ti ti-loader-2 mf-spin" />
        Loading form…
      </div>
    )
  }

  if (!schema) return <div className="mf-error">Failed to load form schema.</div>

  const { master, sections } = schema

  return (
    <div className="mf-page-root">

      {/* Header */}
      <div className="mrd-header">
        <div className="mrd-header-left">
          {onCancel && (
            <button
              type="button"
              className="secondary-btn mrd-back-btn"
              onClick={onCancel}
              disabled={saving}
            >
              ← Back
            </button>
          )}
          <div className="mrd-title-block">
            <span className="mrd-master-icon">{master.icon || '📦'}</span>
            <div>
              <div className="mrd-master-name">
                {isEdit ? `Edit ${master.name}` : `New ${master.name}`}
              </div>
              {isEdit && recordId && (
                <div className="mrd-record-id">#{recordId.slice(0, 8)}</div>
              )}
            </div>
          </div>
        </div>

        {errors._form && (
          <div className="mf-form-error">
            <i className="ti ti-alert-circle" /> {errors._form}
          </div>
        )}
      </div>

      {/* Pill tab bar */}
      {sections.length > 1 && (
        <div className="mrd-tab-bar" role="tablist">
          {sections.map((section, idx) => {
            const hasError = section.fields.some(
              f => errors[`${section.slug}__${f.slug}`]
            )
            return (
              <button
                key={section.id}
                role="tab"
                aria-selected={activeTab === idx}
                className={`mrd-tab${activeTab === idx ? ' is-active' : ''}${hasError ? ' mf-tab-error' : ''}`}
                onClick={() => setActiveTab(idx)}
                type="button"
              >
                {section.name}
                {section.is_repeatable && (
                  <span className="mrd-tab-count">
                    {repeatable[section.slug]?.length || 0}
                  </span>
                )}
                {hasError && <i className="ti ti-alert-circle mf-err-dot" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Tab content */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="mrd-section-title">
            {sections[activeTab]?.name}
          </div>

          {sections.map((section, idx) => (
            <div key={section.id} role="tabpanel" hidden={activeTab !== idx}>
              {section.is_repeatable ? (
                <RepeatableSection
                  section={section}
                  rows={repeatable[section.slug] || []}
                  onRowChange={handleRowChange}
                  onAddRow={handleAddRow}
                  onRemoveRow={handleRemoveRow}
                  disabled={saving}
                  existingFiles={existingFiles[section.slug]}
                />
              ) : (
                <>
                  <FlatSection
                    section={section}
                    values={flat[section.slug]}
                    onChange={handleFlatChange}
                    disabled={saving}
                    existingFiles={existingFiles[section.slug]}
                  />
                  {section.fields.map(f => {
                    const err = errors[`${section.slug}__${f.slug}`]
                    return err
                      ? <p key={f.id} className="mf-field-error">{err}</p>
                      : null
                  })}
                </>
              )}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="mf-footer">
          {onCancel && (
            <button
              type="button"
              className="mf-btn mf-btn-ghost"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="mf-btn mf-btn-primary"
            disabled={saving}
          >
            {saving
              ? <><i className="ti ti-loader-2 mf-spin" /> Saving…</>
              : isEdit ? 'Save changes' : `Create ${master.name}`
            }
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Scoped to .mf-* — won't bleed into the rest of your app

const MF_STYLES = `
.mf-root {
  font-family: inherit;
  color: var(--color-text-primary, #1a1a1a);
  max-width: 960px;
}

/* Header */
.mf-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.mf-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mf-header-title i {
  font-size: 20px;
  color: var(--color-text-secondary, #555);
}
.mf-header-title h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.mf-form-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #c0392b;
  background: #fdf0ef;
  border: 1px solid #f5c6c4;
  padding: 6px 12px;
  border-radius: 6px;
}

/* Tabs */
.mf-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-border-tertiary, #e0e0e0);
  margin-bottom: 24px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mf-tabs::-webkit-scrollbar { display: none; }
.mf-tab {
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
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
}
.mf-tab:hover { color: var(--color-text-primary, #111); }
.mf-tab-active {
  color: var(--color-text-primary, #111);
  border-bottom-color: #2563eb;
}
.mf-tab-error { color: #c0392b; }
.mf-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  background: var(--color-border-tertiary, #e8e8e8);
  border-radius: 9px;
}
.mf-tab-active .mf-tab-count {
  background: #dbeafe;
  color: #1d4ed8;
}
.mf-err-dot { font-size: 13px; color: #c0392b; }

/* Flat section grid */
.mf-flat-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
  padding: 4px 0 24px;
}
.mf-field-wrap { display: flex; flex-direction: column; gap: 5px; }
.mf-full { grid-column: 1 / -1; }

.mf-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, #555);
  letter-spacing: 0.01em;
}
.mf-required { color: #c0392b; margin-left: 2px; }

/* Inputs */
.mf-input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--color-text-primary, #111);
  background: var(--color-background-primary, #fff);
  border: 1px solid var(--color-border-secondary, #d4d4d4);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.mf-input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px #dbeafe; }
.mf-input:disabled { opacity: 0.55; cursor: not-allowed; }
.mf-input[type="date"] { cursor: pointer; }
textarea.mf-input { resize: vertical; min-height: 72px; }
.mf-select { cursor: pointer; }

/* Relation dropdown */
.mf-relation-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  font-size: 13px;
  border: 1px solid var(--color-border-secondary, #d4d4d4);
  border-radius: 6px;
  background: var(--color-background-primary, #fff);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s;
}
.mf-relation-trigger:hover { border-color: #2563eb; }
.mf-relation-trigger.mf-disabled { opacity: 0.55; cursor: not-allowed; }
.mf-placeholder { color: var(--color-text-tertiary, #aaa); }
.mf-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--color-background-primary, #fff);
  border: 1px solid var(--color-border-primary, #ccc);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.10);
  overflow: hidden;
}
.mf-dropdown-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-tertiary, #eee);
}
.mf-dropdown-search i { color: var(--color-text-tertiary, #aaa); font-size: 14px; }
.mf-dropdown-search input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  background: transparent;
  color: var(--color-text-primary, #111);
}
.mf-dropdown-list { max-height: 200px; overflow-y: auto; }
.mf-dropdown-hint { padding: 10px 12px; font-size: 13px; color: var(--color-text-tertiary, #aaa); }
.mf-dropdown-item {
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
}
.mf-dropdown-item:hover { background: var(--color-background-secondary, #f5f5f5); }
.mf-dropdown-item.mf-active {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 500;
}

/* File fields */
.mf-file-field { display: flex; flex-direction: column; gap: 6px; }
.mf-file-drop {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px dashed var(--color-border-secondary, #ccc);
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary, #555);
  transition: border-color 0.15s, background 0.15s;
  background: none;
  font-family: inherit;
}
.mf-file-drop:hover:not(.mf-disabled) {
  border-color: #2563eb;
  background: #f0f7ff;
  color: #1d4ed8;
}
.mf-file-drop.mf-disabled { opacity: 0.55; cursor: not-allowed; }
.mf-file-drop.mf-compact { width: fit-content; }
.mf-file-existing { display: flex; align-items: center; gap: 8px; }
.mf-file-thumb { height: 48px; border-radius: 4px; border: 1px solid var(--color-border-tertiary); }
.mf-file-link {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #2563eb;
  text-decoration: none;
}
.mf-file-clear {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #c0392b;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.mf-multifile-field { display: flex; flex-direction: column; gap: 6px; }
.mf-multifile-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
}
.mf-multifile-item i { color: var(--color-text-secondary, #555); }
.mf-multifile-item a { color: #2563eb; text-decoration: none; }
.mf-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: #d1fae5;
  color: #065f46;
}

/* Repeatable section */
.mf-repeat-section { padding: 4px 0 24px; }
.mf-repeat-table {
  border: 1px solid var(--color-border-tertiary, #e8e8e8);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
}
.mf-repeat-header,
.mf-repeat-row {
  display: grid;
  gap: 0;
}
.mf-repeat-header {
  background: var(--color-background-secondary, #f7f7f7);
  border-bottom: 1px solid var(--color-border-tertiary, #e8e8e8);
}
.mf-repeat-th {
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #666);
}
.mf-repeat-row {
  border-bottom: 1px solid var(--color-border-tertiary, #eee);
}
.mf-repeat-row:last-child { border-bottom: none; }
.mf-repeat-cell {
  padding: 6px 8px;
  display: flex;
  align-items: center;
}
.mf-repeat-cell .mf-input {
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 13px;
}
.mf-repeat-cell .mf-relation-trigger {
  padding: 5px 8px;
  font-size: 13px;
  border-radius: 4px;
}
.mf-center { justify-content: center; }

.mf-add-row-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #2563eb;
  background: #f0f7ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.mf-add-row-btn:hover:not(:disabled) { background: #dbeafe; }
.mf-add-row-btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* Utility */
.mf-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: none;
  color: var(--color-text-secondary, #666);
  transition: background 0.1s, color 0.1s;
  font-size: 15px;
}
.mf-icon-btn:hover { background: var(--color-background-secondary, #f0f0f0); }
.mf-icon-btn.mf-danger:hover { background: #fef2f2; color: #c0392b; }
.mf-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.mf-field-error {
  font-size: 12px;
  color: #c0392b;
  margin: -8px 0 8px;
}

/* Footer */
.mf-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 20px 0 4px;
  border-top: 1px solid var(--color-border-tertiary, #eee);
  margin-top: 8px;
}
.mf-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 7px;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: background 0.15s;
}
.mf-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.mf-btn-primary {
  background: #2563eb;
  color: #fff;
}
.mf-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.mf-btn-ghost {
  background: var(--color-background-secondary, #f0f0f0);
  color: var(--color-text-primary, #111);
  border: 1px solid var(--color-border-secondary, #ddd);
}
.mf-btn-ghost:hover:not(:disabled) { background: var(--color-border-tertiary, #e8e8e8); }

/* Loading */
.mf-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px;
  color: var(--color-text-secondary, #666);
  font-size: 14px;
}
.mf-error {
  padding: 20px;
  color: #c0392b;
  font-size: 14px;
}
@keyframes mf-spin { to { transform: rotate(360deg); } }
.mf-spin { display: inline-block; animation: mf-spin 0.8s linear infinite; }

/* Responsive */
@media (max-width: 640px) {
  .mf-flat-section { grid-template-columns: 1fr; }
  .mf-full { grid-column: 1; }
  .mf-repeat-table { font-size: 12px; overflow-x: auto; display: block; }
}
`