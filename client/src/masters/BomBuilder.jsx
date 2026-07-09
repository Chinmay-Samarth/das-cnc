import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import MasterItemSelect from '../girn/MasterItemSelect';
import { useSocket } from '../socket/socketContext';
import { Plus, ChevronRight, ChevronDown, Pencil, Trash2, X, Check } from 'lucide-react';

const CHILD_TYPE_OPTIONS = [
  { value: 'component', label: 'Component', masterSlug: 'component', category: 'component' },
  { value: 'raw-material', label: 'Raw Material', masterSlug: 'raw-material', category: 'raw_material' },
];

function StatusBadge({ status, revision }) {
  const styles = {
    draft: { background: '#f3f4f6', color: '#374151' },
    active: { background: '#dcfce7', color: '#166534' },
    retired: { background: '#fee2e2', color: '#991b1b' },
  };
  const style = styles[status] || styles.draft;
  return (
    <span className="bom-status-badge" style={style}>
      {status} · rev {revision}
    </span>
  );
}

function TypeBadge({ slug }) {
  const label = slug === 'raw-material' ? 'Raw Material' : slug === 'component' ? 'Component' : slug || '—';
  return <span className={`bom-type-badge bom-type-badge--${slug || 'unknown'}`}>{label}</span>;
}

function InheritedBadge() {
  return <span className="bom-inherited-badge">Sub-assembly BOM</span>;
}

function nodeKey(node) {
  if (node.cyclic) return `cyclic-${node.recordId}`;
  if (node.source === 'inherited') return `inh-${node.edge?.id || node.recordId}`;
  return node.edge?.id || node.recordId;
}

function formatDate(d) {
  if (!d) return '—';
  return d;
}

