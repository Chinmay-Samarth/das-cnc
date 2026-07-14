import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '../api/client';
import ActivityFlowNode from './ActivityFlowNode';
import { ACTIVITY_TYPES, SCHEDULABLE_TYPES, getActivityTypeMeta } from './activityFlowTypes';
import { formatDisplayDate } from '../utils/dateFormat';

const nodeTypes = { activity: ActivityFlowNode };

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
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="af-select-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{color: 'black'}}
      >
        {label || (value ? 'Selected work center' : 'Select work center...')}
      </button>
      {open && !disabled ? (
        <div className="af-dropdown">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."

          />
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange({ id: o.id, label: o.label });
                setOpen(false);
              }}
              style={{color: 'black'}}
            >
              {o.label}
            </button>
          ))}
          {!options.length ? <p className="muted" style={{ padding: 8, margin: 0 }}>No results</p> : null}
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
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="af-select-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{color: 'black'}}
      >
        {label || (value ? 'Selected supplier' : 'Select supplier (optional)...')}
      </button>
      {open && !disabled ? (
        <div className="af-dropdown">
          <button
            type="button"
            onClick={() => {
              onChange({ id: null, label: '' });
              setOpen(false);
            }}
            style={{color: 'black'}}
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
              style={{color: 'black'}}
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
      notes: node.notes || '',
      edge_kind_note: '',
    });
  }, [node]);

  if (!node || !form) {
    return (
      <div className="af-inspector-empty">
        <p className="muted">Select a node to edit its properties.</p>
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
    }

    await onSave(node.id, payload);
  }

  return (
    <form className="af-inspector" onSubmit={handleSave}>
      <div className="af-inspector-type" style={{ borderColor: meta.color }}>
        {meta.label}
      </div>

      <label>
        <span className="employee-detail-label">Label</span>
        <input
          value={form.label}
          onChange={(e) => setField('label', e.target.value)}
          disabled={readOnly || saving}
          required
        />
      </label>

      {needsWc ? (
        <>
          <label>
            <span className="employee-detail-label">Work center</span>
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
          <label>
            <span className="employee-detail-label">Setup (min)</span>
            <input
              type="number"
              min="0"
              step="any"
              value={form.setup_time_minutes}
              onChange={(e) => setField('setup_time_minutes', e.target.value)}
              disabled={readOnly || saving}
            />
          </label>
          <label>
            <span className="employee-detail-label">Run / unit (min)</span>
            <input
              type="number"
              min="0"
              step="any"
              value={form.run_time_per_unit_minutes}
              onChange={(e) => setField('run_time_per_unit_minutes', e.target.value)}
              disabled={readOnly || saving}
            />
          </label>
          <label>
            <span className="employee-detail-label">Queue (min)</span>
            <input
              type="number"
              min="0"
              step="any"
              value={form.queue_time_minutes}
              onChange={(e) => setField('queue_time_minutes', e.target.value)}
              disabled={readOnly || saving}
            />
          </label>
        </>
      ) : null}

      {isInspection ? (
        <label>
          <span className="employee-detail-label">Inspection kind</span>
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
          <label>
            <span className="employee-detail-label">Supplier</span>
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
          <label>
            <span className="employee-detail-label">
              Lead time (days) <span style={{ color: '#b91c1c' }}>*</span>
            </span>
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
        </>
      ) : null}

      <label>
        <span className="employee-detail-label">Notes</span>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          disabled={readOnly || saving}
        />
      </label>

      {!readOnly ? (
        <div className="af-inspector-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="neutral-button"
            disabled={saving}
            onClick={() => onDelete(node.id)}
          >
            Delete node
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

  async function handleAddType(activityType) {
    const ok = readOnly ? await ensureEditable() : true;
    if (!ok && readOnly) return;

    setSaving(true);
    setError(null);
    try {
      const meta = getActivityTypeMeta(activityType);
      const payload = {
        activity_type: activityType,
        label: meta.label,
        position_x: 280,
        position_y: 40 + apiNodes.length * 140,
      };
      if (activityType === 'outsource') {
        payload.lead_time_days = 1;
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
    if (!window.confirm('Delete this activity node? Connected edges will also be removed.')) return;
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
      !window.confirm(
        deleted.length === 1
          ? 'Delete this activity node? Connected edges will also be removed.'
          : `Delete ${deleted.length} activity nodes? Connected edges will also be removed.`
      )
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
    if (!window.confirm('Activate this draft activity flow? The current active version (if any) will be retired.')) {
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
    return <p className="muted">Loading activity flow...</p>;
  }

  return (
    <div className="af-builder">
      <div className="af-toolbar">
        <div className="af-toolbar-left">
          <h2 style={{ margin: 0, fontSize: 18 }}>Activity Flow</h2>
          {version ? (
            <StatusBadge status={version.status} revision={version.revision} />
          ) : (
            <span className="muted">No flow yet</span>
          )}
          {hasActive && version?.status === 'draft' ? (
            <span className="muted" style={{ fontSize: 12 }}>Active version exists</span>
          ) : null}
        </div>
        <div className="af-toolbar-right">
          <button type="button" className="neutral-button" onClick={() => setShowHistory((v) => !v)}>
            History
          </button>
          {!apiNodes.length ? (
            <button type="button" className="neutral-button" onClick={handleSkeleton} disabled={saving}>
              Insert skeleton
            </button>
          ) : null}
          {version?.status === 'draft' ? (
            <button type="button" className="primary-button" onClick={handleActivate} disabled={saving}>
              Activate
            </button>
          ) : null}
          {readOnly && version?.status === 'active' ? (
            <button type="button" className="neutral-button" onClick={ensureEditable} disabled={saving}>
              Edit (new draft)
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="error-message">{error}</p> : null}

      {showHistory ? (
        <div className="bom-history-panel card" style={{ marginBottom: 16, padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Revision History</h3>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No revisions yet.</p>
          ) : (
            <ul className="bom-history-list">
              {history.map((rev) => (
                <li key={rev.id}>
                  <button type="button" className="bom-history-item" onClick={() => handleViewVersion(rev.id)}>
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

      <div className="af-workspace">
        <aside className="af-palette">
          <div className="af-palette-title">Activities</div>
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className="af-palette-item"
              style={{ borderLeftColor: t.color, color: 'black' }}
              disabled={saving}
              onClick={() => handleAddType(t.value)}
              title={readOnly ? 'Will create a new draft' : 'Add to canvas'}

            >
              {t.label}
            </button>
          ))}
        </aside>

        <div className="af-canvas-wrap">
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
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : flowDeleteKeys}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap zoomable pannable />
          </ReactFlow>
        </div>

        <aside className="af-inspector-panel">
          <div className="af-palette-title">Inspector</div>
          <NodeInspector
            node={selectedNode}
            readOnly={readOnly}
            saving={saving}
            onSave={handleSaveNode}
            onDelete={handleDeleteNode}
          />
        </aside>
      </div>
    </div>
  );
}
