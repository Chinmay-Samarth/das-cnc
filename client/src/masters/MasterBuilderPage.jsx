/**
 * MasterBuilderPage — create / edit dynamic master schema (kanban UI).
 * Routes: /masters/config/new | /masters/config/:id
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import api from '../api/client';
import { AlertBanner, PageHeader } from '../components/mes';
import { appConfirm } from '../components/dialog';
import MasterBuilderKanban from './MasterBuilderKanban';
import MasterFieldDrawer from './MasterFieldDrawer';
import {
  emptyMaster,
  toSlug,
  uid,
} from './masterBuilderUtils';

export default function MasterBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [master, setMaster] = useState(emptyMaster());
  const [sections, setSections] = useState([]);
  const [masterSlugManual, setMasterSlugManual] = useState(false);
  const [availableMasters, setAvailableMasters] = useState([]);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [errors, setErrors] = useState({});

  const [editingField, setEditingField] = useState(null); // { field, sectionUid }

  const masterNameById = useMemo(
    () => Object.fromEntries(availableMasters.map((m) => [m.id, m.name])),
    [availableMasters]
  );

  useEffect(() => {
    if (!isEdit) return;

    async function load() {
      setLoading(true);
      try {
        const res = await api(`/masters/${id}`);
        const data = res.data;
        setMaster({ ...emptyMaster(), ...data.master });
        setMasterSlugManual(true);
        setSections(
          (data.sections || []).map((s) => ({
            ...s,
            _uid: uid(),
            _slugManual: true,
            fields: (s.fields || []).map((f) => ({
              ...f,
              _uid: uid(),
              options: f.options ?? [],
              _slugManual: true,
            })),
          }))
        );
      } catch (err) {
        setSaveMsg({ type: 'error', text: `Failed to load master: ${err.message}` });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id, isEdit]);

  useEffect(() => {
    api('/masters')
      .then((r) => r.data)
      .then((data) => {
        const list = Array.isArray(data) ? data : data.masters ?? [];
        setAvailableMasters(list.filter((m) => m.id !== id));
      })
      .catch(() => {});
  }, [id]);

  function setMasterProp(key, value) {
    setMaster((prev) => {
      const next = { ...prev, [key]: value };
      // Slug is not user-editable: follow name on create; lock on edit
      if (key === 'name' && !isEdit && !masterSlugManual) {
        next.slug = toSlug(value);
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  function validate() {
    const errs = {};
    if (!master.name.trim()) errs.name = 'Master name is required';
    if (!master.slug.trim()) errs.slug = 'Master slug is required';
    sections.forEach((s, si) => {
      if (!s.name.trim()) errs[`section_${s._uid}_name`] = `Section ${si + 1}: name required`;
      if (!s.slug.trim()) errs[`section_${s._uid}_slug`] = `Section ${si + 1}: slug required`;
      s.fields.forEach((f, fi) => {
        if (!f.label.trim()) errs[`field_${f._uid}_label`] = `Section ${si + 1}, Field ${fi + 1}: label required`;
        if (!f.slug.trim()) errs[`field_${f._uid}_slug`] = `Section ${si + 1}, Field ${fi + 1}: slug required`;
      });
    });
    return errs;
  }

  function buildPayload() {
    return {
      master: {
        id: master.id,
        name: master.name.trim(),
        slug: master.slug.trim(),
        description: master.description.trim(),
      },
      sections: sections.map((s, si) => ({
        id: s.id,
        name: s.name.trim(),
        slug: s.slug.trim(),
        is_repeatable: s.is_repeatable,
        order: si,
        fields: s.fields.map((f, fi) => ({
          id: f.id,
          label: f.label.trim(),
          slug: f.slug.trim(),
          field_type: f.field_type,
          options: f.options,
          related_master_id: f.related_master_id,
          is_required: f.is_required,
          order: fi,
        })),
      })),
    };
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setSaveMsg({ type: 'error', text: 'Please fix the errors below before saving.' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    const buildpay = buildPayload();

    try {
      let res;
      if (isEdit) {
        res = await api.put(`/masters/${id}`, buildpay);
      } else {
        res = await api.post(`/masters/`, buildpay);
      }

      const saved = res.data;
      setSaveMsg({
        type: 'success',
        text: isEdit ? 'Master updated successfully.' : 'Master created successfully.',
      });

      if (!isEdit && saved?.master?.id) {
        navigate(`/masters/config/${saved.master.id}`, { replace: true });
      } else if (master.slug || saved?.master?.slug) {
        navigate(`/masters/${master.slug || saved.master.slug}`);
      }
    } catch (err) {
      setSaveMsg({ type: 'error', text: `Save failed: ${err.message || err}` });
    } finally {
      setSaving(false);
    }
  }

  function handleRequestEditField(field, sectionUid) {
    setEditingField({ field, sectionUid });
  }

  function handleSaveField(updatedField) {
    const sectionUid = editingField?.sectionUid;
    if (!sectionUid) return;
    const normalized = {
      ...updatedField,
      slug: toSlug(updatedField.label),
      _slugManual: false,
    };

    setSections((prev) =>
      prev.map((s) => {
        if (s._uid !== sectionUid) return s;
        const exists = s.fields.some((f) => f._uid === normalized._uid);
        const newFields = exists
          ? s.fields.map((f) => (f._uid === normalized._uid ? normalized : f))
          : [...s.fields, normalized];
        return { ...s, fields: newFields.map((f, i) => ({ ...f, order: i })) };
      })
    );
    setEditingField(null);
  }

  async function handleDeleteField(sectionUid, fieldUid) {
    const section = sections.find((s) => s._uid === sectionUid);
    const field = section?.fields.find((f) => f._uid === fieldUid);
    const ok = await appConfirm({
      title: 'Delete field',
      message: `Delete field "${field?.label || 'this field'}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setSections((prev) =>
      prev.map((s) => {
        if (s._uid !== sectionUid) return s;
        return {
          ...s,
          fields: s.fields.filter((f) => f._uid !== fieldUid).map((f, i) => ({ ...f, order: i })),
        };
      })
    );
  }

  async function handleDeleteSection(sectionUid) {
    const section = sections.find((s) => s._uid === sectionUid);
    const ok = await appConfirm({
      title: 'Delete section',
      message: `Delete section "${section?.name || 'this section'}" and all its fields? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setSections((prev) =>
      prev.filter((s) => s._uid !== sectionUid).map((s, i) => ({ ...s, order: i }))
    );
  }

  const fieldCount = sections.reduce((acc, s) => acc + s.fields.length, 0);
  const globalErrorList = Object.values(errors).filter(Boolean);

  if (loading) {
    return (
      <main className="mes-shell mes-shell-wide mmb-page">
        <div className="mes-card" style={{ display: 'grid', gap: 16, padding: 32 }}>
          <div className="skeleton" style={{ height: 40, width: '50%', borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 20, width: '70%', borderRadius: 8 }} />
        </div>
      </main>
    );
  }

  return (
    <main className="mes-shell mes-shell-wide mmb-page fade-up">
      <PageHeader
        eyebrow="Masters"
        title={isEdit ? 'Edit master' : 'New master'}
        subtitle="Build the schema as boards (sections) and cards (fields)."
        actions={
          <>
            <button type="button" className="neutral-button" onClick={() => navigate(-1)}>
              <ArrowLeft size={15} />
              Back
            </button>
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
              <Save size={15} />
              {saving ? 'Saving…' : isEdit ? 'Update master' : 'Create master'}
            </button>
          </>
        }
      />

      {saveMsg ? (
        <AlertBanner tone={saveMsg.type === 'success' ? 'amber' : 'danger'}>{saveMsg.text}</AlertBanner>
      ) : null}

      {globalErrorList.length > 0 ? (
        <AlertBanner tone="amber" title="Please fix the following issues">
          <ul className="mmb-error-list">
            {globalErrorList.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </AlertBanner>
      ) : null}

      <section className="mes-card mmb-settings" aria-label="Master settings">
        <h2 className="mes-section-title">Master settings</h2>
        <div className="mmb-settings-grid">
          <label className={`record-field-label${errors.name ? ' is-highlighted' : ''}`}>
            <span>
              Name <span className="mmb-req">*</span>
            </span>
            <input
              value={master.name}
              onChange={(e) => setMasterProp('name', e.target.value)}
              placeholder="Master name"
            />
            {errors.name ? <span className="mmb-error">{errors.name}</span> : null}
          </label>

          <label className="record-field-label">
            <span>Description</span>
            <input
              value={master.description}
              onChange={(e) => setMasterProp('description', e.target.value)}
              placeholder="Optional description"
            />
          </label>
        </div>
      </section>

      <div className="mmb-board-head">
        <h2 className="mes-section-title" style={{ margin: 0 }}>
          Schema board
          <span className="count-chip" style={{ marginLeft: 10 }}>
            {sections.length} section{sections.length !== 1 ? 's' : ''} · {fieldCount} field
            {fieldCount !== 1 ? 's' : ''}
          </span>
        </h2>
      </div>

      <MasterBuilderKanban
        sections={sections}
        setSections={setSections}
        masterNameById={masterNameById}
        onRequestEditField={handleRequestEditField}
        onRequestDeleteField={handleDeleteField}
        onRequestDeleteSection={handleDeleteSection}
      />

      {sections.length > 0 ? (
        <div className="mmb-bottom-bar">
          <p>
            {sections.length} section{sections.length !== 1 ? 's' : ''} · {fieldCount} field
            {fieldCount !== 1 ? 's' : ''}
          </p>
          <div className="mmb-bottom-actions">
            <button type="button" className="cancel-button" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Update master' : 'Create master'}
            </button>
          </div>
        </div>
      ) : null}

      {editingField ? (
        <MasterFieldDrawer
          field={editingField.field}
          availableMasters={availableMasters}
          onSave={handleSaveField}
          onClose={() => {
            setEditingField(null);
          }}
        />
      ) : null}
    </main>
  );
}
