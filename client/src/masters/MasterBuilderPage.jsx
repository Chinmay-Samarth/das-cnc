/**
 * MasterBuilderPage.jsx
 * ─────────────────────
 * Unified create / edit page for the DasCNC dynamic master system.
 *
 * Routes
 *   /masters/configure/new   → create mode
 *   /masters/configure/:id   → edit mode
 *
 * API contract (same payload shape for read & write)
 *   GET  /api/master-builder/:id
 *   POST /api/master-builder
 *   PUT  /api/master-builder/:id
 *
 * Payload shape
 *   {
 *     master: { id, name, slug, description, icon },
 *     sections: [{
 *       id, name, slug, is_repeatable, order,
 *       fields: [{ id, label, slug, field_type, options, related_master_id,
 *                  is_required, order }]
 *     }]
 *   }
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/client";

/* ─── Constants ──────────────────────────────────────────────────────────── */

const FIELD_TYPES = [
  { value: "text",         label: "Text" },
  { value: "textarea",     label: "Textarea" },
  { value: "number",       label: "Number" },
  { value: "date",         label: "Date" },
  { value: "select",       label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "checkbox",     label: "Checkbox" },
  { value: "file",         label: "File" },
  { value: "multi_file",   label: "Multi-file" },
  { value: "relation",     label: "Relation" },
];

const FIELD_TYPE_ICONS = {
  text:         "Tt",
  textarea:     "¶",
  number:       "#",
  date:         "📅",
  select:       "▾",
  multi_select: "☰",
  checkbox:     "☑",
  file:         "📎",
  multi_file:   "📁",
  relation:     "🔗",
};

