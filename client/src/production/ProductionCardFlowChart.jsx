import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TrackingFlowNode from './TrackingFlowNode';

const nodeTypes = { tracking: TrackingFlowNode };

function edgeStroke(kind) {
  if (kind === 'optional') return '#94a3b8';
  if (kind === 'rework') return '#f59e0b';
  return '#64748b';
}

export default function ProductionCardFlowChart({ flow, tracking }) {
  const trackById = useMemo(() => {
    const map = {};
    for (const t of tracking || []) map[t.node_id] = t;
    return map;
  }, [tracking]);

  const nodes = useMemo(
    () =>
      (flow?.nodes || []).map((n) => {
        const track = trackById[n.id] || {
          node_id: n.id,
          status: 'pending',
          label: n.label,
          work_center_code: n.work_center_code,
          work_center_name: n.work_center_name,
        };
        return {
          id: n.id,
          type: 'tracking',
          position: { x: Number(n.position_x) || 0, y: Number(n.position_y) || 0 },
          data: {
            ...n,
            tracking: { ...track, label: track.label || n.label },
          },
          draggable: false,
          selectable: false,
        };
      }),
    [flow?.nodes, trackById]
  );

  const edges = useMemo(
    () =>
      (flow?.edges || []).map((e) => ({
        id: e.id,
        source: e.from_node_id,
        target: e.to_node_id,
        label: e.label || undefined,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: {
          stroke: edgeStroke(e.edge_kind),
          strokeDasharray: e.edge_kind === 'optional' ? '6 4' : undefined,
          strokeWidth: 2,
        },
      })),
    [flow?.edges]
  );

  if (!nodes.length) {
    return (
      <div className="pc-track-canvas pc-track-canvas-empty">
        <p className="muted">No activity flow frozen on this card’s schedule.</p>
      </div>
    );
  }

  return (
    <div className="pc-track-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.35}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} color="rgba(15, 23, 42, 0.06)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const s = n.data?.tracking?.status;
            if (s === 'done') return '#22c55e';
            if (s === 'running') return '#3b82f6';
            if (s === 'pending') return '#eab308';
            return '#94a3b8';
          }}
        />
      </ReactFlow>
    </div>
  );
}
