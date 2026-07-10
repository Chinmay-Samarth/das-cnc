import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getActivityTypeMeta } from './activityFlowTypes';

function ActivityFlowNode({ data, selected }) {
  const meta = getActivityTypeMeta(data.activity_type);
  const subtitle = [];

  if (data.work_center_code) {
    subtitle.push(data.work_center_code);
  }
  if (data.activity_type === 'outsource' && data.lead_time_days != null) {
    subtitle.push(`LT: ${data.lead_time_days}d`);
  }
  if (data.activity_type === 'inspection' && data.inspection_kind) {
    subtitle.push(data.inspection_kind === 'final' ? 'Final' : 'In-process');
  }

  return (
    <div
      className={`af-node${selected ? ' is-selected' : ''}`}
      style={{ borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Top} className="af-handle" />
      <div className="af-node-type" style={{ background: meta.color }}>
        {meta.label}
      </div>
      <div className="af-node-label">{data.label || meta.label}</div>
      {subtitle.length ? (
        <div className="af-node-meta">{subtitle.join(' · ')}</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="af-handle" />
    </div>
  );
}

export default memo(ActivityFlowNode);