const ICON_PRESETS = [
  "📦","⚙️","🏭","🔧","📋","👥","💰","📊","🗂️","🛠️","🔩","📐","🏗️","📌","🗃️",
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function toSlug(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

function uid() {
  return `tmp_${Math.random().toString(36).slice(2, 9)}`;
}

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ─── Empty state factories ──────────────────────────────────────────────── */

function emptyMaster() {
  return { id: null, name: "", slug: "", description: "", icon: "📦" };
}

function emptySection(order = 0) {
  return {
    _uid: uid(),
    id: null,
    name: "",
    slug: "",
    is_repeatable: false,
    order,
    fields: [],
    _collapsed: false,
    _slugManual: false,
  };
}

function emptyField(order = 0) {
  return {
    _uid: uid(),
    id: null,
    label: "",
    slug: "",
    field_type: "text",
    options: [],
    related_master_id: null,
    is_required: false,
    order,
    _slugManual: false,
  };
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

/** Simple confirmation dialog rendered as a viewport overlay */
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return createPortal(
    <div style={styles.dialogBackdrop}>
      <div style={styles.dialog} className="card">
        <p style={{ marginBottom: 20, fontSize: 15, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="secondary-btn" onClick={onCancel} style={styles.dialogBtn}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ ...styles.dialogBtn, background: "#dc2626" }}>
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Options tag-input used for select / multi_select fields */
function OptionsEditor({ options, onChange }) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || options.includes(v)) return;
    onChange([...options, v]);
    setDraft("");
  }

  function remove(opt) {
    onChange(options.filter((o) => o !== opt));
  }

  return (
    <div className="tag-input">
      <span className="master-field-extra-label">Options</span>
      <div className="tag-list">
        {options.map((opt) => (
          <span key={opt} className="tag-chip">
            {opt}
            <button
              className="tag-remove"
              type="button"
              onClick={() => remove(opt)}
              title={`Remove "${opt}"`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="Type an option and press Enter"
        />
        <button type="button" className="secondary-btn" onClick={add} style={{ whiteSpace: "nowrap" }}>
          Add
        </button>
      </div>
    </div>
  );
}

/** Field editor — shown in a right-side drawer */
function FieldDrawer({ field, availableMasters, onSave, onClose }) {
  const [local, setLocal] = useState(() => cloneDeep(field));
  const [errors, setErrors] = useState({});
  const labelInputRef = useRef(null);

  useEffect(() => {
    labelInputRef.current?.focus();
  }, []);

  function set(key, value) {
    setLocal((prev) => {
      const next = { ...prev, [key]: value };
      // auto-slug
      if (key === "label" && !prev._slugManual) {
        next.slug = toSlug(value);
      }
      if (key === "slug") {
        next._slugManual = true;
        next.slug = toSlug(value);
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  function validate() {
    const errs = {};
    if (!local.label.trim()) errs.label = "Label is required";
    if (!local.slug.trim())  errs.slug  = "Slug is required";
    if ((local.field_type === "select" || local.field_type === "multi_select") && local.options.length === 0) {
      errs.options = "Add at least one option";
    }
    if (local.field_type === "relation" && !local.related_master_id) {
      errs.related_master_id = "Select a related master";
    }
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(local);
  }

  const needsOptions  = local.field_type === "select" || local.field_type === "multi_select";
  const needsRelation = local.field_type === "relation";

  return (
    <div style={styles.drawerBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside style={styles.drawer} className="fade-up">
        {/* Header */}
        <div style={styles.drawerHeader}>
          <div>
            <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: 4 }}>
              Field Editor
            </p>
            <h2 style={{ margin: 0, fontSize: "1.15rem" }}>
              {field.id || field._uid.startsWith("tmp_") ? (local.label || "New Field") : local.label}
            </h2>
          </div>
          <button className="secondary-btn" onClick={onClose} style={{ padding: "8px 14px" }}>
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div style={styles.drawerBody}>
          {/* Label */}
          <div className={`record-field-label${errors.label ? " is-highlighted" : ""}`}>
            <span>Label <span style={{ color: "#dc2626" }}>*</span></span>
            <input
              ref={labelInputRef}
              value={local.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="e.g. Customer Name"
            />
            {errors.label && <span style={styles.fieldError}>{errors.label}</span>}
          </div>

          {/* Slug */}
          <div className={`record-field-label${errors.slug ? " is-highlighted" : ""}`}>
            <span style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Slug <span style={{ color: "#dc2626" }}>*</span></span>
              {local._slugManual && (
                <span
                  style={{ fontSize: 12, color: "#1d4ed8", cursor: "pointer", fontWeight: 500 }}
                  onClick={() => setLocal((p) => ({ ...p, slug: toSlug(p.label), _slugManual: false }))}
                >
                  Reset
                </span>
              )}
            </span>
            <input
              value={local.slug}
              onChange={(e) => set("slug", e.target.value)}
              placeholder="auto_generated"
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, color: "#475569" }}
            />
            {errors.slug && <span style={styles.fieldError}>{errors.slug}</span>}
          </div>

          {/* Field type */}
          <div className="record-field-label">
            <span>Field Type</span>
            <select value={local.field_type} onChange={(e) => set("field_type", e.target.value)}>
              {FIELD_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </select>
          </div>

          {/* Options editor */}
          {needsOptions && (
            <div>
              <OptionsEditor
                options={local.options}
                onChange={(opts) => { setLocal((p) => ({ ...p, options: opts })); setErrors((e) => ({ ...e, options: null })); }}
              />
              {errors.options && <span style={styles.fieldError}>{errors.options}</span>}
            </div>
          )}

          {/* Relation selector */}
          {needsRelation && (
            <div className={`record-field-label${errors.related_master_id ? " is-highlighted" : ""}`}>
              <span>Related Master <span style={{ color: "#dc2626" }}>*</span></span>
              <select
                value={local.related_master_id ?? ""}
                onChange={(e) => { set("related_master_id", e.target.value || null); }}
              >
                <option value="">— Select master —</option>
                {availableMasters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {errors.related_master_id && <span style={styles.fieldError}>{errors.related_master_id}</span>}
            </div>
          )}

          {/* Required toggle */}
          <label className="master-field-checkbox" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={local.is_required}
              onChange={(e) => set("is_required", e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "#1d4ed8" }}
            />
            <span style={{ fontWeight: 600 }}>Required field</span>
          </label>
        </div>

        {/* Footer */}
        <div style={styles.drawerFooter}>
          <button className="secondary-btn" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ flex: 2 }}>
            Save Field
          </button>
        </div>
      </aside>
    </div>
  );
}

/** Single field row inside a section */
function FieldRow({ field, isFirst, isLast, onEdit, onDelete, onMoveUp, onMoveDown }) {
  const typeIcon = FIELD_TYPE_ICONS[field.field_type] ?? "?";

  return (
    <div className="master-field-row" style={{ gridTemplateColumns: "auto 1fr auto auto auto auto" }}>
      {/* Reorder */}
      <div className="master-field-reorder">
        <button
          type="button"
          className="secondary-btn"
          style={styles.iconBtn}
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >▲</button>
        <button
          type="button"
          className="secondary-btn"
          style={styles.iconBtn}
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >▼</button>
      </div>

      {/* Label / slug */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {field.label || <em style={{ color: "#94a3b8" }}>Unnamed field</em>}
          {field.is_required && <span style={styles.requiredDot} title="Required">*</span>}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{field.slug || "—"}</div>
      </div>

      {/* Type badge */}
      <div className="master-field-type-badge">
        <span className="master-field-type-label">Type</span>
        <span className="master-field-type-value">
          <span style={{ marginRight: 6 }}>{typeIcon}</span>
          {FIELD_TYPES.find((f) => f.value === field.field_type)?.label ?? field.field_type}
        </span>
      </div>

      {/* Options / relation preview */}
      <div style={{ minWidth: 100 }}>
        {(field.field_type === "select" || field.field_type === "multi_select") && field.options.length > 0 && (
          <div className="tag-list" style={{ flexWrap: "wrap" }}>
            {field.options.slice(0, 3).map((o) => (
              <span key={o} className="tag-chip" style={{ fontSize: 11 }}>{o}</span>
            ))}
            {field.options.length > 3 && (
              <span className="tag-chip" style={{ fontSize: 11, background: "#e2e8f0", color: "#475569" }}>
                +{field.options.length - 3}
              </span>
            )}
          </div>
        )}
        {field.field_type === "relation" && field.related_master_id && (
          <span className="tag-chip" style={{ fontSize: 11 }}>🔗 {field.related_master_id}</span>
        )}
      </div>

      {/* Edit */}
      <button
        type="button"
        className="secondary-btn"
        style={{ padding: "8px 14px", fontSize: 13 }}
        onClick={onEdit}
        title="Edit field"
      >
        ✏️ Edit
      </button>

      {/* Delete */}
      <button
        type="button"
        className="master-field-remove"
        onClick={onDelete}
        title="Delete field"
      >
        ×
      </button>
    </div>
  );
}

/** Collapsible section card */
function SectionCard({
  section,
  isFirst,
  isLast,
  availableMasters,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  const [editingField, setEditingField] = useState(null); // field object being edited
  const [confirmDeleteField, setConfirmDeleteField] = useState(null);

  /* Section field mutation helpers */
  function updateField(uid, updates) {
    onChange({
      ...section,
      fields: section.fields.map((f) =>
        f._uid === uid ? { ...f, ...updates } : f
      ),
    });
  }

  function deleteField(uid) {
    onChange({
      ...section,
      fields: section.fields.filter((f) => f._uid !== uid).map((f, i) => ({ ...f, order: i })),
    });
  }

  function addField() {
    const f = emptyField(section.fields.length);
    setEditingField(f);
  }

  function saveField(updatedField) {
    const exists = section.fields.some((f) => f._uid === updatedField._uid);
    const newFields = exists
      ? section.fields.map((f) => (f._uid === updatedField._uid ? updatedField : f))
      : [...section.fields, updatedField];
    onChange({ ...section, fields: newFields.map((f, i) => ({ ...f, order: i })) });
    setEditingField(null);
  }

  function moveField(uid, dir) {
    const idx = section.fields.findIndex((f) => f._uid === uid);
    if (idx < 0) return;
    const next = [...section.fields];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange({ ...section, fields: next.map((f, i) => ({ ...f, order: i })) });
  }

  function setSectionProp(key, value) {
    onChange({ ...section, [key]: value });
  }

  /* Slug auto-generate for section name */
  function handleNameChange(val) {
    onChange({
      ...section,
      name: val,
      slug: section._slugManual ? section.slug : toSlug(val),
    });
  }

  function handleSlugChange(val) {
    onChange({ ...section, slug: toSlug(val), _slugManual: true });
  }

  return (
    <div className="card master-builder-card" style={{ marginBottom: 16 }}>
      {/* Card header */}
      <div className="master-section-card-header">
        {/* Collapse toggle */}
        <button
          type="button"
          className="secondary-btn"
          style={{ ...styles.iconBtn, fontSize: 16 }}
          onClick={() => onChange({ ...section, _collapsed: !section._collapsed })}
          title={section._collapsed ? "Expand" : "Collapse"}
        >
          {section._collapsed ? "▶" : "▼"}
        </button>

        {/* Name */}
        <label className="master-section-name" style={{ marginBottom: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
            Section Name
          </span>
          <input
            value={section.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Basic Information"
          />
        </label>

        {/* Slug */}
        <label style={{ marginBottom: 0, minWidth: 160 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
            Slug
          </span>
          <input
            value={section.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="auto_slug"
            style={{ fontFamily: "monospace", fontSize: 13, color: "#475569" }}
          />
        </label>

        {/* Repeatable toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={section.is_repeatable}
            onChange={(e) => setSectionProp("is_repeatable", e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#1d4ed8" }}
          />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Repeatable</span>
        </label>

        {/* Move up/down */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="secondary-btn"
            style={styles.iconBtn}
            onClick={onMoveUp}
            disabled={isFirst}
            title="Move section up"
          >↑</button>
          <button
            type="button"
            className="secondary-btn"
            style={styles.iconBtn}
            onClick={onMoveDown}
            disabled={isLast}
            title="Move section down"
          >↓</button>
        </div>

        {/* Delete section */}
        <button
          type="button"
          className="master-section-remove"
          onClick={onDelete}
          title="Delete section"
        >
          ×
        </button>
      </div>

      {/* Fields list */}
      {!section._collapsed && (
        <div>
          {section.fields.length === 0 ? (
            <div style={styles.emptyFields}>
              No fields yet. Click <strong>+ Add Field</strong> to get started.
            </div>
          ) : (
            <div className="master-field-list">
              {section.fields.map((field, idx) => (
                <FieldRow
                  key={field._uid}
                  field={field}
                  isFirst={idx === 0}
                  isLast={idx === section.fields.length - 1}
                  onEdit={() => setEditingField(cloneDeep(field))}
                  onDelete={() => setConfirmDeleteField(field._uid)}
                  onMoveUp={() => moveField(field._uid, -1)}
                  onMoveDown={() => moveField(field._uid, 1)}
                />
              ))}
            </div>
          )}

          {/* Add field button */}
          <div style={{ marginTop: 12 }}>
            <button type="button" className="secondary-btn" onClick={addField} style={{ fontSize: 13 }}>
              + Add Field
            </button>
          </div>
        </div>
      )}

      {/* Collapsed summary */}
      {section._collapsed && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <span className="count-chip">{section.fields.length} field{section.fields.length !== 1 ? "s" : ""}</span>
          {section.is_repeatable && <span className="eyebrow">Repeatable</span>}
        </div>
      )}

      {/* Field editor drawer */}
      {editingField && (
        <FieldDrawer
          field={editingField}
          availableMasters={availableMasters}
          onSave={saveField}
          onClose={() => setEditingField(null)}
        />
      )}

      {/* Confirm delete field */}
      {confirmDeleteField && (
        <ConfirmDialog
          message={`Delete field "${section.fields.find((f) => f._uid === confirmDeleteField)?.label || "this field"}"? This cannot be undone.`}
          onConfirm={() => { deleteField(confirmDeleteField); setConfirmDeleteField(null); }}
          onCancel={() => setConfirmDeleteField(null)}
        />
      )}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export default function MasterBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  /* ── Core state ── */
  const [master,   setMaster]   = useState(emptyMaster());
  const [sections, setSections] = useState([]);
  const [masterSlugManual, setMasterSlugManual] = useState(false);

  /* ── Available masters for relation fields ── */
  const [availableMasters, setAvailableMasters] = useState([]);

  /* ── UI state ── */
  const [loading,  setLoading]  = useState(isEdit);
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState(null); // { type: "success"|"error", text }
  const [errors,   setErrors]   = useState({});
  const [confirmDeleteSection, setConfirmDeleteSection] = useState(null); // section _uid
  const [showIconPicker, setShowIconPicker] = useState(false);

  /* ── Load schema in edit mode ── */
  useEffect(() => {
    if (!isEdit) return;

    async function load() {
      setLoading(true);
      try {
        const res = await api(`/masters/${id}`);
        const data = await res.data;

        setMaster({ ...emptyMaster(), ...data.master });
        setMasterSlugManual(true); // existing slug — don't auto-generate

        const hydratedSections = (data.sections || []).map((s) => ({
          ...s,
          _uid: uid(),
          _collapsed: false,
          _slugManual: true,
          fields: (s.fields || []).map((f) => ({
            ...f,
            _uid: uid(),
            options: f.options ?? [],
            _slugManual: true,
          })),
        }));
        setSections(hydratedSections);
      } catch (err) {
        setSaveMsg({ type: "error", text: `Failed to load master: ${err.message}` });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id, isEdit]);

  /* ── Load available masters for relation fields ── */
  useEffect(() => {
    api("/masters")
      .then((r) => r.data)
      .then((data) => {
        const list = Array.isArray(data) ? data : data.masters ?? [];
        // Exclude self in edit mode
        setAvailableMasters(list.filter((m) => m.id !== id));
      })
      .catch(() => {}); // non-fatal
  }, [id]);

  /* ── Master field helpers ── */
  function setMasterProp(key, value) {
    setMaster((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "name" && !masterSlugManual) next.slug = toSlug(value);
      if (key === "slug") { setMasterSlugManual(true); next.slug = toSlug(value); }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  /* ── Section CRUD ── */
  function addSection() {
    setSections((prev) => [...prev, emptySection(prev.length)]);
  }

  function updateSection(uid, updated) {
    setSections((prev) => prev.map((s) => (s._uid === uid ? updated : s)));
  }

  function deleteSection(uid) {
    setSections((prev) => prev.filter((s) => s._uid !== uid).map((s, i) => ({ ...s, order: i })));
  }

  function moveSection(uid, dir) {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s._uid === uid);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }

  /* ── Validation ── */
  function validate() {
    const errs = {};
    if (!master.name.trim()) errs.name = "Master name is required";
    if (!master.slug.trim()) errs.slug = "Master slug is required";

    sections.forEach((s, si) => {
      if (!s.name.trim()) errs[`section_${s._uid}_name`] = `Section ${si + 1}: name required`;
      if (!s.slug.trim()) errs[`section_${s._uid}_slug`] = `Section ${si + 1}: slug required`;
      s.fields.forEach((f, fi) => {
        if (!f.label.trim()) errs[`field_${f._uid}_label`] = `Section ${si + 1}, Field ${fi + 1}: label required`;
        if (!f.slug.trim())  errs[`field_${f._uid}_slug`]  = `Section ${si + 1}, Field ${fi + 1}: slug required`;
      });
    });
    return errs;
  }

  /* ── Build payload ── */
  function buildPayload() {
    return {
      master: {
        id:          master.id,
        name:        master.name.trim(),
        slug:        master.slug.trim(),
        description: master.description.trim(),
        icon:        master.icon,
      },
      sections: sections.map((s, si) => ({
        id:            s.id,
        name:          s.name.trim(),
        slug:          s.slug.trim(),
        is_repeatable: s.is_repeatable,
        order:         si,
        fields: s.fields.map((f, fi) => ({
          id:                f.id,
          label:             f.label.trim(),
          slug:              f.slug.trim(),
          field_type:        f.field_type,
          options:           f.options,
          related_master_id: f.related_master_id,
          is_required:       f.is_required,
          order:             fi,
        })),
      })),
    }
  }

  /* ── Save ── */
  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setSaveMsg({ type: "error", text: "Please fix the errors below before saving." });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setSaving(true);
    setSaveMsg(null);

    console.log(buildPayload())
    const buildpay = buildPayload()

    try {
        let res
      const url    = isEdit ? `/masters/${id}` : "/masters/";
      const method = isEdit ? "PUT" : "POST";
      if (method === "PUT"){
        res  = await api.put(`/masters/${id}`, {
          body:  buildpay,
        headers: { "Content-Type": "application/json" },
      });
    }
      else{
       res = await api.post(`/masters/`, {
        body: buildpay,
        headers: { "Content-Type": "application/json" },
      });
     
      }

    //   if (!res.ok) {
    //     const body = await res.json().catch(() => ({}));
    //     throw new Error(body.message || `HTTP ${res.status}`);
    //   }

      const saved = res.data;
      setSaveMsg({ type: "success", text: isEdit ? "Master updated successfully." : "Master created successfully." });

      if (!isEdit && saved?.master?.id) {
        navigate(`/masters/configure/${saved.master.id}`, { replace: true });
      }
    } catch (err) {
      setSaveMsg({ type: "error", text: `Save failed: ${err}` });
    } finally {
      setSaving(false);
      navigate(`/masters/${master.slug}`)
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="page-shell master-builder-page">
        <div className="card" style={{ display: "grid", gap: 16, padding: 32 }}>
          <div className="skeleton" style={{ height: 40, width: "50%", borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 20, width: "70%", borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 20, width: "40%", borderRadius: 8 }} />
        </div>
        <div className="card" style={{ marginTop: 16, height: 180 }} />
      </div>
    );
  }

  const globalErrorList = Object.values(errors).filter(Boolean);

  return (
    <div className="page-shell master-builder-page fade-up">
      {/* ── Page header ── */}
      <div className="master-builder-header">
        <div className="master-builder-title-block">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="eyebrow">{isEdit ? "Edit Master" : "New Master"}</span>
          </div>
          <input
            className="master-builder-name-input"
            value={master.name}
            onChange={(e) => setMasterProp("name", e.target.value)}
            placeholder="Master name…"
            style={errors.name ? { borderColor: "#dc2626" } : {}}
          />
          {errors.name && <span style={styles.fieldError}>{errors.name}</span>}
          <input
            className="master-builder-desc-input"
            value={master.description}
            onChange={(e) => setMasterProp("description", e.target.value)}
            placeholder="Short description (optional)"
          />
        </div>

        {/* Save button */}
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "flex-start", paddingTop: 8 }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => navigate(-1)}
            style={{ whiteSpace: "nowrap" }}
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{ whiteSpace: "nowrap", minWidth: 120 }}
          >
            {saving ? "Saving…" : isEdit ? "Update Master" : "Create Master"}
          </button>
        </div>
      </div>

      {/* ── Save / error banner ── */}
      {saveMsg && (
        <div
          className="master-builder-notice"
          style={saveMsg.type === "success"
            ? { background: "#dcfce7", borderColor: "#86efac", color: "#166534" }
            : { background: "#fee2e2", borderColor: "#fca5a5", color: "#991b1b" }
          }
        >
          {saveMsg.text}
        </div>
      )}

      {/* ── Global validation errors ── */}
      {globalErrorList.length > 0 && (
        <div className="master-builder-notice" style={{ background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412" }}>
          <strong>Please fix the following issues:</strong>
          <ul style={{ margin: "6px 0 0 16px", lineHeight: 1.8 }}>
            {globalErrorList.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── Master meta card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Master Settings</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 16 }}>
          {/* Slug */}
          <div className="record-field-label" style={{ marginBottom: 0 }}>
            <span style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Slug <span style={{ color: "#dc2626" }}>*</span></span>
              {masterSlugManual && (
                <span
                  style={{ fontSize: 12, color: "#1d4ed8", cursor: "pointer", fontWeight: 500 }}
                  onClick={() => { setMaster((p) => ({ ...p, slug: toSlug(p.name) })); setMasterSlugManual(false); }}
                >
                  Reset
                </span>
              )}
            </span>
            <input
              value={master.slug}
              onChange={(e) => setMasterProp("slug", e.target.value)}
              placeholder="auto_generated"
              style={{
                fontFamily: "monospace", fontSize: 13, color: "#475569",
                ...(errors.slug ? { borderColor: "#dc2626" } : {}),
              }}
            />
            {errors.slug && <span style={styles.fieldError}>{errors.slug}</span>}
          </div>

          {/* Description (second column) */}
          <div className="record-field-label" style={{ marginBottom: 0 }}>
            <span>Description</span>
            <input
              value={master.description}
              onChange={(e) => setMasterProp("description", e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {/* Icon */}
          <div className="master-builder-icon-input" style={{ marginBottom: 0 }}>
            <span>Icon</span>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="secondary-btn"
                style={{ fontSize: 22, padding: "8px 16px", width: "100%" }}
                onClick={() => setShowIconPicker((p) => !p)}
              >
                {master.icon || "📦"}
              </button>
              {showIconPicker && (
                <div style={styles.iconPicker} onClick={(e) => e.stopPropagation()}>
                  {ICON_PRESETS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className="secondary-btn"
                      style={{ fontSize: 20, padding: 8, background: master.icon === ic ? "#dbeafe" : undefined }}
                      onClick={() => { setMasterProp("icon", ic); setShowIconPicker(false); }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section builder ── */}
      <div className="section-header" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
          Sections
          <span className="count-chip" style={{ marginLeft: 10, verticalAlign: "middle" }}>
            {sections.length}
          </span>
        </h2>
        <button type="button" onClick={addSection} style={{ fontSize: 13, padding: "10px 18px" }}>
          + Add Section
        </button>
      </div>

      {sections.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ marginBottom: 16, fontSize: 15 }}>
            No sections yet. Sections group related fields together.
          </p>
          <button type="button" onClick={addSection}>
            + Add your first section
          </button>
        </div>
      )}

      <div className="master-section-list">
        {sections.map((section, idx) => (
          <SectionCard
            key={section._uid}
            section={section}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            availableMasters={availableMasters}
            onChange={(updated) => updateSection(section._uid, updated)}
            onDelete={() => setConfirmDeleteSection(section._uid)}
            onMoveUp={() => moveSection(section._uid, -1)}
            onMoveDown={() => moveSection(section._uid, 1)}
          />
        ))}
      </div>

      {/* ── Bottom save bar ── */}
      {sections.length > 0 && (
        <div style={styles.bottomBar}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            {sections.length} section{sections.length !== 1 ? "s" : ""} · {" "}
            {sections.reduce((acc, s) => acc + s.fields.length, 0)} field{sections.reduce((acc, s) => acc + s.fields.length, 0) !== 1 ? "s" : ""}
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate(-1)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ minWidth: 140 }}
            >
              {saving ? "Saving…" : isEdit ? "Update Master" : "Create Master"}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm delete section ── */}
      {confirmDeleteSection && (
        <ConfirmDialog
          message={`Delete section "${sections.find((s) => s._uid === confirmDeleteSection)?.name || "this section"}" and all its fields? This cannot be undone.`}
          onConfirm={() => { deleteSection(confirmDeleteSection); setConfirmDeleteSection(null); }}
          onCancel={() => setConfirmDeleteSection(null)}
        />
      )}

      {/* Close icon picker when clicking outside */}
      {showIconPicker && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9 }}
          onClick={() => setShowIconPicker(false)}
        />
      )}
    </div>
  );
}

/* ─── Inline styles (supplement CSS classes) ─────────────────────────────── */

const styles = {
  iconBtn: {
    width: 32,
    height: 32,
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  requiredDot: {
    color: "#dc2626",
    marginLeft: 4,
    fontWeight: 700,
  },
  emptyFields: {
    padding: "20px 14px",
    borderRadius: 12,
    background: "#f8fbff",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  fieldError: {
    display: "block",
    fontSize: 12,
    color: "#dc2626",
    marginTop: 4,
    fontWeight: 500,
  },
  drawerBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "rgba(15,23,42,0.35)",
    backdropFilter: "blur(2px)",
    display: "flex",
    justifyContent: "flex-end",
  },
  drawer: {
    width: "min(520px, 100vw)",
    height: "100vh",
    background: "#ffffff",
    borderLeft: "1px solid #e2e8f0",
    boxShadow: "-8px 0 32px rgba(15,23,42,0.12)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    padding: "20px 24px 16px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fbff",
  },
  drawerBody: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "grid",
    gap: 16,
    alignContent: "start",
  },
  drawerFooter: {
    display: "flex",
    gap: 12,
    padding: "16px 24px",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fbff",
  },
  dialogBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "rgba(15,23,42,0.45)",
    backdropFilter: "blur(2px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "min(440px, 100%)",
    padding: 28,
    borderRadius: 20,
  },
  dialogBtn: {
    padding: "10px 22px",
    borderRadius: 12,
    fontWeight: 600,
  },
  iconPicker: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: 20,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 4,
    padding: 8,
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    boxShadow: "0 10px 30px rgba(15,23,42,0.12)",
    minWidth: 180,
  },
  bottomBar: {
    position: "sticky",
    bottom: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 20px",
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(8px)",
    borderTop: "1px solid #e2e8f0",
    borderRadius: "0 0 16px 16px",
    marginTop: 8,
    boxShadow: "0 -4px 20px rgba(15,23,42,0.06)",
  },
};