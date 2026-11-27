import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CirclePlay, GripVertical, History, Trash2, Workflow } from 'lucide-react';
import api from '../api/client';
import { appConfirm } from '../components/dialog';
import {
  AlertBanner,
  EmptyState,
  SkeletonForm,
  SlidingPillBar,
  StatusBadge,
} from '../components/mes';
import ActivityFlowNode from './ActivityFlowNode';
import { ACTIVITY_TYPES, SCHEDULABLE_TYPES, getActivityTypeMeta } from './activityFlowTypes';
import { formatDisplayDate } from '../utils/dateFormat';

const nodeTypes = { activity: ActivityFlowNode };

function FlowStatusBadge({ status, revision }) {
  if (!status) return null;
  return (
    <StatusBadge status={status}>
      {status} · rev {revision ?? '—'}
    </StatusBadge>
  );
}

function formatDate(d) {
  if (!d) return '';
  return formatDisplayDate(d);
}

function toFlowNodes(apiNodes, readOnly) {
  return (apiNodes || []).map((n) => ({
    id: n.id,
    type: 'activity',
    position: { x: Number(n.position_x) || 0, y: Number(n.position_y) || 0 },
    data: { ...n },
    draggable: !readOnly,
    selectable: true,
  }));
}

function toFlowEdges(apiEdges) {
  return (apiEdges || []).map((e) => ({
    id: e.id,
    source: e.from_node_id,
    target: e.to_node_id,
    label: e.label || undefined,
    data: { edge_kind: e.edge_kind },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: {
      stroke:
        e.edge_kind === 'optional' ? '#94a3b8' : e.edge_kind === 'rework' ? '#f59e0b' : '#64748b',
      strokeDasharray: e.edge_kind === 'optional' ? '6 4' : undefined,
    },
  }));
}

