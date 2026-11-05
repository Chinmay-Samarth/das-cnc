import { useEffect, useMemo, useState } from 'react';

function readSavedIds(storageKey, availableIds, defaultIds) {
  const known = new Set(availableIds);
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (Array.isArray(raw)) {
      const kept = raw.filter((id) => known.has(id));
      if (kept.length) return kept;
    }
  } catch {
    /* ignore bad saved list */
  }
  return defaultIds.filter((id) => known.has(id));
}

/**
 * Persist selectable table columns (same pattern as dynamic master tables).
 * @param {string} storageKey
 * @param {{ id: string, label: string, section?: string, default?: boolean }[]} columns
 */
export default function useTableColumns(storageKey, columns) {
  const availableIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const defaultIds = useMemo(() => {
    const preferred = columns.filter((column) => column.default).map((column) => column.id);
    if (preferred.length) return preferred;
    return availableIds.slice(0, 5);
  }, [columns, availableIds]);

  const [selectedIds, setSelectedIds] = useState(() =>
    readSavedIds(storageKey, availableIds, defaultIds)
  );

  useEffect(() => {
    setSelectedIds(readSavedIds(storageKey, availableIds, defaultIds));
  }, [storageKey, availableIds, defaultIds]);

  const visibleColumns = useMemo(() => {
    const chosen = new Set(selectedIds);
    const shown = columns.filter((column) => chosen.has(column.id));
    return shown.length ? shown : columns.slice(0, Math.min(3, columns.length));
  }, [columns, selectedIds]);

  const columnGroups = useMemo(() => {
    const groups = [];
    for (const column of columns) {
      const name = column.section || 'Columns';
      let group = groups.find((item) => item.name === name);
      if (!group) {
        group = { name, columns: [] };
        groups.push(group);
      }
      group.columns.push(column);
    }
    return groups;
  }, [columns]);

  function persist(ids) {
    localStorage.setItem(storageKey, JSON.stringify(ids));
    setSelectedIds(ids);
  }

  function toggleColumn(id) {
    const has = selectedIds.includes(id);
    if (has && selectedIds.length === 1) return;
    persist(has ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  function resetColumns() {
    persist(defaultIds);
  }

  return {
    selectedIds,
    visibleColumns,
    columnGroups,
    toggleColumn,
    resetColumns,
  };
}
