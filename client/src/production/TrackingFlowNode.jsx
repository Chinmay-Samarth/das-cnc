import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { getActivityTypeMeta } from '../masters/activityFlowTypes';

function formatQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function TrackingHoverCard({ track }) {
  if (!track) return null;
  const status = track.status;
  const isDone = status === 'done';
  const isRunning = status === 'running';

  return (
    <div className="pc-track-hover-card" role="tooltip">
      <div className="pc-track-hover-card-head">
        <strong>{track.label || 'Operation'}</strong>
        <span className={`pc-track-pill is-${status === 'info' ? track.phase || 'ahead' : status}`}>
          {status === 'info' ? (track.phase === 'passed' ? 'Passed' : 'Ahead') : status}
        </span>
      </div>
      {isDone ? (
        <dl className="pc-track-tip-grid">
          <div>
            <dt>Operator</dt>
            <dd>
              {track.operator_name || '—'}
              {track.operator_code ? ` (${track.operator_code})` : ''}
            </dd>
          </div>
          <div>
            <dt>Good</dt>
            <dd>{formatQty(track.good_qty)}</dd>
          </div>
          <div>
            <dt>Scrap</dt>
            <dd>{formatQty(track.scrap_qty)}</dd>
          </div>
          <div>
            <dt>Efficiency</dt>
            <dd>{track.efficiency_pct != null ? `${track.efficiency_pct}%` : '—'}</dd>
          </div>
          {track.work_center_code ? (
            <div>
              <dt>Work center</dt>
              <dd>
                {track.work_center_code}
                {track.work_center_name ? ` · ${track.work_center_name}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <dl className="pc-track-tip-grid">
          <div>
            <dt>Operator</dt>
            <dd>
              {isRunning
                ? track.operator_name
                  ? `${track.operator_name}${track.operator_code ? ` (${track.operator_code})` : ''}`
                  : 'Unassigned'
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Work center</dt>
            <dd>
              {track.work_center_code || '—'}
              {track.work_center_name ? ` · ${track.work_center_name}` : ''}
            </dd>
          </div>
          {isRunning ? (
            <div>
              <dt>Good so far</dt>
              <dd>{formatQty(track.good_qty)}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </div>
  );
}

function TrackingFlowNode({ data }) {
  const [hover, setHover] = useState(false);
  const meta = getActivityTypeMeta(data.activity_type);
  const track = data.tracking || {};
  const status = track.status || 'pending';
  const phaseClass =
    status === 'info' ? `is-info is-${track.phase || 'ahead'}` : `is-${status}`;

  const subtitle = [];
  if (track.work_center_code) subtitle.push(track.work_center_code);
  if (status === 'done' || status === 'running') {
    subtitle.push(`Good ${formatQty(track.good_qty)}`);
  }

  return (
    <div
      className={`pc-track-node nodrag nopan ${phaseClass}${hover ? ' is-hover' : ''}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {hover ? <TrackingHoverCard track={track} /> : null}
      <Handle
        type="target"
        position={Position.Top}
        className="af-handle pc-track-handle"
        isConnectable={false}
      />
      <div className="pc-track-node-body">
        <div className="pc-track-node-type">{meta.label}</div>
        <div className="pc-track-node-label">{data.label || meta.label}</div>
        {subtitle.length ? <div className="pc-track-node-meta">{subtitle.join(' · ')}</div> : null}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="af-handle pc-track-handle"
        isConnectable={false}
      />
    </div>
  );
}

export default memo(TrackingFlowNode);
