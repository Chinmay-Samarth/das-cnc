import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { LayoutGrid, Plus } from 'lucide-react';
import { EmptyState } from '../components/mes';
import MasterSectionColumn from './MasterSectionColumn';
import { cloneDeep, emptyField, emptySection } from './masterBuilderUtils';

function findSectionIdForField(sections, fieldId) {
  for (const s of sections) {
    if (s.fields.some((f) => f._uid === fieldId)) return s._uid;
  }
  return null;
}

function resolveDropSectionId(over, sections) {
  if (!over) return null;
  const data = over.data?.current;
  if (data?.type === 'section-drop' || data?.type === 'section') return data.sectionId;
  if (data?.type === 'field') return findSectionIdForField(sections, over.id);
  const id = String(over.id);
  if (id.startsWith('drop-')) return id.slice(5);
  if (sections.some((s) => s._uid === id)) return id;
  return findSectionIdForField(sections, over.id);
}

export default function MasterBuilderKanban({
  sections,
  setSections,
  masterNameById,
  onRequestEditField,
  onRequestDeleteField,
  onRequestDeleteSection,
}) {
  const [activeDrag, setActiveDrag] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sectionIds = useMemo(() => sections.map((s) => s._uid), [sections]);

  function updateSection(uid, updated) {
    setSections((prev) => prev.map((s) => (s._uid === uid ? updated : s)));
  }

  function addSection() {
    setSections((prev) => [...prev, emptySection(prev.length)]);
  }

  function addField(sectionUid) {
    const section = sections.find((s) => s._uid === sectionUid);
    const f = emptyField(section?.fields.length || 0);
    onRequestEditField(f, sectionUid);
  }

  function handleDragStart(event) {
    const { active } = event;
    const type = active.data?.current?.type;
    if (type === 'field') {
      const sectionId = findSectionIdForField(sections, active.id);
      const field = sections
        .find((s) => s._uid === sectionId)
        ?.fields.find((f) => f._uid === active.id);
      setActiveDrag({ type: 'field', field: field ? cloneDeep(field) : null });
    } else if (type === 'section') {
      const section = sections.find((s) => s._uid === active.id);
      setActiveDrag({
        type: 'section',
        section: section ? { name: section.name, count: section.fields.length } : null,
      });
    }
  }

  function handleDragOver(event) {
    const { active, over } = event;
    if (!over || active.data?.current?.type !== 'field') return;

    const activeSectionId = findSectionIdForField(sections, active.id);
    const overSectionId = resolveDropSectionId(over, sections);
    if (!activeSectionId || !overSectionId || activeSectionId === overSectionId) return;

    setSections((prev) => {
      const fromIdx = prev.findIndex((s) => s._uid === activeSectionId);
      const toIdx = prev.findIndex((s) => s._uid === overSectionId);
      if (fromIdx < 0 || toIdx < 0) return prev;

      const fromSection = prev[fromIdx];
      const toSection = prev[toIdx];
      const fieldIdx = fromSection.fields.findIndex((f) => f._uid === active.id);
      if (fieldIdx < 0) return prev;

      // Already moved in a previous over event
      if (toSection.fields.some((f) => f._uid === active.id)) return prev;

      const field = fromSection.fields[fieldIdx];
      const overFieldId = over.data?.current?.type === 'field' ? over.id : null;
      let insertAt = toSection.fields.length;
      if (overFieldId) {
        const oi = toSection.fields.findIndex((f) => f._uid === overFieldId);
        if (oi >= 0) insertAt = oi;
      }

      const nextFromFields = fromSection.fields
        .filter((f) => f._uid !== active.id)
        .map((f, i) => ({ ...f, order: i }));
      const nextToFields = [...toSection.fields];
      nextToFields.splice(insertAt, 0, field);

      return prev.map((s, i) => {
        if (i === fromIdx) return { ...s, fields: nextFromFields };
        if (i === toIdx) return { ...s, fields: nextToFields.map((f, fi) => ({ ...f, order: fi })) };
        return s;
      });
    });
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);
    if (!over) return;

    const type = active.data?.current?.type;

    if (type === 'section') {
      const overSectionId =
        over.data?.current?.type === 'section'
          ? over.id
          : over.data?.current?.sectionId || resolveDropSectionId(over, sections);
      if (!overSectionId || active.id === overSectionId) return;
      setSections((prev) => {
        const oldIndex = prev.findIndex((s) => s._uid === active.id);
        const newIndex = prev.findIndex((s) => s._uid === overSectionId);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
        return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({ ...s, order: i }));
      });
      return;
    }

    if (type === 'field') {
      const activeSectionId = findSectionIdForField(sections, active.id);
      const overSectionId = resolveDropSectionId(over, sections);
      if (!activeSectionId || !overSectionId) return;

      if (activeSectionId === overSectionId) {
        setSections((prev) =>
          prev.map((s) => {
            if (s._uid !== activeSectionId) return s;
            const oldIndex = s.fields.findIndex((f) => f._uid === active.id);
            const newIndex =
              over.data?.current?.type === 'field'
                ? s.fields.findIndex((f) => f._uid === over.id)
                : s.fields.length - 1;
            if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return s;
            return {
              ...s,
              fields: arrayMove(s.fields, oldIndex, newIndex).map((f, i) => ({ ...f, order: i })),
            };
          })
        );
      }
    }
  }

  if (!sections.length) {
    return (
      <div className="mmb-empty-wrap">
        <EmptyState
          icon={LayoutGrid}
          title="No sections yet"
          description="Sections are boards. Add one, then drop field cards inside."
          actionLabel="Add your first section"
          onAction={addSection}
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="mes-kanban mmb-kanban">
        <SortableContext items={sectionIds} strategy={rectSortingStrategy}>
          {sections.map((section) => (
            <MasterSectionColumn
              key={section._uid}
              section={section}
              masterNameById={masterNameById}
              onChange={(updated) => updateSection(section._uid, updated)}
              onDelete={() => onRequestDeleteSection(section._uid)}
              onAddField={() => addField(section._uid)}
              onEditField={(field) => onRequestEditField(cloneDeep(field), section._uid)}
              onDeleteField={(fieldUid) => onRequestDeleteField(section._uid, fieldUid)}
            />
          ))}
        </SortableContext>

        <button type="button" className="mmb-add-section-col" onClick={addSection}>
          <Plus size={18} />
          <span>Add section</span>
        </button>
      </div>

      <DragOverlay>
        {activeDrag?.type === 'field' && activeDrag.field ? (
          <div className="mes-kanban-card mmb-field-card is-dragging mmb-overlay-card">
            <strong>{activeDrag.field.label || 'Field'}</strong>
            <span>{activeDrag.field.slug || '—'}</span>
          </div>
        ) : null}
        {activeDrag?.type === 'section' && activeDrag.section ? (
          <div className="mmb-overlay-section">
            <strong>{activeDrag.section.name || 'Section'}</strong>
            <span>{activeDrag.section.count} fields</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
