const STORAGE_KEY = 'das-admin-dashboard-kpi-tiles-v2';

/** Sparkline KPI strip — finance / quality / delivery / labor / spend */
export const KPI_IDS = [
  'revenue',
  'scrap_rate',
  'delivery_risk',
  'attendance',
  'open_po',
];

export const DEFAULT_KPI_ORDER = [...KPI_IDS];

export function readKpiOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_KPI_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_KPI_ORDER];
    const known = new Set(KPI_IDS);
    const seen = new Set();
    const next = [];
    for (const id of parsed) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    for (const id of KPI_IDS) {
      if (!seen.has(id)) next.push(id);
    }
    return next.length ? next : [...DEFAULT_KPI_ORDER];
  } catch {
    return [...DEFAULT_KPI_ORDER];
  }
}

export function saveKpiOrder(order) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

export function resetKpiOrder() {
  const next = [...DEFAULT_KPI_ORDER];
  saveKpiOrder(next);
  return next;
}
