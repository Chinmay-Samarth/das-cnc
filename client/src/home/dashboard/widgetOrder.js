const STORAGE_KEY = 'das-admin-dashboard-widget-order-v2';

export const SIZE_OPTIONS = [
  { id: 'quarter', label: 'Small', hint: 'Quarter width', span: 3, title: 'Small · 1/4 width' },
  { id: 'half', label: 'Medium', hint: 'Half width', span: 6, title: 'Medium · 1/2 width' },
  { id: 'full', label: 'Large', hint: 'Full width', span: 12, title: 'Large · full width' },
];

export const SIZE_SPAN = Object.fromEntries(SIZE_OPTIONS.map((s) => [s.id, s.span]));

const ALLOWED_SIZES = {
  attendance: ['half', 'full'],
  approvals: ['half', 'full'],
  delivery: ['full'],
  revenue: ['half', 'full'],
  yield: ['half', 'full'],
  delivery_load: ['half', 'full'],
  procurement: ['half', 'full'],
  heatmap: ['half', 'full'],
  campaigns: ['half', 'full'],
};

const DEFAULT_SIZES = {
  revenue: 'half',
  yield: 'half',
  delivery_load: 'half',
  procurement: 'half',
  campaigns: 'half',
  heatmap: 'half',
  attendance: 'half',
  delivery: 'full',
  dispatch: 'quarter',
  alerts: 'half',
  approvals: 'half',
  outsource: 'half',
  waves: 'half',
};

export const DEFAULT_WIDGET_ORDER = [
  'revenue',
  'yield',
  'delivery_load',
  'procurement',
  'campaigns',
  'heatmap',
  'attendance',
  'delivery',
  'alerts',
  'approvals',
  'dispatch',
  'outsource',
  'waves',
];

export function defaultLayout() {
  return DEFAULT_WIDGET_ORDER.map((id) => ({
    id,
    size: normalizeSize(DEFAULT_SIZES[id], id),
  }));
}

function normalizeSize(size, widgetId) {
  const allowed = allowedSizesFor(widgetId);
  if (allowed.includes(size)) return size;
  return allowed[0] || 'half';
}

export function allowedSizesFor(widgetId) {
  return ALLOWED_SIZES[widgetId] || ['quarter', 'half', 'full'];
}

function normalizeLayout(raw) {
  let items = [];
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) {
    items = raw.map((id) => ({ id, size: normalizeSize(DEFAULT_SIZES[id], id) }));
  } else if (Array.isArray(raw) && raw.every((x) => x && typeof x === 'object' && x.id)) {
    items = raw.map((x) => ({ id: x.id, size: normalizeSize(x.size, x.id) }));
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.order)) {
    const sizes = raw.sizes && typeof raw.sizes === 'object' ? raw.sizes : {};
    items = raw.order.map((id) => ({
      id,
      size: normalizeSize(sizes[id] || DEFAULT_SIZES[id], id),
    }));
  } else {
    return defaultLayout();
  }

  const known = new Set(DEFAULT_WIDGET_ORDER);
  const seen = new Set();
  const next = [];
  for (const item of items) {
    if (!known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push({ id: item.id, size: normalizeSize(item.size, item.id) });
  }
  for (const id of DEFAULT_WIDGET_ORDER) {
    if (!seen.has(id)) next.push({ id, size: normalizeSize(DEFAULT_SIZES[id], id) });
  }
  return next;
}

export function readLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

export function resetLayout() {
  const layout = defaultLayout();
  saveLayout(layout);
  return layout;
}

export function spanForSize(size) {
  return SIZE_SPAN[size] || SIZE_SPAN.half;
}
