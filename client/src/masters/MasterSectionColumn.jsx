import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { StatusBadge } from '../components/mes';
import MasterFieldCard from './MasterFieldCard';
import { toSlug } from './masterBuilderUtils';

export default function MasterSectionColumn({
  section,
  masterNameById,
  onChange,
  onDelete,
  onAddField,
  onEditField,
  onDeleteField,
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: section._uid,
    data: { type: 'section', sectionId: section._uid },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${section._uid}`,
    data: { type: 'section-drop', sectionId: section._uid },
  });

  const setColumnRef = (node) => {
    setSortableRef(node);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function handleNameChange(val) {
    onChange({
      ...section,
      name: val,
      slug: toSlug(val),
      _slugManual: false,
    });
  }

  const fieldIds = section.fields.map((f) => f._uid);

  return (
    <div
      ref={setColumnRef}
      style={style}
      className={`mes-kanban-col mmb-col${section.is_repeatable ? ' is-repeatable' : ''}${isDragging ? ' is-dragging' : ''}${isOver ? ' is-over' : ''}`}
    >
      <div className="mes-kanban-col-header mmb-col-header">
        <div className="mmb-col-header-top">
          <button
            type="button"
            className="mmb-grip"
            aria-label="Drag section"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={15} />
          </button>
          <StatusBadge status={section.is_repeatable ? 'active' : 'assigned'}>
            {section.is_repeatable ? 'Repeatable' : 'Flat'}
          </StatusBadge>
          <span className="count-chip">{section.fields.length}</span>
          <button
            type="button"
            className="mmb-col-delete"
            onClick={onDelete}
            title="Delete section"
            aria-label="Delete section"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <label className="mmb-col-field">
          <span>Section name</span>
          <input
            value={section.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Basic info"
          />
        </label>

        <label className="mmb-check mmb-col-repeat">
          <input
            type="checkbox"
            checked={section.is_repeatable}
            onChange={(e) => onChange({ ...section, is_repeatable: e.target.checked })}
          />
          <span>Repeatable section</span>
        </label>
      </div>

      <div ref={setDropRef} className="mes-kanban-cards mmb-col-cards">
        <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
          {section.fields.length === 0 ? (
            <div className="mmb-col-empty">Drop fields here or add one below</div>
          ) : (
            section.fields.map((field) => (
              <MasterFieldCard
                key={field._uid}
                field={field}
                masterNameById={masterNameById}
                onEdit={() => onEditField(field)}
                onDelete={() => onDeleteField(field._uid)}
              />
            ))
          )}
        </SortableContext>
      </div>

      <button type="button" className="neutral-button mmb-add-field" onClick={onAddField}>
        <Plus size={14} />
        Add field
      </button>
    </div>
  );
}
