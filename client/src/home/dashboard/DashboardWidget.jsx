import { GripVertical } from 'lucide-react';
import { spanForSize } from './widgetOrder';
import WidgetSizePicker from './WidgetSizePicker';

export default function DashboardWidget({
  id,
  size = 'half',
  title,
  action,
  children,
  onDrop,
  onSizeChange,
}) {
  const span = spanForSize(size);

  return (
    <section
      className={`mes-card mes-dash-panel mes-dash-span-${span}`}
      data-size={size}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData('text/plain');
        if (from && from !== id) onDrop?.(from, id);
      }}
    >
      <header className="mes-dash-panel-head">
        <div className="mes-dash-panel-title-row">
          <span
            className="mes-dash-grip-hit"
            draggable
            title="Drag to reorder"
            aria-label="Drag to reorder"
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <GripVertical size={14} className="mes-dash-grip" aria-hidden />
          </span>
          <h2>{title}</h2>
        </div>
        <div className="mes-dash-panel-tools">
          <WidgetSizePicker id={id} size={size} onChange={(next) => onSizeChange?.(id, next)} />
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}
