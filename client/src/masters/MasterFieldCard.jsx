import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil } from 'lucide-react';
import { StatusBadge } from '../components/mes';
import { fieldTypeLabel } from './masterBuilderUtils';

export default function MasterFieldCard({ field, masterNameById, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field._uid,
    data: { type: 'field', fieldId: field._uid },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const typeLabel = fieldTypeLabel(field.field_type);
  const relatedName =
    field.field_type === 'relation' && field.related_master_id
      ? masterNameById?.[field.related_master_id] || 'Linked master'
      : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mes-kanban-card mmb-field-card${isDragging ? ' is-dragging' : ''}`}
    >
      <div className="mmb-field-card-top">
        <button
          type="button"
          className="mmb-grip"
          aria-label="Drag field"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
        <div className="mmb-field-card-main">
          <span className="mmb-field-card-title">
            {field.label || <em>Unnamed field</em>}
            {field.is_required ? <span className="mmb-req">*</span> : null}
          </span>
        </div>
        <button
          type="button"
          className="mmb-field-edit"
          onClick={onEdit}
          title="Edit field"
          aria-label="Edit field"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="mmb-field-remove"
          onClick={onDelete}
          title="Delete field"
          aria-label="Delete field"
        >
          ×
        </button>
      </div>

      <div className="mmb-field-card-meta">
        <StatusBadge status="assigned">{typeLabel}</StatusBadge>
        {field.is_required ? <StatusBadge status="active">Required</StatusBadge> : null}
      </div>

      {(field.field_type === 'select' || field.field_type === 'multi_select') && field.options?.length ? (
        <div className="mmb-field-card-tags">
          {field.options.slice(0, 3).map((o) => (
            <span key={o} className="tag-chip">
              {o}
            </span>
          ))}
          {field.options.length > 3 ? (
            <span className="tag-chip mmb-tag-more">+{field.options.length - 3}</span>
          ) : null}
        </div>
      ) : null}

      {relatedName ? <p className="mmb-field-card-rel">{relatedName}</p> : null}
    </div>
  );
}