function AddChildForm({ parentId, onSave, onCancel, saving }) {
  const [childType, setChildType] = useState('component');
  const [childId, setChildId] = useState('');
  const [childLabel, setChildLabel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [uom, setUom] = useState('pcs');
  const [notes, setNotes] = useState('');

  const typeCfg = CHILD_TYPE_OPTIONS.find((o) => o.value === childType) || CHILD_TYPE_OPTIONS[0];

  function handleChildChange(selection) {
    setChildId(selection.master_record_id);
    setChildLabel(selection.master_record_label || '');
    if (selection.unit) setUom(selection.unit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!childId) return;
    await onSave({
      parent_element_id: parentId,
      child_element_id: childId,
      quantity: parseFloat(quantity) || 1,
      uom: uom.trim() || 'pcs',
      notes: notes.trim() || null,
    });
  }

  return (
    <form className="bom-add-form" onSubmit={handleSubmit}>
      <div className="bom-add-form-title">New BOM line</div>
      <div className="bom-add-form-grid">
        <label>
          <span className="employee-detail-label">Type</span>
          <select
            value={childType}
            onChange={(e) => {
              setChildType(e.target.value);
              setChildId('');
              setChildLabel('');
            }}
          >
            {CHILD_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="employee-detail-label">Item</span>
          <MasterItemSelect
            masterSlug={typeCfg.masterSlug}
            category={typeCfg.category}
            value={childId}
            label={childLabel}
            onChange={handleChildChange}
          />
        </label>
        <label>
          <span className="employee-detail-label">Qty</span>
          <input type="number" min="0.0001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </label>
        <label>
          <span className="employee-detail-label">UOM</span>
          <input type="text" value={uom} onChange={(e) => setUom(e.target.value)} required />
        </label>
        <label className="bom-add-form-notes">
          <span className="employee-detail-label">Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <div className="bom-add-form-actions">
        <button type="submit" className="primary-button" disabled={saving || !childId}>
          {saving ? 'Adding...' : 'Add line'}
        </button>
        <button type="button" className="cancel-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditEdgeForm({ edge, onSave, onCancel, saving }) {
  const [quantity, setQuantity] = useState(String(edge.quantity ?? ''));
  const [uom, setUom] = useState(edge.uom || 'pcs');
  const [notes, setNotes] = useState(edge.notes || '');

  async function handleSubmit(e) {
    e.preventDefault();
    await onSave({
      quantity: parseFloat(quantity),
      uom: uom.trim(),
      notes: notes.trim() || null,
    });
  }

  return (
    <form className="bom-edit-form" onSubmit={handleSubmit}>
      <input type="number" min="0.0001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <input type="text" value={uom} onChange={(e) => setUom(e.target.value)} />
      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
      <button type="submit" className="icon-button" title="Save" disabled={saving}><Check size={16} /></button>
      <button type="button" className="icon-button" title="Cancel" onClick={onCancel} disabled={saving}><X size={16} /></button>
    </form>
  );
}

function BomTreeNode({
  node,
  depth = 1,
  readOnly,
  expandedIds,
  onToggleExpand,
  onOpenAddForm,
  addingParentId,
  onCloseAddForm,
  editingEdgeId,
  setEditingEdgeId,
  onAddChild,
  onUpdateEdge,
  onDeleteEdge,
  saving,
}) {
  const { edge, label, slug, children, recordId, source, cyclic } = node;
  const isInherited = source === 'inherited';
  const isLocal = source === 'local' || !source;
  const hasChildren = children?.length > 0;
  const isComponent = slug === 'component';
  const canExpand = isComponent || hasChildren;
  const canAddChildren = isComponent && isLocal && !cyclic;
  const isExpanded = expandedIds.has(recordId);
  const isAddingHere = addingParentId === recordId;
  const isEditing = isLocal && editingEdgeId === edge?.id;
  const isBranchOpen = isExpanded || isAddingHere;
  const showActions = !readOnly && isLocal && edge && !isEditing && !cyclic;

  if (cyclic) {
    return (
      <li className="bom-tree-item bom-tree-item--cyclic">
        <div className="bom-tree-row bom-tree-row--cyclic" style={{ '--bom-depth': depth }}>
          <div className="bom-tree-col bom-tree-col-item">
            <span className="bom-tree-leaf-dot" aria-hidden />
            <span className="bom-tree-label muted">{label} — circular reference skipped</span>
          </div>
          <div className="bom-tree-col bom-tree-col-type"><span className="muted">—</span></div>
          <div className="bom-tree-col bom-tree-col-qty"><span className="muted">—</span></div>
          <div className="bom-tree-col bom-tree-col-uom"><span className="muted">—</span></div>
          <div className="bom-tree-col bom-tree-col-notes"><span className="muted">—</span></div>
          <div className="bom-tree-col bom-tree-col-actions" />
        </div>
      </li>
    );
  }

  return (
    <li className="bom-tree-item">
      <div
        className={[
          'bom-tree-row',
          isComponent ? 'bom-tree-row--assembly' : '',
          isInherited ? 'bom-tree-row--inherited' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--bom-depth': depth }}
      >
        <div className="bom-tree-col bom-tree-col-item">
          {canExpand ? (
            <button
              type="button"
              className="bom-tree-toggle"
              onClick={() => onToggleExpand(recordId)}
              aria-label={isBranchOpen ? 'Collapse' : 'Expand'}
            >
              {isBranchOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="bom-tree-leaf-dot" aria-hidden />
          )}
          <span className="bom-tree-label">{label}</span>
        </div>
        <div className="bom-tree-col bom-tree-col-type">
          <TypeBadge slug={slug} />
          {isInherited ? <InheritedBadge /> : null}
        </div>
        <div className="bom-tree-col bom-tree-col-qty">
          {edge && !isEditing ? <span className="bom-tree-qty">{edge.quantity}</span> : null}
        </div>
        <div className="bom-tree-col bom-tree-col-uom">
          {edge && !isEditing ? <span className="bom-tree-uom">{edge.uom}</span> : null}
        </div>
        <div className="bom-tree-col bom-tree-col-notes">
          {edge && !isEditing && edge.notes ? (
            <span className="bom-tree-notes" title={edge.notes}>{edge.notes}</span>
          ) : (
            <span className="bom-tree-notes muted">—</span>
          )}
        </div>
        <div className="bom-tree-col bom-tree-col-actions">
          {edge && isEditing ? (
            <EditEdgeForm
              edge={edge}
              saving={saving}
              onCancel={() => setEditingEdgeId(null)}
              onSave={async (payload) => {
                await onUpdateEdge(edge.id, payload);
                setEditingEdgeId(null);
              }}
            />
          ) : null}
          {showActions ? (
            <div className="bom-tree-actions">
              <button type="button" className="icon-button" title="Edit" onClick={() => setEditingEdgeId(edge.id)}>
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-button" title="Delete" onClick={() => onDeleteEdge(edge.id, label)}>
                <Trash2 size={15} /> 
              </button>
              {canAddChildren ? (
                <button
                  type="button"
                  className="neutral-button bom-add-child-btn"
                  onClick={() => onOpenAddForm(recordId)}
                >
                  <Plus size={14} /> Child
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {canExpand && isBranchOpen ? (
        <ul className="bom-tree-branch">
          {canAddChildren && isAddingHere ? (
            <li className="bom-tree-item bom-tree-item--form" style={{ '--bom-depth': depth + 1 }}>
              <AddChildForm
                parentId={recordId}
                saving={saving}
                onCancel={onCloseAddForm}
                onSave={async (payload) => {
                  await onAddChild(payload, recordId);
                  onCloseAddForm();
                }}
              />
            </li>
          ) : null}

          {hasChildren ? (
            children.map((child) => (
              <BomTreeNode
                key={nodeKey(child)}
                node={child}
                depth={depth + 1}
                readOnly={readOnly}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onOpenAddForm={onOpenAddForm}
                addingParentId={addingParentId}
                onCloseAddForm={onCloseAddForm}
                editingEdgeId={editingEdgeId}
                setEditingEdgeId={setEditingEdgeId}
                onAddChild={onAddChild}
                onUpdateEdge={onUpdateEdge}
                onDeleteEdge={onDeleteEdge}
                saving={saving}
              />
            ))
          ) : canAddChildren && !isAddingHere ? (
            <li className="bom-tree-item bom-tree-item--empty" style={{ '--bom-depth': depth + 1 }}>
              <span className="muted">No child lines</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

export default function BomBuilder({ slug, recordId, recordTitle }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [version, setVersion] = useState(null);
  const [tree, setTree] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [hasActiveVersion, setHasActiveVersion] = useState(false);

  const [expandedIds, setExpandedIds] = useState(() => new Set([recordId]));
  const [addingParentId, setAddingParentId] = useState(null);
  const [editingEdgeId, setEditingEdgeId] = useState(null);
  const { subscribe, joinBomRoom, leaveBomRoom } = useSocket();
  const skipSocketRefreshRef = useRef(false);

  const expandNode = useCallback((id) => {
    setExpandedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const onToggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onOpenAddForm = useCallback((parentId) => {
    setAddingParentId(parentId);
    setEditingEdgeId(null);
    expandNode(parentId);
    expandNode(recordId);
  }, [expandNode, recordId]);

  const onCloseAddForm = useCallback(() => {
    setAddingParentId(null);
  }, []);

  const loadBom = useCallback(async (versionId = null, preserveExpansion = false) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = versionId
        ? `/masters/${slug}/records/${recordId}/bom/versions/${versionId}`
        : `/masters/${slug}/records/${recordId}/bom`;
      const { data } = await api.get(endpoint);
      setVersion(data.version);
      setTree(data.tree || []);
      setHasActiveVersion(data.has_active_version === true);
      if (!versionId && !preserveExpansion) {
        setExpandedIds(new Set([recordId]));
        setAddingParentId(null);
        setEditingEdgeId(null);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load BOM.');
    } finally {
      setLoading(false);
    }
  }, [slug, recordId]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get(`/masters/${slug}/records/${recordId}/bom/history`);
      setHistory(data.history || []);
    } catch (err) {
      console.error('Failed to load BOM history:', err);
    }
  }, [slug, recordId]);

  useEffect(() => {
    loadBom();
    loadHistory();
  }, [loadBom, loadHistory]);

  useEffect(() => {
    joinBomRoom(recordId);
    return () => leaveBomRoom(recordId);
  }, [recordId, joinBomRoom, leaveBomRoom]);

  useEffect(() => {
    const unsubscribe = subscribe('bom:updated', (payload) => {
      if (payload?.recordId !== recordId) return;
      if (skipSocketRefreshRef.current) {
        skipSocketRefreshRef.current = false;
        return;
      }
      loadBom(null, true);
      loadHistory();
    });
    return unsubscribe;
  }, [subscribe, recordId, loadBom, loadHistory]);

  const markLocalBomMutation = useCallback(() => {
    skipSocketRefreshRef.current = true;
  }, []);

  async function handleAddChild(payload, parentId) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post(`/masters/${slug}/records/${recordId}/bom/edges`, payload);
      markLocalBomMutation();
      setVersion(data.version);
      setTree(data.tree || []);
      setHasActiveVersion(true);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(recordId);
        next.add(parentId);
        return next;
      });
      setMessage(data.message || 'BOM line added');
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to add BOM line.');
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEdge(edgeId, payload) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.patch(`/masters/${slug}/records/${recordId}/bom/edges/${edgeId}`, payload);
      markLocalBomMutation();
      setVersion(data.version);
      setTree(data.tree || []);
      setMessage(data.message || 'BOM line updated');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update BOM line.');
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEdge(edgeId, label) {
    if (!window.confirm(`Remove "${label}" and any nested lines from this BOM?`)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.delete(`/masters/${slug}/records/${recordId}/bom/edges/${edgeId}`);
      markLocalBomMutation();
      setVersion(data.version);
      setTree(data.tree || []);
      setMessage(data.message || 'BOM line removed');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to remove BOM line.');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post(`/masters/${slug}/records/${recordId}/bom/activate`, {
        version_id: version?.id,
      });
      markLocalBomMutation();
      setVersion(data.version);
      setTree(data.tree || []);
      setMessage(data.message || 'BOM activated');
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to activate BOM.');
    } finally {
      setActivating(false);
    }
  }

  async function handleViewRevision(versionId) {
    setShowHistory(false);
    await loadBom(versionId);
  }

  async function handleBackToCurrent() {
    await loadBom();
  }

  if (loading) {
    return <p className="muted">Loading BOM...</p>;
  }

  const isDraft = version?.status === 'draft';
  const viewingHistorical = version?.status === 'retired';
  const canEdit = !viewingHistorical;
  const rootExpanded = expandedIds.has(recordId);
  const rootAdding = addingParentId === recordId;
  const rootBranchOpen = rootExpanded || rootAdding;

  return (
    <div className="bom-builder">
      <div className="bom-builder-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Bill of Materials</h2>
          {version ? (
            <div className="bom-builder-meta">
              <StatusBadge status={version.status} revision={version.revision} />
              {(version.valid_from || version.valid_to) ? (
                <span className="muted" style={{ fontSize: 13 }}>
                  Valid {formatDate(version.valid_from)} — {formatDate(version.valid_to) || 'present'}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>No BOM yet — add lines below</span>
          )}
        </div>
        <div className="bom-builder-header-actions">
          <button type="button" className="neutral-button" onClick={() => setShowHistory((v) => !v)}>
            History
          </button>
          {viewingHistorical ? (
            <button type="button" className="primary-button" onClick={handleBackToCurrent}>
              Back to current
            </button>
          ) : null}
          {isDraft && !viewingHistorical ? (
            <button
              type="button"
              className="primary-button"
              disabled={activating || saving || !tree.length}
              onClick={handleActivate}
            >
              {activating ? 'Activating...' : 'Activate BOM'}
            </button>
          ) : null}
        </div>
      </div>

      {showHistory ? (
        <div className="bom-history-panel card" style={{ marginBottom: 16, padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Revision History</h3>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No revisions yet.</p>
          ) : (
            <ul className="bom-history-list">
              {history.map((rev) => (
                <li key={rev.id}>
                  <button type="button" className="bom-history-item" onClick={() => handleViewRevision(rev.id)}>
                    <StatusBadge status={rev.status} revision={rev.revision} />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDate(rev.valid_from)} — {formatDate(rev.valid_to) || 'present'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? <p className="error-message" style={{ marginBottom: 12 }}>{error}</p> : null}
      {message ? <p style={{ color: '#166534', marginBottom: 12 }}>{message}</p> : null}

      {hasActiveVersion && isDraft && !viewingHistorical ? (
        <p className="muted bom-readonly-banner">
          You are editing a draft revision. Activate it to replace the current active BOM.
        </p>
      ) : null}

      {version?.status === 'active' && !viewingHistorical ? (
        <p className="muted bom-readonly-banner">
          This BOM is active. Adding or editing lines will create a new draft revision — activate when ready.
        </p>
      ) : null}

      {viewingHistorical ? (
        <p className="bom-readonly-banner bom-readonly-banner--historical">
          Viewing historical revision {version.revision} (read-only).
        </p>
      ) : null}

      <div className="bom-tree">
        <div className="bom-tree-header-row">
          <div className="bom-tree-col bom-tree-col-item">Item</div>
          <div className="bom-tree-col bom-tree-col-type">Type</div>
          <div className="bom-tree-col bom-tree-col-qty">Qty</div>
          <div className="bom-tree-col bom-tree-col-uom">UOM</div>
          <div className="bom-tree-col bom-tree-col-notes">Notes</div>
          <div className="bom-tree-col bom-tree-col-actions">Actions</div>
        </div>

        <ul className="bom-tree-branch bom-tree-branch--root">
          <li className="bom-tree-item">
            <div className="bom-tree-row bom-tree-row--root" style={{ '--bom-depth': 0 }}>
              <div className="bom-tree-col bom-tree-col-item">
                <button
                  type="button"
                  className="bom-tree-toggle"
                  onClick={() => onToggleExpand(recordId)}
                  aria-label={rootBranchOpen ? 'Collapse root' : 'Expand root'}
                >
                  {rootBranchOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="bom-tree-label bom-tree-root-label">{recordTitle || 'Assembly'}</span>
              </div>
              <div className="bom-tree-col bom-tree-col-type">
                <TypeBadge slug="component" />
              </div>
              <div className="bom-tree-col bom-tree-col-qty"><span className="muted">—</span></div>
              <div className="bom-tree-col bom-tree-col-uom"><span className="muted">—</span></div>
              <div className="bom-tree-col bom-tree-col-notes">
                <span className="muted" style={{ fontSize: 12 }}>Root assembly</span>
              </div>
              <div className="bom-tree-col bom-tree-col-actions">
                {canEdit ? (
                  <button
                    type="button"
                    className="neutral-button bom-add-child-btn"
                    onClick={() => onOpenAddForm(recordId)}
                  >
                    <Plus size={14} /> Add line
                  </button>
                ) : null}
              </div>
            </div>

            {rootBranchOpen ? (
              <ul className="bom-tree-branch">
                {rootAdding ? (
                  <li className="bom-tree-item bom-tree-item--form" style={{ '--bom-depth': 1 }}>
                    <AddChildForm
                      parentId={recordId}
                      saving={saving}
                      onCancel={onCloseAddForm}
                      onSave={async (payload) => {
                        await handleAddChild(payload, recordId);
                        onCloseAddForm();
                      }}
                    />
                  </li>
                ) : null}

                {tree.length > 0 ? (
                  tree.map((node) => (
                    <BomTreeNode
                      key={nodeKey(node)}
                      node={node}
                      depth={1}
                      readOnly={viewingHistorical}
                      expandedIds={expandedIds}
                      onToggleExpand={onToggleExpand}
                      onOpenAddForm={onOpenAddForm}
                      addingParentId={addingParentId}
                      onCloseAddForm={onCloseAddForm}
                      editingEdgeId={editingEdgeId}
                      setEditingEdgeId={setEditingEdgeId}
                      onAddChild={handleAddChild}
                      onUpdateEdge={handleUpdateEdge}
                      onDeleteEdge={handleDeleteEdge}
                      saving={saving}
                    />
                  ))
                ) : !rootAdding ? (
                  <li className="bom-tree-item bom-tree-item--empty" style={{ '--bom-depth': 1 }}>
                    <span className="muted">No BOM lines yet — use Add line above.</span>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        </ul>
      </div>
    </div>
  );
}
