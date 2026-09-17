function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

/**
 * Map job_description → access level used across auth and workforce rules.
 * Roles: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'OPERATOR' | 'FINANCE' | 'QC'
 */
function computeAccessLevel(role) {
  const normalized = normalizeRole(role);

  if (
    normalized.includes('ADMIN') ||
    normalized.includes('MANAGING DIRECTOR') ||
    normalized === 'MD'
  ) {
    return 'ADMIN';
  }
  if (normalized.includes('FINANCE')) return 'FINANCE';
  if (normalized === 'QC' || normalized.includes('QUALITY')) return 'QC';
  if (normalized.includes('MANAGER')) return 'MANAGER';
  if (normalized.includes('SUPERVISOR')) return 'SUPERVISOR';
  return 'OPERATOR';
}

function accessLevelFromUser(user) {
  return computeAccessLevel(
    user?.access_level || user?.accessLevel || user?.job_description || user?.role
  );
}

function isAdminUser(user) {
  return accessLevelFromUser(user) === 'ADMIN';
}

function isAdminJob(role) {
  return computeAccessLevel(role) === 'ADMIN';
}

function isFinanceUser(user) {
  return accessLevelFromUser(user) === 'FINANCE';
}

function isQcUser(user) {
  return accessLevelFromUser(user) === 'QC';
}

/** Active floor workforce: active and not ADMIN (MD / Admin job titles). */
function isWorkforceEmployee(employee) {
  if (!employee) return false;
  if (employee.is_active === false) return false;
  return !isAdminJob(employee.job_description);
}

module.exports = {
  normalizeRole,
  computeAccessLevel,
  accessLevelFromUser,
  isAdminUser,
  isAdminJob,
  isFinanceUser,
  isQcUser,
  isWorkforceEmployee,
};
