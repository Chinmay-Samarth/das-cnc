/**
 * Page allowlists for peer roles (not in the Operator→Admin ladder).
 * Keep nav filtering in sync with route guards.
 */

export const ACCOUNTING_ALLOWED_PREFIXES = [
  '/customers',
  '/suppliers',
  '/invoices',
  '/purchase-payments',
  '/sales-invoices',
  '/sales-payments',
  '/account',
];

export const ACCOUNTING_ALLOWED_EXACT = [];

export const ACCOUNTING_NAV_PATHS = new Set([
  '/customers',
  '/suppliers',
  '/invoices',
  '/purchase-payments',
  '/sales-invoices',
  '/sales-payments',
]);

/** @deprecated use ACCOUNTING_* */
export const FINANCE_ALLOWED_PREFIXES = ACCOUNTING_ALLOWED_PREFIXES;
/** @deprecated use ACCOUNTING_* */
export const FINANCE_ALLOWED_EXACT = ACCOUNTING_ALLOWED_EXACT;
/** @deprecated use ACCOUNTING_* */
export const FINANCE_NAV_PATHS = ACCOUNTING_NAV_PATHS;

export const QC_ALLOWED_PREFIXES = [
  '/girn',
  '/stock',
  '/production/outsource',
  '/account',
];

export const QC_ALLOWED_EXACT = [];

export const QC_NAV_PATHS = new Set(['/girn', '/stock', '/production/outsource']);

const ACCOUNTING_ACCESS = {
  prefixes: ACCOUNTING_ALLOWED_PREFIXES,
  exact: ACCOUNTING_ALLOWED_EXACT,
  navPaths: ACCOUNTING_NAV_PATHS,
  home: '/invoices',
};

const ROLE_ACCESS = {
  ACCOUNTING: ACCOUNTING_ACCESS,
  // Legacy access level from older sessions / job titles
  FINANCE: ACCOUNTING_ACCESS,
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

/** @deprecated prefer isRoleAllowedPath('ACCOUNTING', pathname) */
export function isFinanceAllowedPath(pathname) {
  return isRoleAllowedPath('ACCOUNTING', pathname);
}
