import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { formatDate } from '../components/MasterBuilder/utils';
import RecordDrawer from '../components/MasterRecord/RecordDrawer';
import { formatRecordFieldValue, formatRuleCondition, getRecordValueRow, loadRelatedRecordNames,} from '../components/MasterRecord/displayUtils';
import ImageLightbox from '../components/shared/ImageLightBox'

function DetailField({ label, value }) {
  return (
    <div className="component-detail-field">
      <p className="component-detail-label">{label}</p>
      <p className="component-detail-value">{value || '—'}</p>
    </div>
  );
}

function FieldValueDisplay({ field, record, relatedRecordNames }) {
  const valueRow = getRecordValueRow(record, field.id);
  const formatted = formatRecordFieldValue(field, valueRow, relatedRecordNames);
  const [lightBox, setLightBox]= useState(null)

  if (formatted.kind === 'image') {
    return (
      <div className="component-detail-field">
        <p className="component-detail-label">{field.label || field.field_key}</p>
        <img src={formatted.url} alt={formatted.alt} className="category-thumb" 
        onClick={()=> setLightBox({src: formatted.url, alt: formatted.alt})}/>

        {
          lightBox && (
            <ImageLightbox
            src={lightBox.src}
            alt={lightBox.alt}
            onClose={()=>{setLightBox(null)}}/>
          )
        }
      </div>
    );
  }

  return <DetailField label={field.label || field.field_key} value={formatted.text} />;
}

function SectionValueCell({ field, rowValue, relatedRecordNames }) {
  if (!rowValue) return '—';

  const formatted = formatRecordFieldValue(field, rowValue, relatedRecordNames);

  if (formatted.kind === 'image') {
    return formatted.url ? (
      <img src={formatted.url} alt={formatted.alt} className="category-thumb" 
      onClick={()=> setLightBox({src: formatted.url, alt: formatted.alt})}/>
      
    ) : ('—');
    {lightBox && (
      <ImageLightbox
      src={lightBox.src}
      alt={light.alt}
      onClose={()=>{setLightBox(null)}}/>
    )}
  }

  return formatted.text;
}

