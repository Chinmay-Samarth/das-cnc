/**
 * Page allowlists for peer roles (not in the Operator→Admin ladder).
 * Keep nav filtering in sync with route guards.
 */

export const FINANCE_ALLOWED_PREFIXES = [
  '/customers',
  '/suppliers',
  '/stock',
  '/girn',
  '/invoices',
  '/sales-invoices',
  '/sales-payments',
  '/production/outsource',
  '/production/dispatch',
  '/production/cards',
  '/blanket-pos',
  '/delivery-schedules',
  '/account',
];

export const FINANCE_ALLOWED_EXACT = ['/production'];

export const FINANCE_NAV_PATHS = new Set([
  '/customers',
  '/suppliers',
  '/stock',
  '/girn',
  '/invoices',
  '/sales-invoices',
  '/sales-payments',
  '/production/outsource',
  '/production/dispatch',
  '/production',
  '/blanket-pos',
  '/delivery-schedules',
]);

export const QC_ALLOWED_PREFIXES = [
  '/girn',
  '/stock',
  '/production/outsource',
  '/account',
];

export const QC_ALLOWED_EXACT = [];

export const QC_NAV_PATHS = new Set(['/girn', '/stock', '/production/outsource']);

const ROLE_ACCESS = {
  FINANCE: {
    prefixes: FINANCE_ALLOWED_PREFIXES,
    exact: FINANCE_ALLOWED_EXACT,
    navPaths: FINANCE_NAV_PATHS,
    home: '/girn',
  },
  QC: {
    prefixes: QC_ALLOWED_PREFIXES,
    exact: QC_ALLOWED_EXACT,
    navPaths: QC_NAV_PATHS,
    home: '/girn',
  },
};

export function isRestrictedRole(accessLevel) {
  return Boolean(ROLE_ACCESS[String(accessLevel || '').toUpperCase()]);
}

export function isRoleAllowedPath(accessLevel, pathname) {
  const cfg = ROLE_ACCESS[String(accessLevel || '').toUpperCase()];
  if (!cfg) return true;
  const path = String(pathname || '');
  if (cfg.exact.includes(path)) return true;
  return cfg.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function getRoleNavPaths(accessLevel) {
  return ROLE_ACCESS[String(accessLevel || '').toUpperCase()]?.navPaths || null;
}

export function getRoleHomePath(accessLevel) {
  return ROLE_ACCESS[String(accessLevel || '').toUpperCase()]?.home || null;
}

/** @deprecated prefer isRoleAllowedPath('FINANCE', pathname) */
export function isFinanceAllowedPath(pathname) {
  return isRoleAllowedPath('FINANCE', pathname);
}
