// =============================================================================
// MasterForm.jsx
// Generic form renderer for all dynamic masters.
//
// Edit  → tabbed record editor (clean, same actions as before)
// Create → MES wizard (section-by-section + review)
// =============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Check, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
import api from '../api/client'
import FormSearchSelect from '../components/shared/FormSearchSelect'
import { AlertBanner, EmptyState, PageHeader } from '../components/mes'

const FIELD_TYPES_WITH_FULL_WIDTH = ['textarea', 'file', 'multi_file', 'multi_select']

function buildEmptyFlat(sections) {
  const flat = {}
  for (const s of sections) {
    if (s.is_repeatable) continue
    flat[s.slug] = {}
    for (const f of s.fields) {
      if (f.field_type === 'checkbox') flat[s.slug][f.slug] = false
      else if (f.field_type === 'multi_select' || f.field_type === 'multi_file') flat[s.slug][f.slug] = []
      else flat[s.slug][f.slug] = ''
    }
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
  for (const f of fields) {
    if (f.field_type === 'checkbox') row[f.slug] = false
    else if (f.field_type === 'multi_select' || f.field_type === 'multi_file') row[f.slug] = []
    else row[f.slug] = ''
  }
  return row
}

function singularName(name) {
  if (!name) return 'item'
  return name.replace(/s$/i, '') || name
}

function isChecked(value) {
  return value === true || value === 'true' || value === '1' || value === 1
}

function isFieldFilled(field, value, existingFile) {
  if (field.field_type === 'checkbox') return isChecked(value)
  if (field.field_type === 'file') return Boolean(value instanceof File ? value : existingFile)
  if (field.field_type === 'multi_file') {
    const pending = Array.isArray(value) ? value.length : 0
    const saved = Array.isArray(existingFile) ? existingFile.length : 0
    return pending + saved > 0
  }
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return Boolean(value.trim())
  return value != null && value !== ''
}

function formatFileName(file) {
  if (!file) return ''
  if (typeof file === 'string') return file.split('/').pop() || file
  return file.name || file.url?.split('/').pop() || 'File'
}

function displayFieldValue(field, value, existingFile, relationLabel) {
  if (field.field_type === 'checkbox') return isChecked(value) ? 'Yes' : 'No'
  if (field.field_type === 'relation') return relationLabel || '—'
  if (field.field_type === 'file') {
    if (value instanceof File) return value.name
    return formatFileName(existingFile) || '—'
  }
  if (field.field_type === 'multi_file') {
    const pending = Array.isArray(value) ? value.map((f) => f.name) : []
    const saved = Array.isArray(existingFile) ? existingFile.map(formatFileName) : []
    const names = [...saved, ...pending].filter(Boolean)
    return names.length ? names.join(', ') : '—'
  }
  if (field.field_type === 'multi_select') {
    const items = Array.isArray(value) ? value : String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
    return items.length ? items.join(', ') : '—'
  }
  if (value == null || value === '') return '—'
  return String(value)
}

function RelationField({ field, value, onChange, disabled }) {
  const [options, setOptions] = useState([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')

  useEffect(() => {
    if (!value) {
      setSelectedLabel('')
      return
    }
    api.get(`/masters/${field.related_master_slug}/lookup?search=`)
      .then((res) => {
        const match = res.data.find((o) => o.record_id === value)
        if (match) setSelectedLabel(match.label)
      })
      .catch(() => {})
  }, [value, field.related_master_slug])

  useEffect(() => {
    if (!open) return undefined
    setLoading(true)
    const timer = setTimeout(() => {
      api.get(`/masters/${field.related_master_slug}/lookup?search=${encodeURIComponent(search)}`)
        .then((res) => setOptions(res.data || []))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [search, open, field.related_master_slug])

  return (
    <FormSearchSelect
      value={value || ''}
      selectedLabel={selectedLabel}
      placeholder={`Select ${field.label}…`}
      options={options}
      disabled={disabled}
      searchable
      search={search}
      onSearchChange={setSearch}
      onOpenChange={setOpen}
      loading={loading}
      emptyMessage="No results"
      onChange={(recordId, option) => {
        onChange(recordId, option?.label || '')
        setSelectedLabel(option?.label || '')
        setSearch('')
      }}
    />
  )
}

function FileField({ value, onChange, disabled, existingUrl }) {
  const inputRef = useRef(null)
  const existingHref = typeof existingUrl === 'string' ? existingUrl : existingUrl?.url
  const isImage = existingHref && /\.(png|jpg|jpeg|gif|webp)$/i.test(existingHref)

  return (
    <div className="mf-file-field">
      {existingHref && !value ? (
        <div className="mf-file-chip">
          {isImage ? (
            <img src={existingHref} alt="" className="mf-file-thumb" />
          ) : (
            <FileText size={16} />
          )}
          <a href={existingHref} target="_blank" rel="noreferrer">{formatFileName(existingHref)}</a>
          <span className="mf-badge">saved</span>
        </div>
      ) : null}

      {value ? (
        <div className="mf-file-chip">
          <FileText size={16} />
          <span>{value.name}</span>
          <button
            type="button"
            className="mf-chip-remove"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Remove file"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="neutral-button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
        {value || existingHref ? 'Replace file' : 'Choose file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files[0] || null)}
      />
    </div>
  )
}

function MultiFileField({ value = [], onChange, disabled, existingUrls = [] }) {
  const inputRef = useRef(null)

  function addFiles(e) {
    const newFiles = Array.from(e.target.files || [])
    onChange([...value, ...newFiles])
    e.target.value = ''
  }

  return (
    <div className="mf-multifile-field">
      {existingUrls.map((f, i) => (
        <div key={`saved-${i}`} className="mf-file-chip">
          <FileText size={16} />
          <a href={f.url || f} target="_blank" rel="noreferrer">{formatFileName(f)}</a>
          <span className="mf-badge">saved</span>
        </div>
      ))}
      {value.map((f, i) => (
        <div key={`new-${i}`} className="mf-file-chip">
          <FileText size={16} />
          <span>{f.name}</span>
          <button
            type="button"
            className="mf-chip-remove"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            disabled={disabled}
            aria-label={`Remove ${f.name}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="neutral-button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Plus size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
        Add files
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

function MultiSelectField({ field, value, onChange, disabled }) {
  const selected = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((s) => s.trim()).filter(Boolean)

  function toggle(opt) {
    const next = selected.includes(opt)
      ? selected.filter((item) => item !== opt)
      : [...selected, opt]
    onChange(next)
  }

  return (
    <div className="mf-multi-select">
      {(field.options || []).map((opt) => (
        <button
          key={opt}
          type="button"
          className={`neutral-button${selected.includes(opt) ? ' is-selected' : ''}`}
          disabled={disabled}
          onClick={() => toggle(opt)}
        >
          {opt}
        </button>
      ))}
      {(field.options || []).length === 0 ? (
        <span className="muted">No options configured</span>
      ) : null}
    </div>
  )
}

function FieldInput({ field, value, onChange, disabled, existingFile, invalid }) {
  const inputClass = invalid ? 'input-error' : undefined

  switch (field.field_type) {
    case 'textarea':
      return (
        <textarea
          rows={4}
          className={inputClass}
          placeholder={field.placeholder || ''}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
    case 'float':
      return (
        <input
          type="number"
          className={inputClass}
          step={field.field_type === 'float' ? 'any' : '1'}
          placeholder={field.placeholder || ''}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          className={inputClass}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="mf-checkbox-input"
          checked={isChecked(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      )
    case 'select':
      return (
        <FormSearchSelect
          value={value || ''}
          onChange={onChange}
          options={field.options || []}
          placeholder="Select…"
          disabled={disabled}
          searchable={(field.options || []).length > 6}
        />
      )
    case 'multi_select':
      return (
        <MultiSelectField
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
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
          value={value}
          onChange={onChange}
          disabled={disabled}
          existingUrl={existingFile?.url || (typeof existingFile === 'string' ? existingFile : null)}
        />
      )
    case 'multi_file':
      return (
        <MultiFileField
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
          className={inputClass}
          placeholder={field.placeholder || ''}
          value={value || ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

function FlatSection({ section, values, onChange, disabled, existingFiles, errors = {} }) {
  return (
    <div className="mf-flat-section">
      {section.fields.map((field) => {
        const errKey = `${section.slug}__${field.slug}`
        const err = errors[errKey]
        const isFull = FIELD_TYPES_WITH_FULL_WIDTH.includes(field.field_type)
        const isCheck = field.field_type === 'checkbox'

        return (
          <label
            key={field.id || field.slug}
            className={`mf-field${isFull ? ' mf-full' : ''}${isCheck ? ' mf-check-field' : ''}${err ? ' is-invalid' : ''}`}
          >
            <span>
              {field.label}
              {field.is_required ? <span className="required-mark"> *</span> : null}
            </span>
            <FieldInput
              field={field}
              value={values?.[field.slug]}
              onChange={(val, label) => onChange(section.slug, field.slug, val, label)}
              disabled={disabled}
              existingFile={existingFiles?.[field.slug]}
              invalid={Boolean(err)}
            />
            {err ? <span className="field-error">{err}</span> : null}
          </label>
        )
      })}
    </div>
  )
}

function RepeatableSection({
  section,
  rows,
  onRowChange,
  onAddRow,
  onRemoveRow,
  disabled,
  existingFiles,
  errors = {},
}) {
  const itemName = singularName(section.name)

  return (
    <div className="mf-repeat-section">
      {rows.length === 0 ? (
        <div className="mf-repeat-empty">
          <EmptyState
            title={`No ${section.name.toLowerCase()} yet`}
            description={`Add a ${itemName.toLowerCase()} if this record needs one. You can skip this step.`}
          />
          <button
            type="button"
            className="neutral-button"
            disabled={disabled}
            onClick={() => onAddRow(section.slug, section.fields)}
          >
            <Plus size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
            Add {itemName}
          </button>
        </div>
      ) : (
        <div className="mf-repeat-list">
          {rows.map((row, rowIdx) => (
            <div key={rowIdx} className="mf-repeat-card">
              <div className="mf-repeat-card-head">
                <strong>{itemName} {rowIdx + 1}</strong>
                <button
                  type="button"
                  className="neutral-button mf-repeat-remove"
                  disabled={disabled}
                  onClick={() => onRemoveRow(section.slug, rowIdx)}
                >
                  <Trash2 size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
                  Remove
                </button>
              </div>
              <div className="mf-flat-section">
                {section.fields.map((field) => {
                  const errKey = `${section.slug}__${rowIdx}__${field.slug}`
                  const err = errors[errKey]
                  const isFull = FIELD_TYPES_WITH_FULL_WIDTH.includes(field.field_type)
                  const isCheck = field.field_type === 'checkbox'
                  return (
                    <label
                      key={field.id || field.slug}
                      className={`mf-field${isFull ? ' mf-full' : ''}${isCheck ? ' mf-check-field' : ''}${err ? ' is-invalid' : ''}`}
                    >
                      <span>
                        {field.label}
                        {field.is_required ? <span className="required-mark"> *</span> : null}
                      </span>
                      <FieldInput
                        field={field}
                        value={row[field.slug]}
                        onChange={(val, label) => onRowChange(section.slug, rowIdx, field.slug, val, label)}
                        disabled={disabled}
                        existingFile={existingFiles?.[rowIdx]?.[field.slug]}
                        invalid={Boolean(err)}
                      />
                      {err ? <span className="field-error">{err}</span> : null}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <button
          type="button"
          className="neutral-button"
          disabled={disabled}
          onClick={() => onAddRow(section.slug, section.fields)}
        >
          <Plus size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'text-bottom' }} />
          Add {itemName}
        </button>
      ) : null}
    </div>
  )
}

function ReviewPanel({ sections, flat, repeatable, existingFiles, relationLabels }) {
  return (
    <div className="mf-review">
      {sections.map((section) => {
        if (section.is_repeatable) {
          const rows = repeatable[section.slug] || []
          return (
            <div key={section.id || section.slug} className="mf-review-block">
              <h3>{section.name}</h3>
              {rows.length === 0 ? (
                <p className="muted">None added</p>
              ) : (
                rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="mf-review-row">
                    <p className="mf-review-row-title">{singularName(section.name)} {rowIdx + 1}</p>
                    <dl className="mf-review-grid">
                      {section.fields.map((field) => (
                        <div key={field.id || field.slug}>
                          <dt>{field.label}</dt>
                          <dd>
                            {displayFieldValue(
                              field,
                              row[field.slug],
                              existingFiles?.[section.slug]?.[rowIdx]?.[field.slug],
                              relationLabels[`${section.slug}__${rowIdx}__${field.slug}`]
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))
              )}
            </div>
          )
        }

        return (
          <div key={section.id || section.slug} className="mf-review-block">
            <h3>{section.name}</h3>
            <dl className="mf-review-grid">
              {section.fields.map((field) => (
                <div key={field.id || field.slug}>
                  <dt>{field.label}</dt>
                  <dd>
                    {displayFieldValue(
                      field,
                      flat[section.slug]?.[field.slug],
                      existingFiles?.[section.slug]?.[field.slug],
                      relationLabels[`${section.slug}__${field.slug}`]
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )
      })}
    </div>
  )
}

export default function MasterForm({ slug, recordId, onSave, onCancel, variant, embedded = false }) {
  const isEdit = Boolean(recordId)
  const isWizard = variant === 'wizard' || (!isEdit && variant !== 'edit')

  const [schema, setSchema] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [step, setStep] = useState(0)
  const [flat, setFlat] = useState({})
  const [repeatable, setRepeatable] = useState({})
  const [fileMap, setFileMap] = useState({})
  const [existingFiles, setExistingFiles] = useState({})
  const [relationLabels, setRelationLabels] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [name, setName] = useState('')

  useEffect(() => {
    setLoading(true)
    api.get(`/masters/${slug}/schema`).then((res) => {
      const { master, sections } = res.data
      setSchema({ master, sections: sections || [] })
      if (!isEdit) {
        setFlat(buildEmptyFlat(sections || []))
        setRepeatable(buildEmptyRepeatable(sections || []))
      }
    }).catch(() => {
      setSchema(null)
    }).finally(() => setLoading(false))
  }, [slug, isEdit])

  useEffect(() => {
    if (!isEdit || !schema) return
    api.get(`/masters/${slug}/records/${recordId}`).then((res) => {
      const { flat: rFlat, repeatable: rRep, label: recordName } = res.data

      const flatState = buildEmptyFlat(schema.sections)
      const existingF = {}
      const labels = {}
      for (const [sSlug, fields] of Object.entries(rFlat || {})) {
        if (!flatState[sSlug]) flatState[sSlug] = {}
        for (const [fSlug, v] of Object.entries(fields)) {
          if (v.file_url) {
            flatState[sSlug][fSlug] = null
            if (!existingF[sSlug]) existingF[sSlug] = {}
            existingF[sSlug][fSlug] = v.file_url
          } else if (v.file_urls) {
            flatState[sSlug][fSlug] = []
            if (!existingF[sSlug]) existingF[sSlug] = {}
            existingF[sSlug][fSlug] = v.file_urls
          } else if (v.linked_record_id) {
            flatState[sSlug][fSlug] = v.linked_record_id
            if (v._label) labels[`${sSlug}__${fSlug}`] = v._label
          } else if (typeof v.value === 'boolean' || v.value === 'true' || v.value === 'false') {
            flatState[sSlug][fSlug] = isChecked(v.value)
          } else {
            flatState[sSlug][fSlug] = v.value || ''
          }
        }
      }

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
              if (v._label) labels[`${sSlug}__${ri}__${k}`] = v._label
            } else if (typeof v?.value === 'boolean' || v?.value === 'true' || v?.value === 'false') {
              out[k] = isChecked(v.value)
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
      setRelationLabels(labels)
      setName(recordName)
    }).catch(() => {
      setErrors({ _form: 'Failed to load record.' })
    })
  }, [isEdit, recordId, schema, slug])

  const rememberFile = useCallback((sectionSlug, key, value) => {
    if (value instanceof File || (Array.isArray(value) && value[0] instanceof File)) {
      setFileMap((prev) => ({
        ...prev,
        [sectionSlug]: { ...(prev[sectionSlug] || {}), [key]: value },
      }))
    }
  }, [])

  const handleFlatChange = useCallback((sectionSlug, fieldSlug, value, label) => {
    setFlat((prev) => ({
      ...prev,
      [sectionSlug]: { ...prev[sectionSlug], [fieldSlug]: value },
    }))
    rememberFile(sectionSlug, fieldSlug, value)
    if (typeof label === 'string') {
      setRelationLabels((prev) => ({ ...prev, [`${sectionSlug}__${fieldSlug}`]: label }))
    }
    setErrors((prev) => {
      if (!prev[`${sectionSlug}__${fieldSlug}`]) return prev
      const next = { ...prev }
      delete next[`${sectionSlug}__${fieldSlug}`]
      return next
    })
  }, [rememberFile])

  const handleRowChange = useCallback((sectionSlug, rowIdx, fieldSlug, value, label) => {
    setRepeatable((prev) => {
      const rows = [...(prev[sectionSlug] || [])]
      rows[rowIdx] = { ...rows[rowIdx], [fieldSlug]: value }
      return { ...prev, [sectionSlug]: rows }
    })
    rememberFile(sectionSlug, `${rowIdx}__${fieldSlug}`, value)
    if (typeof label === 'string') {
      setRelationLabels((prev) => ({ ...prev, [`${sectionSlug}__${rowIdx}__${fieldSlug}`]: label }))
    }
  }, [rememberFile])

  const handleAddRow = useCallback((sectionSlug, fields) => {
    setRepeatable((prev) => ({
      ...prev,
      [sectionSlug]: [...(prev[sectionSlug] || []), buildEmptyRow(fields)],
    }))
  }, [])

  const handleRemoveRow = useCallback((sectionSlug, rowIdx) => {
    setRepeatable((prev) => {
      const rows = [...(prev[sectionSlug] || [])]
      rows.splice(rowIdx, 1)
      return { ...prev, [sectionSlug]: rows }
    })
  }, [])

  function validateSection(section) {
    const errs = {}
    if (!section) return errs
    if (section.is_repeatable) {
      const rows = repeatable[section.slug] || []
      rows.forEach((row, rowIdx) => {
        for (const field of section.fields) {
          if (!field.is_required) continue
          const existing = existingFiles[section.slug]?.[rowIdx]?.[field.slug]
          if (!isFieldFilled(field, row[field.slug], existing)) {
            errs[`${section.slug}__${rowIdx}__${field.slug}`] = `${field.label} is required`
          }
        }
      })
      return errs
    }
    for (const field of section.fields) {
      if (!field.is_required) continue
      const val = flat[section.slug]?.[field.slug]
      const existing = existingFiles[section.slug]?.[field.slug]
      if (!isFieldFilled(field, val, existing)) {
        errs[`${section.slug}__${field.slug}`] = `${field.label} is required`
      }
    }
    return errs
  }

  function validateAll() {
    const errs = {}
    for (const section of schema.sections) {
      Object.assign(errs, validateSection(section))
    }
    return errs
  }

  async function persist() {
    setSaving(true)
    try {
      const formData = new FormData()

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
        repPayload[sSlug] = rows.map((row) => {
          const out = {}
          for (const [k, v] of Object.entries(row)) {
            if (v instanceof File || (Array.isArray(v) && v[0] instanceof File)) continue
            out[k] = v
          }
          return out
        })
      }

      formData.append('data', JSON.stringify({ flat: flatPayload, repeatable: repPayload }))

      for (const [sSlug, fields] of Object.entries(fileMap)) {
        for (const [key, fileVal] of Object.entries(fields)) {
          if (key.includes('__')) {
            const [rowIdx, fSlug] = key.split('__')
            if (Array.isArray(fileVal)) {
              fileVal.forEach((f) => formData.append(`file__${sSlug}__${rowIdx}__${fSlug}`, f))
            } else if (fileVal) {
              formData.append(`file__${sSlug}__${rowIdx}__${fSlug}`, fileVal)
            }
          } else if (Array.isArray(fileVal)) {
            fileVal.forEach((f) => formData.append(`file__${sSlug}__${key}`, f))
          } else if (fileVal) {
            formData.append(`file__${sSlug}__${key}`, fileVal)
          }
        }
      }

      let savedId = recordId
      if (isEdit) {
        await api.put(`/masters/${slug}/records/${recordId}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } else {
        const res = await api.post(`/masters/${slug}/records`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        savedId = res.data?.id
      }

      onSave?.(savedId)
    } catch (err) {
      setErrors({ _form: err?.response?.data?.error || 'Failed to save. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!schema) return

    if (isWizard && step < schema.sections.length) {
      const sectionErrs = validateSection(schema.sections[step])
      if (Object.keys(sectionErrs).length) {
        setErrors(sectionErrs)
        return
      }
      setErrors({})
      setStep((s) => s + 1)
      return
    }

    const errs = validateAll()
    if (Object.keys(errs).length) {
      setErrors(errs)
      const errKey = Object.keys(errs)[0]
      const errSectionSlug = errKey.split('__')[0]
      const tabIdx = schema.sections.findIndex((s) => s.slug === errSectionSlug)
      if (tabIdx >= 0) {
        setActiveTab(tabIdx)
        setStep(tabIdx)
      }
      return
    }
    setErrors({})
    await persist()
  }

  const wizardSteps = useMemo(() => {
    if (!schema) return []
    const sectionSteps = schema.sections.map((section, idx) => ({
      id: idx,
      title: section.name,
      hint: section.is_repeatable ? 'Add as many as needed' : 'Fill in the details',
    }))
    return [
      ...sectionSteps,
      { id: schema.sections.length, title: 'Review', hint: 'Confirm and create' },
    ]
  }, [schema])

  if (loading) {
    return (
      <div className={embedded ? 'mf-embedded' : 'mes-shell bpo-setup-page'}>
        <p className="muted">Loading form…</p>
      </div>
    )
  }

  if (!schema) {
    return (
      <div className={embedded ? 'mf-embedded' : 'mes-shell bpo-setup-page'}>
        <AlertBanner tone="danger" title="Unable to load form">
          Failed to load this master schema.
        </AlertBanner>
      </div>
    )
  }

  const { master, sections } = schema
  const reviewStep = sections.length
  const onReview = isWizard && step >= reviewStep
  const currentSection = sections[isWizard ? step : activeTab]
  const shellClass = embedded ? 'mf-embedded' : isWizard ? 'mes-shell bpo-setup-page' : 'mes-shell'

  function renderSection(section) {
    if (!section) return null
    if (section.is_repeatable) {
      return (
        <RepeatableSection
          section={section}
          rows={repeatable[section.slug] || []}
          onRowChange={handleRowChange}
          onAddRow={handleAddRow}
          onRemoveRow={handleRemoveRow}
          disabled={saving}
          existingFiles={existingFiles[section.slug]}
          errors={errors}
        />
      )
    }
    return (
      <FlatSection
        section={section}
        values={flat[section.slug]}
        onChange={handleFlatChange}
        disabled={saving}
        existingFiles={existingFiles[section.slug]}
        errors={errors}
      />
    )
  }

  if (isWizard) {
    return (
      <main className={shellClass}>
        {!embedded ? (
          <PageHeader
            eyebrow={master.name}
            title={`New ${master.name}`}
            subtitle="Fill each step, then review before creating the record."
            actions={
              onCancel ? (
                <button type="button" className="neutral-button" onClick={onCancel} disabled={saving}>
                  <ArrowLeft size={16} />
                  Back to list
                </button>
              ) : null
            }
          />
        ) : null}

        {wizardSteps.length > 1 ? (
          <nav className="bpo-steps" aria-label="Record steps">
            {wizardSteps.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
                onClick={() => {
                  if (s.id <= step) setStep(s.id)
                }}
                disabled={s.id > step}
              >
                <span className="bpo-step-num">
                  {step > s.id ? <Check size={14} strokeWidth={3} /> : s.id + 1}
                </span>
                <span className="bpo-step-text">
                  <strong>{s.title}</strong>
                  <small>{s.hint}</small>
                </span>
              </button>
            ))}
          </nav>
        ) : null}

        {errors._form ? <AlertBanner tone="danger">{errors._form}</AlertBanner> : null}

        <form onSubmit={handleSubmit} noValidate>
          <section className="card bpo-setup-card">
            {onReview ? (
              <div className="bpo-panel">
                <h2>Review {master.name}</h2>
                <p className="muted bpo-lead">Check the details below, then create the record.</p>
                <ReviewPanel
                  sections={sections}
                  flat={flat}
                  repeatable={repeatable}
                  existingFiles={existingFiles}
                  relationLabels={relationLabels}
                />
              </div>
            ) : (
              <div className="bpo-panel">
                <h2>{currentSection?.name}</h2>
                <p className="muted bpo-lead">
                  {currentSection?.is_repeatable
                    ? `Add each ${singularName(currentSection.name).toLowerCase()} as its own card. This step is optional.`
                    : 'Required fields are marked with an asterisk.'}
                </p>
                {renderSection(currentSection)}
              </div>
            )}
          </section>

          <footer className="bpo-footer">
            <button
              type="button"
              className="neutral-button"
              disabled={step <= 0 || saving}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
            {onReview ? (
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Creating…' : `Create ${master.name}`}
              </button>
            ) : (
              <button type="submit" className="primary-button" disabled={saving}>
                Continue
              </button>
            )}
          </footer>
        </form>
      </main>
    )
  }

  return (
    <div className={shellClass}>
      {!embedded ? (
        <div className="mrd-header">
          <div className="mrd-header-left">
            {onCancel ? (
              <button type="button" className="neutral-button" onClick={onCancel} disabled={saving}>
                <ArrowLeft size={16} style={{ display: 'inline', marginRight: 4, verticalAlign: 'text-bottom' }} />
                Back
              </button>
            ) : null}
            <div className="mrd-title-block">
              <div>
                <div className="mrd-master-name">
                  {isEdit ? `Edit ${master.name}` : `New ${master.name}`}
                </div>
                {isEdit && name ? <div className="muted">{name}</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {errors._form ? <AlertBanner tone="danger">{errors._form}</AlertBanner> : null}

      {sections.length > 1 ? (
        <div className="mrd-tab-bar" role="tablist">
          {sections.map((section, idx) => {
            const hasError = Object.keys(errors).some((key) => key.startsWith(`${section.slug}__`))
            return (
              <button
                key={section.id || section.slug}
                role="tab"
                aria-selected={activeTab === idx}
                className={`mrd-tab${activeTab === idx ? ' is-active' : ''}${hasError ? ' mf-tab-error' : ''}`}
                onClick={() => setActiveTab(idx)}
                type="button"
              >
                {section.name}
                {section.is_repeatable ? (
                  <span className="mrd-tab-count">{repeatable[section.slug]?.length || 0}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="mrd-section-title">{sections[activeTab]?.name}</div>
          {sections.map((section, idx) => (
            <div key={section.id || section.slug} role="tabpanel" hidden={activeTab !== idx}>
              {renderSection(section)}
            </div>
          ))}
        </div>

        <div className="mf-footer">
          {onCancel ? (
            <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : `Create ${master.name}`}
          </button>
        </div>
      </form>
    </div>
  )
}
