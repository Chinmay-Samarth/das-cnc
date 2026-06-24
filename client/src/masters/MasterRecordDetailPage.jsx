import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/client'

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
    return new Date(cell.value).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  return cell.value || '—'
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellValue({ formatted }) {
  if (typeof formatted === 'string' || formatted === '—') {
    return <span className={formatted === '—' ? 'mrd-empty' : ''}>{formatted}</span>
  }

  if (formatted.type === 'image') {
    return (
      <a href={formatted.url} target="_blank" rel="noreferrer">
        <img src={formatted.url} alt="attachment" className="mrd-thumb" />
      </a>
    )
  }

  if (formatted.type === 'file') {
    return (
      <a href={formatted.url} target="_blank" rel="noreferrer" className="mrd-file-link">
        <i className="ti ti-file-download" /> {formatted.name}
      </a>
    )
  }

  if (formatted.type === 'multi_file') {
    return (
      <div className="mrd-file-list">
        {formatted.files.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noreferrer" className="mrd-file-link">
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
    <div className="mrd-flat-grid">
      {section.fields.map(field => {
        const cell      = sectionData[field.slug]
        const formatted = formatValue(field, cell)
        const isFull    = ['textarea', 'file', 'multi_file'].includes(field.field_type)

        return (
          <div key={field.id} className={`mrd-field${isFull ? ' mrd-full' : ''}`}>
            <div className="mrd-label">{field.label}</div>
            <div className="mrd-value"><CellValue formatted={formatted} /></div>
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
      <div className="mrd-empty-section">
        <i className="ti ti-table-off" />
        <p>No {section.name.toLowerCase()} added yet.</p>
      </div>
    )
  }

  return (
    <div className="mrd-repeat-table-wrap">
      <table className="mrd-repeat-table">
        <thead>
          <tr>
            {section.fields.map(f => <th key={f.id}>{f.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {section.fields.map(field => {
                const cell      = row[field.slug]
                const formatted = formatValue(field, cell)
                return <td key={field.id}><CellValue formatted={formatted} /></td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MasterRecordDetailPage() {
  const { slug, id } = useParams()
  const navigate     = useNavigate()

  const [schema,     setSchema]     = useState(null)
  const [flatValues, setFlatValues] = useState({})
  const [repValues,  setRepValues]  = useState({})
  const [activeTab,  setActiveTab]  = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setActiveTab(0)

    Promise.all([
      api.get(`/masters/${slug}/schema`),
      api.get(`/masters/${slug}/records/${id}`),
    ]).then(([schemaRes, recordRes]) => {
      const { master, sections } = schemaRes.data
      setSchema({ master, sections })

      const { flat, repeatable } = recordRes.data
      setFlatValues(flat || {})
      setRepValues(repeatable || {})

      resolveRelationLabels(sections, flat || {}, repeatable || {})
    }).catch(err => {
      setError(err?.response?.data?.error || 'Failed to load record.')
    }).finally(() => setLoading(false))
  }, [slug, id])

  async function resolveRelationLabels(sections, flat, repeatable) {
    const lookupCache = {}

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

  // ── Skeleton ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-shell">
        <div className="card" style={{ display: 'grid', gap: 16, padding: 32 }}>
          <div className="skeleton" style={{ height: 32, width: '40%', borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 44, width: '60%', borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-shell">
        <div className="card" style={{ color: '#dc2626', display: 'flex', gap: 10, alignItems: 'center' }}>
          <i className="ti ti-alert-circle" style={{ fontSize: 20 }} />
          {error}
        </div>
      </div>
    )
  }

  if (!schema) return null

  const { master, sections } = schema
  const activeSection        = sections[activeTab]

  return (
    <div className="page-shell fade-up">

      {/* ── Page header ── */}
      <div className="mrd-header">
        <div className="mrd-header-left">
          <button
            type="button"
            className="secondary-btn mrd-back-btn"
            onClick={() => navigate(`/masters/${slug}`)}
          >
            ← Back
          </button>
          <div className="mrd-title-block">
            <span className="mrd-master-icon">{master.icon || '📦'}</span>
            <div>
              <div className="mrd-master-name">{master.name}</div>
              <div className="mrd-record-id">#{id.slice(0, 8)}</div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(`/masters/${slug}/records/${id}/edit`)}
          style={{ whiteSpace: 'nowrap' }}
        >
          ✏️ Edit
        </button>
      </div>

      {/* ── Pill tab bar ── */}
      {sections.length > 1 && (
        <div className="mrd-tab-bar" role="tablist">
          {sections.map((section, idx) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeTab === idx}
              className={`mrd-tab${activeTab === idx ? ' is-active' : ''}`}
              onClick={() => setActiveTab(idx)}
            >
              {section.name}
              {section.is_repeatable && (
                <span className="mrd-tab-count">
                  {(repValues[section.slug] || []).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Section content ── */}
      {activeSection && (
        <div className="card" style={{ marginTop: 0 }}>
          <div className="mrd-section-title">{activeSection.name}</div>
          {activeSection.is_repeatable
            ? <RepeatableSectionView section={activeSection} repeatableValues={repValues} />
            : <FlatSectionView       section={activeSection} flatValues={flatValues} />
          }
        </div>
      )}
    </div>
  )
}