function WorkCenterSelect({ value, label, onChange, disabled }) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      api
        .get('/work-centers/lookup', { params: { search: search.trim() } })
        .then(({ data }) => setOptions(data.results || []))
        .catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [open, search]);

  return (
    <div ref={wrapRef} className="af-select">
      <button
        type="button"
        className="af-select-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label || (value ? 'Selected work center' : 'Select work center…')}
      </button>
      {open && !disabled ? (
        <div className="af-dropdown">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
          />
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange({ id: o.id, label: o.label });
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
          {!options.length ? <p className="af-dropdown-empty">No results</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function SupplierSelect({ value, label, onChange, disabled }) {
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    api
      .get('/suppliers')
      .then(({ data }) => setOptions(data.suppliers || []))
      .catch(() => setOptions([]));
  }, [open]);

  const filtered = options.filter((s) =>
    !label || true
  );

  return (
    <div ref={wrapRef} className="af-select">
      <button
        type="button"
        className="af-select-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label || (value ? 'Selected supplier' : 'Select supplier (optional)…')}
      </button>
      {open && !disabled ? (
        <div className="af-dropdown">
          <button
            type="button"
            onClick={() => {
              onChange({ id: null, label: '' });
              setOpen(false);
            }}
          >
            — None —
          </button>
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onChange({ id: s.id, label: s.name });
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NodeInspector({ node, readOnly, saving, onSave, onDelete }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!node) {
      setForm(null);
      return;
    }
    setForm({
      label: node.label || '',
      work_center_id: node.work_center_id || '',
      work_center_label: node.work_center_code
        ? `${node.work_center_code} — ${node.work_center_name || ''}`
        : '',
      setup_time_minutes: node.setup_time_minutes ?? '',
      run_time_per_unit_minutes: node.run_time_per_unit_minutes ?? '',
      queue_time_minutes: node.queue_time_minutes ?? '',
      inspection_kind: node.inspection_kind || '',
      supplier_id: node.supplier_id || '',
      supplier_label: node.supplier_name || '',
      lead_time_days: node.lead_time_days ?? '',
      min_ship_qty: node.min_ship_qty ?? '',
      notes: node.notes || '',
      edge_kind_note: '',
    });
  }, [node]);

  if (!node || !form) {
    return (
      <div className="af-inspector-empty">
        <Workflow size={22} strokeWidth={1.5} />
        <p>Select a step on the canvas</p>
      </div>
    );
  }

  const meta = getActivityTypeMeta(node.activity_type);
  const needsWc = SCHEDULABLE_TYPES.has(node.activity_type);
  const isOutsource = node.activity_type === 'outsource';
  const isInspection = node.activity_type === 'inspection';

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const payload = {
      label: form.label.trim(),
      notes: form.notes.trim() || null,
    };

    if (needsWc) {
      payload.work_center_id = form.work_center_id || null;
      payload.setup_time_minutes =
        form.setup_time_minutes === '' ? null : Number(form.setup_time_minutes);
      payload.run_time_per_unit_minutes =
        form.run_time_per_unit_minutes === '' ? null : Number(form.run_time_per_unit_minutes);
      payload.queue_time_minutes =
        form.queue_time_minutes === '' ? null : Number(form.queue_time_minutes);
    }

    if (isInspection) {
      payload.inspection_kind = form.inspection_kind || null;
    }

    if (isOutsource) {
      payload.supplier_id = form.supplier_id || null;
      payload.lead_time_days =
        form.lead_time_days === '' ? null : Number(form.lead_time_days);
      payload.min_ship_qty =
        form.min_ship_qty === '' ? null : Number(form.min_ship_qty);
    }

    await onSave(node.id, payload);
  }

  return (
    <form className="af-inspector" onSubmit={handleSave}>
      <div className="af-inspector-type" style={{ '--af-node-accent': meta.color }}>
        {meta.label}
      </div>

      <label className="af-field">
        <span className="af-field-label">Label</span>
        <input
          value={form.label}
          onChange={(e) => setField('label', e.target.value)}
          disabled={readOnly || saving}
          required
        />
      </label>

      {needsWc ? (
        <>
          <label className="af-field">
            <span className="af-field-label">Work center</span>
            <WorkCenterSelect
              value={form.work_center_id}
              label={form.work_center_label}
              disabled={readOnly || saving}
              onChange={({ id, label }) => {
                setField('work_center_id', id || '');
                setField('work_center_label', label || '');
              }}
            />
          </label>
          <div className="af-field-row">
            <label className="af-field">
              <span className="af-field-label">Setup</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.setup_time_minutes}
                onChange={(e) => setField('setup_time_minutes', e.target.value)}
                disabled={readOnly || saving}
                placeholder="min"
              />
            </label>
            <label className="af-field">
              <span className="af-field-label">Run / unit</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.run_time_per_unit_minutes}
                onChange={(e) => setField('run_time_per_unit_minutes', e.target.value)}
                disabled={readOnly || saving}
                placeholder="min"
              />
            </label>
            <label className="af-field">
              <span className="af-field-label">Queue</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.queue_time_minutes}
                onChange={(e) => setField('queue_time_minutes', e.target.value)}
                disabled={readOnly || saving}
                placeholder="min"
              />
            </label>
          </div>
        </>
      ) : null}

      {isInspection ? (
        <label className="af-field">
          <span className="af-field-label">Inspection kind</span>
          <select
            value={form.inspection_kind}
            onChange={(e) => setField('inspection_kind', e.target.value)}
            disabled={readOnly || saving}
          >
            <option value="">—</option>
            <option value="in_process">In-process</option>
            <option value="final">Final</option>
          </select>
        </label>
      ) : null}

      {isOutsource ? (
        <>
          <label className="af-field">
            <span className="af-field-label">Supplier</span>
            <SupplierSelect
              value={form.supplier_id}
              label={form.supplier_label}
              disabled={readOnly || saving}
              onChange={({ id, label }) => {
                setField('supplier_id', id || '');
                setField('supplier_label', label || '');
              }}
            />
          </label>
          <div className="af-field-row">
            <label className="af-field">
              <span className="af-field-label">Lead days *</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.lead_time_days}
                onChange={(e) => setField('lead_time_days', e.target.value)}
                disabled={readOnly || saving}
                required
              />
            </label>
            <label className="af-field">
              <span className="af-field-label">Min ship *</span>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={form.min_ship_qty}
                onChange={(e) => setField('min_ship_qty', e.target.value)}
                disabled={readOnly || saving}
                required
              />
            </label>
          </div>
        </>
      ) : null}

      <label className="af-field">
        <span className="af-field-label">Notes</span>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          disabled={readOnly || saving}
        />
      </label>

      {!readOnly ? (
        <div className="af-inspector-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="af-icon-danger"
            disabled={saving}
            onClick={() => onDelete(node.id)}
            title="Delete node"
            aria-label="Delete node"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ) : null}
    </form>
  );
}

