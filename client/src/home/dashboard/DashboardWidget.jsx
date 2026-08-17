import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { allowedSizesFor, spanForSize } from './widgetOrder';
import WidgetSizePicker from './WidgetSizePicker';

function isChromeClick(target) {
  return !target.closest(
    'a, button, input, textarea, select, label, [role="button"], [role="option"], [role="menuitem"]'
  );
}

export default function DashboardWidget({
  id,
  size = 'half',
  title,
  href,
  children,
  onDrop,
  onSizeChange,
}) {
  const navigate = useNavigate();
  const span = spanForSize(size);
  const allowedSizes = allowedSizesFor(id);
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    function onForeignOpen(event) {
      if (event.detail !== id) setMenu(null);
    }
    window.addEventListener('dash-size-picker', onForeignOpen);
    return () => window.removeEventListener('dash-size-picker', onForeignOpen);
  }, [id]);

  return (
    <section
      className={`mes-card mes-dash-panel mes-dash-span-${span}${href ? ' is-clickable' : ''}`}
      data-size={size}
      onClick={(e) => {
        if (!href || !isChromeClick(e.target)) return;
        navigate(href);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('dash-size-picker', { detail: id }));
        setMenu({ x: e.clientX, y: e.clientY });
      }}
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
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <GripVertical size={14} className="mes-dash-grip" aria-hidden />
          </span>
          <h2>{title}</h2>
        </div>
      </header>
      <div className="mes-dash-panel-body">{children}</div>
      <WidgetSizePicker
        size={size}
        allowedSizes={allowedSizes}
        open={!!menu}
        x={menu?.x || 0}
        y={menu?.y || 0}
        onChange={(next) => onSizeChange?.(id, next)}
        onClose={() => setMenu(null)}
      />
    </section>
  );
}
