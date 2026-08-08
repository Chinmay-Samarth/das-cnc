/**
 * Shared insert helper for persisted admin notifications (dedupe by key).
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Insert if dedupe_key does not already exist (any status).
 * Once dismissed, same key will not re-fire until period key changes.
 */
async function ensureNotification(row) {
  const { data: existing, error: exErr } = await supabase
    .from('notifications')
    .select('id, status')
    .eq('dedupe_key', row.dedupe_key)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) return { created: false, id: existing.id, status: existing.status };

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      audience: row.audience || 'admin',
      category: row.category || 'attendance',
      severity: row.severity || 'warning',
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 2,
      type: row.type,
      title: row.title,
      body: row.body,
      payload: row.payload || {},
      employee_id: row.employee_id || null,
      dedupe_key: row.dedupe_key,
      status: 'unread',
    })
    .select('id')
    .single();

  if (error) {
    if (String(error.code) === '23505') return { created: false };
    throw error;
  }
  return { created: true, id: data.id };
}

module.exports = {
  ensureNotification,
};
