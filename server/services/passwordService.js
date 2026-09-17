const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

let supabase;
function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

function assertPasswordPolicy(plain) {
  const value = String(plain || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    err.status = 400;
    throw err;
  }
  return value;
}

async function hashPassword(plain) {
  return bcrypt.hash(assertPasswordPolicy(plain), BCRYPT_ROUNDS);
}

async function verifyPassword(plain, employee) {
  if (!plain || !employee) return false;

  if (employee.password_hash) {
    return bcrypt.compare(String(plain), employee.password_hash);
  }

  if (employee.password) {
    return String(plain) === String(employee.password);
  }

  return false;
}

function sanitizeEmployee(row) {
  if (!row || typeof row !== 'object') return row;
  const { password, password_hash, ...safe } = row;
  return safe;
}

/**
 * Persist a new password hash and clear any plaintext password.
 */
async function setEmployeePassword(employeeId, plain, { mustChange = false } = {}) {
  const password_hash = await hashPassword(plain);
  const payload = {
    password_hash,
    password: null,
    must_change_password: Boolean(mustChange),
  };
  if (!mustChange) {
    payload.password_changed_at = new Date().toISOString();
  }

  const { data, error } = await getSupabase()
    .from('employees')
    .update(payload)
    .eq('id', employeeId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * After a successful plaintext login, upgrade to bcrypt and clear plaintext.
 */
async function lazyUpgradePlaintextPassword(employee, plainPassword) {
  if (!employee?.id || employee.password_hash || !employee.password) return false;
  if (String(plainPassword) !== String(employee.password)) return false;

  try {
    await setEmployeePassword(employee.id, plainPassword, {
      mustChange: Boolean(employee.must_change_password),
    });
    return true;
  } catch (err) {
    console.error('Lazy password upgrade failed:', err.message);
    return false;
  }
}

/**
 * One-shot: hash all remaining plaintext passwords.
 */
async function migratePlaintextPasswords() {
  const { data: rows, error } = await getSupabase()
    .from('employees')
    .select('id, password, password_hash')
    .not('password', 'is', null);

  if (error) {
    console.error('Password migrate query failed:', error.message);
    return { migrated: 0, failed: 0 };
  }

  const candidates = (rows || []).filter((r) => r.password && !r.password_hash);
  let migrated = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      const password_hash = await bcrypt.hash(String(row.password), BCRYPT_ROUNDS);
      const { error: updErr } = await getSupabase()
        .from('employees')
        .update({ password_hash, password: null })
        .eq('id', row.id);
      if (updErr) throw updErr;
      migrated += 1;
    } catch (err) {
      failed += 1;
      console.error(`Password migrate failed for ${row.id}:`, err.message);
    }
  }

  if (migrated || failed) {
    console.log(`Password migrate: ${migrated} upgraded, ${failed} failed`);
  }
  return { migrated, failed };
}

module.exports = {
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
  sanitizeEmployee,
  setEmployeePassword,
  lazyUpgradePlaintextPassword,
  migratePlaintextPasswords,
};
