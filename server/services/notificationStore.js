/**
 * Shared insert helper for persisted admin notifications (dedupe by key).
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

function todayYmd(tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

/**
 * One logical alert that reappears once per calendar day until the business
 * condition clears (e.g. invoice paid). Use a stable dedupe_key without a date.
 */
async function ensureDailyRecurringNotification(row, { today = todayYmd() } = {}) {
  const payload = { ...(row.payload || {}), nag_date: today };

  const { data: existing, error: exErr } = await supabase
    .from('notifications')
    .select('id, status, payload')
    .eq('dedupe_key', row.dedupe_key)
    .maybeSingle();
  if (exErr) throw exErr;

  if (!existing) {
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
        payload,
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

  const lastNag = existing.payload?.nag_date || null;

  if (existing.status === 'unread') {
    if (lastNag !== today) {
      const { error: upErr } = await supabase
        .from('notifications')
        .update({
          title: row.title,
          body: row.body,
          payload,
          severity: row.severity || 'warning',
          priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 2,
        })
        .eq('id', existing.id);
      if (upErr) throw upErr;
      return { created: false, refreshed: true, id: existing.id, status: 'unread' };
    }
    return { created: false, id: existing.id, status: existing.status };
  }

  // Read or dismissed — bring back once per day until paid / cleared.
  if (lastNag === today) {
    return { created: false, id: existing.id, status: existing.status };
  }

  const { error: reviveErr } = await supabase
    .from('notifications')
    .update({
      status: 'unread',
      title: row.title,
      body: row.body,
      payload,
      severity: row.severity || 'warning',
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 2,
      read_at: null,
      dismissed_at: null,
    })
    .eq('id', existing.id);
  if (reviveErr) throw reviveErr;

  return { created: true, revived: true, id: existing.id, status: 'unread' };
}

/**
 * Clear open alerts when the underlying issue is resolved (e.g. invoice paid).
 * Matches exact keys and optional date-suffixed legacy keys (`key:YYYY-MM-DD`).
 */
async function dismissNotificationsForKeys(keys = []) {
  const list = [...new Set((keys || []).filter(Boolean).map(String))];
  if (!list.length) return { updated: 0 };

  const now = new Date().toISOString();
  let updated = 0;

  for (const key of list) {
    const { data: exact, error: exactErr } = await supabase
      .from('notifications')
      .update({ status: 'dismissed', dismissed_at: now, read_at: now })
      .eq('dedupe_key', key)
      .in('status', ['unread', 'read'])
      .select('id');
    if (exactErr) throw exactErr;
    updated += (exact || []).length;

    // Legacy daily keys: purchase_invoice_overdue:<id>:YYYY-MM-DD
    const { data: dated, error: datedErr } = await supabase
      .from('notifications')
      .update({ status: 'dismissed', dismissed_at: now, read_at: now })
      .like('dedupe_key', `${key}:%`)
      .in('status', ['unread', 'read'])
      .select('id');
    if (datedErr) throw datedErr;
    updated += (dated || []).length;
  }

  return { updated };
}

module.exports = {
  ensureNotification,
  ensureDailyRecurringNotification,
  dismissNotificationsForKeys,
  todayYmd,
};
