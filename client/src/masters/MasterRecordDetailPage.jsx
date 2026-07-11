import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import api from '../api/client'
import ImageLightbox from '../components/shared/ImageLightBox'
import InspectionPlanBuilder from './InspectionPlanBuilder'
import BomBuilder from './BomBuilder'
import ActivityFlowBuilder from './ActivityFlowBuilder'
import { isInspectableMasterSlug } from './inspectableMasterSlugs'
import { isStockableMasterSlug } from './stockableMasterSlugs'
import { isBomsMasterSlug } from './bomsMasterSlugs'
import { isRoutableMasterSlug } from './routableMasterSlugs'
import { ArrowLeft, Pencil } from 'lucide-react'

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
  const [lightBox, setLightBox] = useState(null)
  const [isPdf, setIsPdf] = useState(false)

  if (typeof formatted === 'string' || formatted === '—') {
    return <span className={formatted === '—' ? 'mrd-empty' : ''}>{formatted}</span>
  }

  if (formatted.type === 'image') {
    return (
      <div className="" style={{gridColumn: 'span 2'}}>
        <img src={formatted.url} alt={formatted.url}
        style={{ width: '160px', height: '160px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb', cursor: 'pointer' }} 
        onClick={()=>formated.url && setLightBox({ src: formatted.url, alt: formatted.url })}
        />
          {lightBox && (
            <ImageLightbox src={lightBox.src} alt={lightBox.alt} onClose={() => setLightBox(null)} />
          )}
      </div>
    )
  }

  if (formatted.type === 'file') {
    return (
      <div className="">
        <a
        href={formatted.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <div style={{
            width: '160px', height: '160px', borderRadius: '12px',
            border: '1px solid #d1d5db', backgroundColor: '#f3f4f6',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '8px', cursor: 'pointer',
          }}>
            {/* PDF icon */}
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <text x="6" y="18" fontSize="5" fill="#ef4444" stroke="none"
                fontWeight="bold" fontFamily="sans-serif">PDF</text>
            </svg>
            <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '0 8px' }}>
              {formatted.name}<br/>Click to open
            </span>
          </div>
        </a>
      </div>
    )
  }

  if (formatted.type === 'multi_file') {
    console.dir(formatted, {depth: null})
    return (
      <div className="mrd-file-list">
        {formatted.files.map((f, i) => (
        <div className="">
          <a
            href={f}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
          <div style={{
            width: '160px', height: '160px', borderRadius: '12px',
            border: '1px solid #d1d5db', backgroundColor: '#f3f4f6',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '8px', cursor: 'pointer',
          }}>
            {/* PDF icon */}
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <text x="6" y="18" fontSize="5" fill="#ef4444" stroke="none"
                fontWeight="bold" fontFamily="sans-serif">PDF</text>
            </svg>
            <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', padding: '0 8px' }}>
              {f.name}<br/>Click to open
            </span>
          </div>
        </a>
      </div>
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
            <div className="employee-detail-label">{field.label}</div>
            <div className="employee-detail-value"><CellValue formatted={formatted} /></div>
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
      <table className="app-table">
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

// ─── Stock tab (inline) ───────────────────────────────────────────────────────

function formatStockDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function MasterRecordStockTab({ recordId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    api.get('/inventory/stock', { params: { master_record_id: recordId, limit: 100 } })
      .then(({ data }) => {
        if (!mounted) return
        setRows(data.rows || [])
      })
      .catch((err) => {
        if (!mounted) return
        setError(err.response?.data?.error || 'Unable to load stock.')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [recordId])

  if (loading) return <p className="muted">Loading stock...</p>
  if (error) return <p className="error-message">{error}</p>
  if (!rows.length) return <p className="muted">No stock recorded for this item yet.</p>

  return (
    <div className="employees-table-wrap">
      <table className="app-table">
        <thead>
          <tr>
            <th>Lot</th>
            <th>Current stock</th>
            <th>Unit</th>
            <th>Last movement</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.lot_number || '—'}</td>
              <td>{Number(row.current_stock).toLocaleString('en-IN')}</td>
              <td>{row.unit || '—'}</td>
              <td>{formatStockDate(row.last_movement_at)}</td>
              <td>
                <Link to={`/stock/${row.id}`} className="neutral-button" style={{ fontSize: 13, padding: '4px 10px' }}>
                  View ledger
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function getRecordTitle(schema, flatValues) {
  if (!schema?.sections) return null

  for (const section of schema.sections) {
    const sectionData = flatValues[section.slug] || {}
    const nameField = section.fields.find(field => {
      const slug = field.slug || ''
      const label = field.label || ''
      return /name/i.test(slug) || /name/i.test(label)
    })

    if (!nameField) continue

    const cell = sectionData[nameField.slug]
    if (!cell) continue

    if (typeof cell === 'string') return cell
    if (cell.value) return String(cell.value)
    if (cell._label) return String(cell._label)
    if (cell.linked_record_id) return String(cell.linked_record_id)
  }

  return null
}

export default function MasterRecordDetailPage() {
  const { slug, id } = useParams()
  const navigate     = useNavigate()

  const [schema,     setSchema]     = useState(null)
  const [flatValues, setFlatValues] = useState({})
  const [repValues,  setRepValues]  = useState({})
  const [pageTab, setPageTab] = useState('details')
  const [activeTab,  setActiveTab]  = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setPageTab('details')
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
      <div className="app-shell employee-shell">
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
      <div className="app-shell employee-shell">
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
  const showInspectionPlan   = isInspectableMasterSlug(slug)
  const showStockTab         = isStockableMasterSlug(slug)
  const showBomsTab          = isBomsMasterSlug(slug)
  const showActivityFlowTab  = isRoutableMasterSlug(slug)
  const showRecordTabs       = showInspectionPlan || showStockTab || showBomsTab || showActivityFlowTab
  const recordTitle          = getRecordTitle(schema, flatValues)

  return (
    <div className="app-shell employee-shell">

      {/* ── Page header ── */}
      <header className="app-header employee-card">
          <p onClick={()=> navigate(`/masters/${slug}`)} style={{cursor: 'pointer'}}><ArrowLeft size={16} style={{marginRight: 4, display: 'inline'}}/>Back to {slug}</p>
        <div className="employee-title-block">
          <div className="">
            <h1 className="">{recordTitle || master.name}</h1>
            <p className="muted">#{id.slice(0, 8)}</p>
          </div>
          <div className="employee-top-bar">
            <button
              type="button"
              onClick={() => navigate(`/masters/${slug}/records/${id}/edit`)}
              style={{ whiteSpace: 'nowrap' }}
              className='neutral-button'
            >
              <Pencil size={16} style={{display: 'inline', marginRight:4}}/> Edit
            </button>
          </div>
        </div>

        {showRecordTabs ? (
          <div className="mrd-tab-bar" style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`mrd-tab${pageTab === 'details' ? ' is-active' : ''}`}
              onClick={() => setPageTab('details')}
            >
              Details
            </button>
            {showInspectionPlan ? (
              <button
                type="button"
                className={`mrd-tab${pageTab === 'inspection-plan' ? ' is-active' : ''}`}
                onClick={() => setPageTab('inspection-plan')}
              >
                Inspection Plan
              </button>
            ) : null}
            {showStockTab ? (
              <button
                type="button"
                className={`mrd-tab${pageTab === 'stock' ? ' is-active' : ''}`}
                onClick={() => setPageTab('stock')}
              >
                Stock
              </button>
            ) : null}
            {showBomsTab ? (
              <button
                type="button"
                className={`mrd-tab${pageTab === 'boms' ? ' is-active' : ''}`}
                onClick={() => setPageTab('boms')}
              >
                BOMs
              </button>
            ) : null}
            {showActivityFlowTab ? (
              <button
                type="button"
                className={`mrd-tab${pageTab === 'activity-flow' ? ' is-active' : ''}`}
                onClick={() => setPageTab('activity-flow')}
              >
                Flow Chart
              </button>
            ) : null}
          </div>
        ) : null}

          {pageTab === 'details' && sections.length > 1 && (
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
      </header>

      {pageTab === 'inspection-plan' ? (
        <div className="card" style={{ marginTop: 0 }}>
          <InspectionPlanBuilder slug={slug} recordId={id} />
        </div>
      ) : pageTab === 'boms' ? (
        <div className="card" style={{ marginTop: 0 }}>
          <BomBuilder slug={slug} recordId={id} recordTitle={recordTitle} />
        </div>
      ) : pageTab === 'activity-flow' ? (
        <div className="card" style={{ marginTop: 0 }}>
          <ActivityFlowBuilder slug={slug} recordId={id} />
        </div>
      ) : pageTab === 'stock' ? (
        <div className="card" style={{ marginTop: 0 }}>
          <div className="mrd-section-title">Stock</div>
          <MasterRecordStockTab recordId={id} />
        </div>
      ) : activeSection ? (
        <div className="card" style={{ marginTop: 0 }}>
          <div className="mrd-section-title">{activeSection.name}</div>
          {activeSection.is_repeatable
            ? <RepeatableSectionView section={activeSection} repeatableValues={repValues} />
            : <FlatSectionView       section={activeSection} flatValues={flatValues} />
          }
        </div>
      ) : null}
    </div>
  )
}