export default function ActivityFlowBuilder({ slug, recordId }) {
  const base = `/masters/${slug}/records/${recordId}/activity-flow`;

  const [version, setVersion] = useState(null);
  const [apiNodes, setApiNodes] = useState([]);
  const [apiEdges, setApiEdges] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [hasActive, setHasActive] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const layoutTimer = useRef(null);
  const applyingRemote = useRef(false);
  /** True while keyboard/API node delete is in flight — skip cascade edge DELETE calls */
  const deletingNodesRef = useRef(false);
  const [flowDeleteKeys, setFlowDeleteKeys] = useState(['Backspace', 'Delete']);
  const [rfInstance, setRfInstance] = useState(null);
  const [draggingType, setDraggingType] = useState(null);

  // Don't let Delete/Backspace remove canvas nodes while typing in the inspector
  useEffect(() => {
    function isEditableTarget(el) {
      if (!el || !(el instanceof Element)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable ||
        !!el.closest('.af-inspector-panel')
      );
    }
    function syncDeleteKeys() {
      setFlowDeleteKeys(isEditableTarget(document.activeElement) ? null : ['Backspace', 'Delete']);
    }
    document.addEventListener('focusin', syncDeleteKeys);
    document.addEventListener('focusout', syncDeleteKeys);
    syncDeleteKeys();
    return () => {
      document.removeEventListener('focusin', syncDeleteKeys);
      document.removeEventListener('focusout', syncDeleteKeys);
    };
  }, []);

  const applyPayload = useCallback((data) => {
    applyingRemote.current = true;
    setVersion(data.version || null);
    setApiNodes(data.nodes || []);
    setApiEdges(data.edges || []);
    setReadOnly(!!data.read_only || data.version?.status === 'active' || data.version?.status === 'retired');
    setHasActive(!!data.has_active_version || data.version?.status === 'active');
    setNodes(toFlowNodes(data.nodes || [], !!data.read_only || data.version?.status !== 'draft'));
    setEdges(toFlowEdges(data.edges || []));
    setTimeout(() => {
      applyingRemote.current = false;
    }, 0);
  }, [setNodes, setEdges]);

  const loadFlow = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await api.get(base);
      applyPayload(data);
    } catch (err) {
      console.error('Failed to load activity flow:', err);
      setError(err.response?.data?.error || 'Unable to load activity flow');
    } finally {
      setLoading(false);
    }
  }, [base, applyPayload]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get(`${base}/history`);
      setHistory(data.history || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, [base]);

  useEffect(() => {
    loadFlow();
    loadHistory();
  }, [loadFlow, loadHistory]);

  const selectedNode = useMemo(
    () => apiNodes.find((n) => n.id === selectedNodeId) || null,
    [apiNodes, selectedNodeId]
  );

  async function ensureEditable() {
    if (version?.status === 'draft') return true;
    setSaving(true);
    try {
      const { data } = await api.post(`${base}/ensure-draft`);
      applyPayload(data);
      await loadHistory();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create draft');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddType(activityType, position) {
    const ok = readOnly ? await ensureEditable() : true;
    if (!ok && readOnly) return;

    setSaving(true);
    setError(null);
    try {
      const meta = getActivityTypeMeta(activityType);
      const payload = {
        activity_type: activityType,
        label: meta.label,
        position_x: Number.isFinite(position?.x) ? position.x : 280,
        position_y: Number.isFinite(position?.y)
          ? position.y
          : 40 + apiNodes.length * 140,
      };
      if (activityType === 'outsource') {
        payload.lead_time_days = 1;
        payload.min_ship_qty = 1;
      }
      if (activityType === 'inspection') {
        payload.inspection_kind = 'in_process';
      }
      const { data } = await api.post(`${base}/nodes`, payload);
      applyPayload(data);
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to add node');
    } finally {
      setSaving(false);
    }
  }

  function onPaletteDragStart(event, activityType) {
    if (saving) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('application/af-activity', activityType);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingType(activityType);
  }

  function onPaletteDragEnd() {
    setDraggingType(null);
  }

  function onCanvasDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onCanvasDrop(event) {
    event.preventDefault();
    setDraggingType(null);
    const activityType = event.dataTransfer.getData('application/af-activity');
    if (!activityType || saving) return;

    const position = rfInstance?.screenToFlowPosition
      ? rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: event.clientX, y: event.clientY };

    handleAddType(activityType, position);
  }

  async function handleConnect(connection) {
    if (readOnly) {
      const ok = await ensureEditable();
      if (!ok) return;
    }
    if (!connection.source || !connection.target) return;

    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post(`${base}/edges`, {
        from_node_id: connection.source,
        to_node_id: connection.target,
        edge_kind: 'default',
      });
      applyPayload(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to connect nodes');
      // revert optimistic local edge if any
      await loadFlow();
    } finally {
      setSaving(false);
    }
  }

  const onConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
      handleConnect(connection);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly, version, apiNodes]
  );

  function scheduleLayoutSave(nextNodes) {
    if (readOnly || applyingRemote.current) return;
    clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(async () => {
      try {
        await api.patch(`${base}/layout`, {
          nodes: nextNodes.map((n) => ({
            id: n.id,
            x: n.position.x,
            y: n.position.y,
          })),
        });
      } catch (err) {
        console.error('Layout save failed:', err);
      }
    }, 400);
  }

  function handleNodesChange(changes) {
    onNodesChange(changes);
    if (readOnly || applyingRemote.current) return;
    const moved = changes.some((c) => c.type === 'position' && c.dragging === false);
    if (moved) {
      setNodes((current) => {
        scheduleLayoutSave(current);
        return current;
      });
    }
  }

  async function handleSaveNode(nodeId, payload) {
    setSaving(true);
    setError(null);
    try {
      if (readOnly) {
        const ok = await ensureEditable();
        if (!ok) return;
      }
      const { data } = await api.patch(`${base}/nodes/${nodeId}`, payload);
      applyPayload(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update node');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteNode(nodeId) {
    if (
      !(await appConfirm({
        title: 'Delete activity node',
        message: 'Delete this activity node? Connected edges will also be removed.',
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return;
    setSaving(true);
    setError(null);
    deletingNodesRef.current = true;
    try {
      if (readOnly) {
        const ok = await ensureEditable();
        if (!ok) return;
      }
      const { data } = await api.delete(`${base}/nodes/${nodeId}`);
      applyPayload(data);
      setSelectedNodeId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to delete node');
      await loadFlow();
    } finally {
      deletingNodesRef.current = false;
      setSaving(false);
    }
  }

  /** Keyboard / canvas delete — must persist via API (local-only remove was restoring the node). */
  async function handleNodesDelete(deleted) {
    if (readOnly || applyingRemote.current || !deleted?.length) {
      if (deleted?.length) await loadFlow();
      return;
    }

    // Set early so concurrent onEdgesDelete (RF also removes connected edges) skips API calls
    deletingNodesRef.current = true;

    if (
      !(await appConfirm({
        title: 'Delete activity nodes',
        message:
          deleted.length === 1
            ? 'Delete this activity node? Connected edges will also be removed.'
            : `Delete ${deleted.length} activity nodes? Connected edges will also be removed.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    ) {
      deletingNodesRef.current = false;
      await loadFlow();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let lastPayload = null;
      for (const node of deleted) {
        const { data } = await api.delete(`${base}/nodes/${node.id}`);
        lastPayload = data;
      }
      if (lastPayload) applyPayload(lastPayload);
      setSelectedNodeId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to delete node');
      await loadFlow();
    } finally {
      deletingNodesRef.current = false;
      setSaving(false);
    }
  }

  async function handleEdgesDelete(deleted) {
    if (readOnly || applyingRemote.current || !deleted?.length) return;
    // Let onNodesDelete set deletingNodesRef first when node+edges are removed together
    await Promise.resolve();
    if (deletingNodesRef.current) return;

    for (const edge of deleted) {
      try {
        const { data } = await api.delete(`${base}/edges/${edge.id}`);
        applyPayload(data);
      } catch (err) {
        setError(err.response?.data?.error || 'Unable to delete connection');
        await loadFlow();
      }
    }
  }

  async function handleActivate() {
    if (
      !(await appConfirm({
        title: 'Activate activity flow',
        message:
          'Activate this draft activity flow? The current active version (if any) will be retired.',
        confirmLabel: 'Activate',
        tone: 'warning',
      }))
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.post(`${base}/activate`);
      applyPayload(data);
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to activate');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkeleton() {
    setSaving(true);
    setError(null);
    try {
      if (readOnly || !version) {
        await api.post(`${base}/ensure-draft`);
      }
      const { data } = await api.post(`${base}/skeleton`);
      applyPayload(data);
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to insert skeleton');
    } finally {
      setSaving(false);
    }
  }

  async function handleViewVersion(versionId) {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.get(`${base}/versions/${versionId}`);
      applyPayload(data);
      setShowHistory(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load version');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <SkeletonForm embedded showHeader={false} />;
  }

  const viewTab = showHistory ? 'history' : 'flow';

  return (
    <div className="af-builder">
      <div className="af-toolbar">
        <div className="af-toolbar-left">
          <h2 className="af-title">Flow Chart</h2>
          {version ? (
            <FlowStatusBadge status={version.status} revision={version.revision} />
          ) : (
            <span className="af-empty-chip">No flow yet</span>
          )}
        </div>

        <div className="af-toolbar-right">
          <SlidingPillBar className="mes-view-toggle" role="group" aria-label="Flow view">
            <button
              type="button"
              className={`mes-view-toggle-btn${viewTab === 'flow' ? ' is-active' : ''}`}
              onClick={() => setShowHistory(false)}
            >
              Flow
            </button>
            <button
              type="button"
              className={`mes-view-toggle-btn${viewTab === 'history' ? ' is-active' : ''}`}
              onClick={() => setShowHistory(true)}
            >
              History
            </button>
          </SlidingPillBar>

          {!showHistory ? (
            <div className="af-toolbar-actions">
              {!apiNodes.length ? (
                <button type="button" className="neutral-button" onClick={handleSkeleton} disabled={saving}>
                  Insert skeleton
                </button>
              ) : null}
              {version?.status === 'draft' ? (
                <button type="button" className="primary-button" onClick={handleActivate} disabled={saving}>
                  <CirclePlay size={16} />
                  Activate
                </button>
              ) : null}
              {readOnly && version?.status === 'active' ? (
                <button type="button" className="neutral-button" onClick={ensureEditable} disabled={saving}>
                  Edit draft
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      {hasActive && version?.status === 'draft' && !showHistory ? (
        <AlertBanner tone="amber">
          An active version is live. Activate this draft when ready to replace it.
        </AlertBanner>
      ) : null}

      {showHistory ? (
        <section className="af-history">
          {history.length === 0 ? (
            <EmptyState
              icon={History}
              title="No revisions yet"
              description="Save and activate a flow to start revision history."
            />
          ) : (
            <div className="af-history-list">
              {history.map((rev) => (
                <button
                  key={rev.id}
                  type="button"
                  className={`af-history-row${rev.id === version?.id ? ' is-current' : ''}`}
                  onClick={() => handleViewVersion(rev.id)}
                >
                  <div className="af-history-title-row">
                    <strong>Revision {rev.revision}</strong>
                    <FlowStatusBadge status={rev.status} revision={rev.revision} />
                    {rev.id === version?.id ? <span className="af-history-current">Current</span> : null}
                  </div>
                  <span className="af-history-meta">
                    {formatDate(rev.valid_from) || '—'} — {formatDate(rev.valid_to) || 'present'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="af-add-row" role="group" aria-label="Drag activities onto canvas">
            <span className="af-add-label">
              <GripVertical size={14} />
              Drag
            </span>
            <div className="af-add-chips">
              {ACTIVITY_TYPES.map((t) => (
                <div
                  key={t.value}
                  className={`af-chip${draggingType === t.value ? ' is-dragging' : ''}${saving ? ' is-disabled' : ''}`}
                  style={{ '--af-chip-color': t.color }}
                  draggable={!saving}
                  onDragStart={(e) => onPaletteDragStart(e, t.value)}
                  onDragEnd={onPaletteDragEnd}
                  title={readOnly ? `Drag to canvas (creates a new draft)` : `Drag ${t.label} onto the canvas`}
                >
                  <GripVertical size={12} className="af-chip-grip" aria-hidden />
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          <div className="af-workspace">
            <div
              className={`af-canvas-wrap${draggingType ? ' is-drop-target' : ''}`}
              onDragOver={onCanvasDragOver}
              onDrop={onCanvasDrop}
            >
              {!apiNodes.length ? (
                <div className="af-canvas-empty">
                  <EmptyState
                    icon={Workflow}
                    title="Drop activities here"
                    description="Drag a task from above onto the canvas, or insert a starter skeleton."
                    actionLabel="Insert skeleton"
                    onAction={handleSkeleton}
                  />
                </div>
              ) : null}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodesDelete={handleNodesDelete}
                onEdgesDelete={handleEdgesDelete}
                onSelectionChange={({ nodes: sel }) => {
                  setSelectedNodeId(sel?.[0]?.id || null);
                }}
                onInit={setRfInstance}
                nodeTypes={nodeTypes}
                fitView
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable
                deleteKeyCode={readOnly ? null : flowDeleteKeys}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1} color="#e2e8f0" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            <aside className="af-inspector-panel">
              <div className="af-panel-title">Properties</div>
              <NodeInspector
                node={selectedNode}
                readOnly={readOnly}
                saving={saving}
                onSave={handleSaveNode}
                onDelete={handleDeleteNode}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
