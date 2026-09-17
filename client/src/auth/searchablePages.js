/**
 * Static page catalog for Global Search (merged with API entity results).
 * Filter with canAccessPath so restricted roles only see allowed pages.
 */
export const SEARCHABLE_PAGES = [
  {
    id: 'page-account-settings',
    title: 'Account Settings',
    subtitle: 'Change your password',
    path: '/account/settings',
    keywords: ['account', 'settings', 'password', 'change password', 'security'],
  },
  {
    id: 'page-girn',
    title: 'GIRN',
    subtitle: 'Goods inward receipts',
    path: '/girn',
    keywords: ['girn', 'goods inward', 'receipt'],
  },
  {
    id: 'page-stock',
    title: 'Stock',
    subtitle: 'Inventory balances',
    path: '/stock',
    keywords: ['stock', 'inventory'],
  },
  {
    id: 'page-outsource',
    title: 'Outsourcing',
    subtitle: 'Outsource shipments',
    path: '/production/outsource',
    keywords: ['outsourcing', 'outsource'],
  },
  {
    id: 'page-dispatch',
    title: 'Ready for Dispatch',
    subtitle: 'Dispatch queue',
    path: '/production/dispatch',
    keywords: ['dispatch', 'ready for dispatch'],
  },
  {
    id: 'page-production',
    title: 'Production',
    subtitle: 'Production board',
    path: '/production',
    keywords: ['production', 'shop floor'],
  },
  {
    id: 'page-customers',
    title: 'Customers',
    path: '/customers',
    keywords: ['customers', 'customer'],
  },
  {
    id: 'page-suppliers',
    title: 'Suppliers',
    path: '/suppliers',
    keywords: ['suppliers', 'supplier', 'vendor'],
  },
  {
    id: 'page-invoices',
    title: 'Purchase Invoices',
    path: '/invoices',
    keywords: ['purchase invoices', 'invoices', 'invoice'],
  },
  {
    id: 'page-sales-invoices',
    title: 'Sales Invoices',
    path: '/sales-invoices',
    keywords: ['sales invoices', 'sales'],
  },
  {
    id: 'page-sales-payments',
    title: 'Sales Payments',
    path: '/sales-payments',
    keywords: ['sales payments', 'payments', 'receipt'],
  },
  {
    id: 'page-purchase-payments',
    title: 'Purchase Payments',
    path: '/purchase-payments',
    keywords: ['purchase payments', 'payments'],
  },
  {
    id: 'page-blanket-pos',
    title: 'Blanket POs',
    path: '/blanket-pos',
    keywords: ['blanket', 'po', 'purchase order'],
  },
  {
    id: 'page-delivery-schedules',
    title: 'Delivery Schedules',
    path: '/delivery-schedules',
    keywords: ['delivery', 'schedules'],
  },
  {
    id: 'page-employees',
    title: 'Employees',
    path: '/employees',
    keywords: ['employees', 'people', 'staff'],
  },
  {
    id: 'page-attendance',
    title: 'Attendance',
    path: '/attendance',
    keywords: ['attendance', 'punch'],
  },
  {
    id: 'page-leave',
    title: 'Leave Requests',
    path: '/leave-requests',
    keywords: ['leave', 'leave requests'],
  },
  {
    id: 'page-payroll',
    title: 'Payroll',
    path: '/payroll',
    keywords: ['payroll', 'salary'],
  },
  {
    id: 'page-approvals',
    title: 'Approvals',
    path: '/approvals',
    keywords: ['approvals', 'approve'],
  },
  {
    id: 'page-home',
    title: 'Home',
    path: '/home',
    keywords: ['home', 'dashboard'],
  },
  {
    id: 'page-my-today',
    title: 'My Today',
    path: '/production/today',
    keywords: ['my today', 'today'],
  },
];

export function searchPages(query, canAccessPath) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  return SEARCHABLE_PAGES.filter((page) => {
    if (typeof canAccessPath === 'function' && !canAccessPath(page.path)) return false;
    const haystack = [page.title, page.subtitle, ...(page.keywords || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  }).map((page) => ({
    type: 'page',
    typeLabel: 'Page',
    id: page.id,
    title: page.title,
    subtitle: page.subtitle || '',
    path: page.path,
  }));
}