function SectionDisplay({ section, record, relatedRecordNames }) {
  const fields = useMemo(
    () => [...(section.master_section_fields || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [section.master_section_fields]
  );

  const rows = useMemo(() => {
    const sectionRows = record?.record_section_rows || [];
    return sectionRows.filter((item) => item.section_id === section.id) || [];
  }, [record?.record_section_rows, section.id]);


  if (rows.length === 0) {
    return (
      <div className="component-detail-card">
        <h3>{section.name}</h3>
        <p className="muted">No rows added.</p>
      </div>
    );
  }

  return (
    <div className="component-detail-card">
      <h3>{section.name}</h3>
      {section.description ? <p className="muted">{section.description}</p> : null}
      <div className="record-section-table-wrap m">
        <table className="record-section-table section-table">
          <thead className=''>
            <tr>
              {fields.map((field) => (
                <th className="" key={field.id}>
                  {field.label || field.field_key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className=''>
                {fields.map((field) => {
                  const cellValue = row.record_section_values?.find(
                    (item) => item.section_field_id === field.id
                  );
                  return (
                    <td key={field.id} className=''>
                      <SectionValueCell field={field} rowValue={cellValue} relatedRecordNames={relatedRecordNames} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MasterRecordDetailPage() {
  const { masterId, recordId } = useParams();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [record, setRecord] = useState(null);
  const [relatedRecordNames, setRelatedRecordNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fields = useMemo(
    () => [...(master?.master_fields || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [master]
  );
  const sections = useMemo(
    () => [...(master?.master_sections || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [master]
  );
  const rules = master?.master_rules || [];
  const categories = record?.record_categories || [];
  const overrides = record?.record_rule_overrides || [];

  const loadRecordDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [masterRes, recordRes] = await Promise.all([
        api.get(`/masters/${masterId}`),
        api.get(`/masters/${masterId}/records/${recordId}`),
      ]);

      const masterData = masterRes.data.master;
      const recordData = recordRes.data.record;

      setMaster(masterData);
      setRecord(recordData);
      setRelatedRecordNames(await loadRelatedRecordNames(masterData, recordData));
    } catch (err) {
      console.error('Failed to load record details:', err);
      setError(err.response?.data?.error || 'Unable to load record details.');
      setMaster(null);
      setRecord(null);
      setRelatedRecordNames({});
    } finally {
      setLoading(false);
    }
  }, [masterId, recordId]);

  useEffect(() => {
    loadRecordDetails();
  }, [loadRecordDetails]);

  const handleSaved = () => {
    setDrawerOpen(false);
    loadRecordDetails();
  };

  const overrideByRuleId = useMemo(() => {
    const map = {};
    overrides.forEach((item) => {
      map[item.rule_id] = item.threshold_value;
    });
    return map;
  }, [overrides]);

  return (
    <main className="app-shell masters-page component-detail-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">
            {master?.icon ? `${master.icon} ` : ''}
            {master?.name || 'Master record'}
          </p>
          <h1>{record?.name || 'Record details'}</h1>
          <p className="muted">
            {record?.code ? `Code: ${record.code}` : 'View all record information.'}
          </p>
        </div>
      </header>

      <section className="card form-card">
        <div className="component-detail-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate(`/masters/${masterId}`)}
          >
            Back to records
          </button>
          {record && master ? (
            <button type="button" className="primary-button" onClick={() => setDrawerOpen(true)}>
              Edit record
            </button>
          ) : null}
        </div>

        {loading ? <p className="muted">Loading record…</p> : null}
        {error ? <p className="error-message">{error}</p> : null}

        {!loading && !error && record && master ? (
          <div className="component-detail-sections">
            <section className="component-detail-section">
              <h2>Info</h2>
              <div className="component-detail-grid">
                <DetailField label="Name" value={record.name} />
                <DetailField label="Code" value={record.code} />
                <DetailField label="Created" value={formatDate(record.created_at)} />
                <DetailField label="Updated" value={formatDate(record.updated_at)} />
              </div>
            </section>

            <section className="component-detail-section">
              <h2>Fields</h2>
              {fields.length === 0 ? (
                <p className="muted">No fields configured for this master.</p>
              ) : (
                <div className="component-detail-grid">

                  {fields.map((field) => (
                    <FieldValueDisplay
                    key={field.id}
                    field={field}
                    record={record}
                    relatedRecordNames={relatedRecordNames}
                    />
                  ))}
                  
                </div>
              )}
            </section>

            {/* Sections  */}

            <section className="component-detail-section">
              <h2>Sections</h2>
              <p>{}</p>
              {sections.length === 0 ? (
                <p className="muted">No sections configured for this master.</p>
              ) : (
                <div className="component-detail-stack">
                  {sections.map((section) => (
                    <SectionDisplay
                      key={section.id}
                      section={section}
                      record={record}
                      relatedRecordNames={relatedRecordNames}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* end */}

            <section className="component-detail-section">
              <h2>Additional Fields</h2>
              {categories.length === 0 ? (
                <p className="muted">No additional Fields.</p>
              ) : (
                <div className="component-detail-stack">
                  {categories.map((item) => (
                    <div key={item.id} className="component-detail-card component-detail-category">
                      {item.value_type === 'image' ? (
                        item.image_url ? (
                          <div className="">
                            <DetailField label={item.key} value={null}/>
                            <img src={item.image_url} alt={item.key || 'Category image'} className="category-thumb"
                            onClick={()=>{setLightBox({src: item.image_url, alt: item.key || "Category Image"})}} />

                            {lightBox && (
                              <ImageLightbox
                              src={lightBox.src}
                              alth={lightBox.alt}
                              onClose={()=>{setLightBox(null)}}/>
                            )}
                          </div>
                        ) : (
                          <p className="muted">No image</p>
                        )
                      ) : (
                        <DetailField label={item.key} value={item.value} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="component-detail-section">
              <h2>Rules</h2>
              {rules.length === 0 ? (
                <p className="muted">No rules defined for this master.</p>
              ) : (
                <div className="component-detail-stack">
                  {rules.map((rule) => {
                    const overrideValue = overrideByRuleId[rule.id];
                    const hasOverride =
                      overrideValue !== undefined && String(overrideValue) !== String(rule.threshold_value ?? '');

                    return (
                      <div key={rule.id} className="component-detail-card">
                        <h3>{rule.name}</h3>
                        <div className="component-detail-grid">

                        <DetailField label="Condition" value={formatRuleCondition(rule, fields)} />
                        <DetailField label="Action" value={rule.action_type} />
                        {rule.action_message ? (
                          <DetailField label="Message" value={rule.action_message} />
                        ) : null}
                        <DetailField label="Default threshold" value={rule.threshold_value ?? '—'} />
                        <DetailField
                          label="Record override"
                          value={hasOverride ? overrideValue : '—'}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>

      {drawerOpen && master && record ? (
        <RecordDrawer
          masterId={masterId}
          master={master}
          recordId={record.id}
          onClose={() => setDrawerOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}
