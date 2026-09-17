const HOME = '/home';

/** Section roots — back goes to /home */
const SECTION_ROOTS = new Set([
  '/employees',
  '/suppliers',
  '/customers',
  '/girn',
  '/stock',
  '/work-centers',
  '/blanket-pos',
  '/invoices',
  '/sales-invoices',
  '/production',
  '/production/today',
  '/attendance',
  '/delivery-schedules',
  '/approvals',
  '/purchase-orders',
  '/leave-requests',
  '/notifications',
]);

function isSectionRoot(pathname) {
  if (SECTION_ROOTS.has(pathname)) return true;
  // /masters/:slug (but not records or config)
  if (/^\/masters\/[^/]+$/.test(pathname)) return true;
  return false;
}

/**
 * Resolve the parent route for global back navigation.
 * Returns null only on /home (back button hidden).
 */
export function resolveParentPath(pathname, searchParams) {
  if (pathname === HOME || pathname === '/') return null;

  if (isSectionRoot(pathname)) return HOME;

  // Account settings — back to role home (via GlobalBackButton home remap)
  if (pathname === '/account/settings' || pathname.startsWith('/account/')) {
    return HOME;
  }

  // Masters config
  if (pathname.startsWith('/masters/config/')) return HOME;

  // Masters records
  const masterRecordEdit = pathname.match(/^\/masters\/([^/]+)\/records\/([^/]+)\/edit$/);
  if (masterRecordEdit) return `/masters/${masterRecordEdit[1]}/records/${masterRecordEdit[2]}`;

  const masterRecordDetail = pathname.match(/^\/masters\/([^/]+)\/records\/([^/]+)$/);
  if (masterRecordDetail) return `/masters/${masterRecordDetail[1]}`;

  const masterRecordNew = pathname.match(/^\/masters\/([^/]+)\/records\/new$/);
  if (masterRecordNew) return `/masters/${masterRecordNew[1]}`;

  // GIRN create
  if (pathname === '/girn/create') {
    if (searchParams?.get('outsource_shipment_id')) return '/production/outsource';
    return '/girn';
  }

  // Sales invoice wizard
  if (pathname === '/sales-invoices/new') return '/production/dispatch';

  // Invoice OCR review
  const invoiceReview = pathname.match(/^\/invoices\/([^/]+)\/review$/);
  if (invoiceReview) return `/invoices/${invoiceReview[1]}`;

  // Production sub-routes
  if (pathname.startsWith('/production/')) {
    if (/^\/production\/cards\/[^/]+$/.test(pathname)) return '/production';
    if (pathname === '/production/outsource') return '/production';
    if (pathname === '/production/dispatch') return '/production';
    if (pathname === '/production/horizon-planner') return '/production';
    if (pathname === '/production/campaigns') return '/production';
    if (pathname === '/production/work-centers') return '/production';
    if (pathname.startsWith('/production/wc-command/')) return '/production/today';
    return '/production';
  }

  // Purchase orders
  if (pathname === '/purchase-orders/create') return '/purchase-orders';
  const poDetail = pathname.match(/^\/purchase-orders\/([^/]+)$/);
  if (poDetail && poDetail[1] !== 'create') return '/purchase-orders';

  // Generic */:id/edit → */:id
  const editMatch = pathname.match(/^(\/[^/]+)\/([^/]+)\/edit$/);
  if (editMatch) return `${editMatch[1]}/${editMatch[2]}`;

  // Generic */add, */new
  const addMatch = pathname.match(/^(\/[^/]+)\/(add|new)$/);
  if (addMatch) return addMatch[1];

  // Supplier sub-routes: /suppliers/:id/invoices → /suppliers/:id
  const supplierInvoices = pathname.match(/^(\/suppliers\/[^/]+)\/invoices$/);
  if (supplierInvoices) return supplierInvoices[1];

  // Generic */:id (detail) → parent list
  const detailMatch = pathname.match(/^(\/[^/]+)\/([^/]+)$/);
  if (detailMatch) return detailMatch[1];

  // Fallback
  return HOME;
}
