/**
 * Per-user notification ledger helpers.
 * Master `notifications` = shared alert events.
 * `notification_user_states` = each employee's read/dismiss state.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return UUID_RE.test(String(value || ''));
}

function effectiveStatus(master, userState) {
  if (userState?.status) return userState.status;
  // Shared business dismiss (paid / resolved) stays hidden for everyone.
  if (master?.status === 'dismissed') return 'dismissed';
  // Pre-ledger shared read/dismiss is not attributed to a user — show as unread.
  return 'unread';
}

function withLedgerFields(master, userState) {
  const status = effectiveStatus(master, userState);
  return {
    ...master,
    status,
    read_at: userState?.read_at || null,
    dismissed_at: userState?.dismissed_at || null,
    ledger_employee_id: userState?.employee_id || null,
  };
}

function isMissingLedgerTable(err) {
  const msg = String(err?.message || err?.details || '');
  return (
    err?.code === '42P01' ||
    /notification_user_states/i.test(msg) ||
    /does not exist/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

async function loadUserStates(employeeId, notificationIds) {
  if (!isValidUUID(employeeId) || !notificationIds?.length) return new Map();
  const { data, error } = await supabase
    .from('notification_user_states')
    .select('id, notification_id, employee_id, status, read_at, dismissed_at')
    .eq('employee_id', employeeId)
    .in('notification_id', notificationIds);
  if (error) {
    if (isMissingLedgerTable(error)) return new Map();
    throw error;
  }
  return new Map((data || []).map((row) => [row.notification_id, row]));
}

/**
 * List admin notifications with this employee's personal status.
 */
async function listNotificationsForUser(employeeId, { status, category, priority, limit = 100 } = {}) {
  if (!isValidUUID(employeeId)) {
    const err = new Error('Invalid employee id');
    err.status = 400;
    throw err;
  }

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('audience', 'admin')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(Math.min(400, Math.max(limit * 3, 100)));

  if (category) query = query.eq('category', category);
  if (priority != null && priority !== '') query = query.eq('priority', Number(priority));
  // Hide globally resolved alerts for everyone.
  query = query.neq('status', 'dismissed');

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const stateById = await loadUserStates(
    employeeId,
    rows.map((r) => r.id)
  );

  let merged = rows.map((row) => withLedgerFields(row, stateById.get(row.id)));

  if (status === 'unread') {
    merged = merged.filter((n) => n.status === 'unread');
  } else if (status === 'read') {
    merged = merged.filter((n) => n.status === 'read');
  } else if (status === 'dismissed') {
    merged = merged.filter((n) => n.status === 'dismissed');
  } else {
    merged = merged.filter((n) => n.status === 'unread' || n.status === 'read');
  }

  return merged.slice(0, Math.min(200, Number(limit) || 100));
}

async function unreadCountForUser(employeeId) {
  if (!isValidUUID(employeeId)) return 0;

  const { data, error } = await supabase
    .from('notifications')
    .select('id, status')
    .eq('audience', 'admin')
    .neq('status', 'dismissed')
    .limit(500);
  if (error) throw error;

  const rows = data || [];
  if (!rows.length) return 0;

  const stateById = await loadUserStates(
    employeeId,
    rows.map((r) => r.id)
  );

  return rows.filter((row) => effectiveStatus(row, stateById.get(row.id)) === 'unread').length;
}

async function setUserNotificationStatus(employeeId, notificationId, status) {
  if (!isValidUUID(employeeId) || !isValidUUID(notificationId)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  if (!['unread', 'read', 'dismissed'].includes(status)) {
    const err = new Error('Invalid status');
    err.status = 400;
    throw err;
  }

  const { data: master, error: mErr } = await supabase
    .from('notifications')
    .select('*')
    .eq('id', notificationId)
    .eq('audience', 'admin')
    .maybeSingle();
  if (mErr) throw mErr;
  if (!master) {
    const err = new Error('Notification not found');
    err.status = 404;
    throw err;
  }
  if (master.status === 'dismissed') {
    return withLedgerFields(master, { status: 'dismissed', employee_id: employeeId });
  }

  const now = new Date().toISOString();
  const patch = {
    notification_id: notificationId,
    employee_id: employeeId,
    status,
    updated_at: now,
    read_at: status === 'unread' ? null : now,
    dismissed_at: status === 'dismissed' ? now : null,
  };
  if (status === 'read') {
    patch.dismissed_at = null;
  }

  const { data: state, error } = await supabase
    .from('notification_user_states')
    .upsert(patch, { onConflict: 'notification_id,employee_id' })
    .select('*')
    .single();
  if (error) {
    if (isMissingLedgerTable(error)) {
      const err = new Error(
        'notification_user_states table is missing. Run server/migrations/20261127_notification_user_states.sql in Supabase.'
      );
      err.status = 503;
      throw err;
    }
    throw error;
  }

  return withLedgerFields(master, state);
}

async function markAllUnreadReadForUser(employeeId) {
  const unread = await listNotificationsForUser(employeeId, { status: 'unread', limit: 200 });
  let updated = 0;
  for (const n of unread) {
    await setUserNotificationStatus(employeeId, n.id, 'read');
    updated += 1;
  }
  return { updated };
}

/** Remove from this user's opened tab (personal dismiss of read items). */
async function deleteOpenedForUser(employeeId) {
  const opened = await listNotificationsForUser(employeeId, { status: 'read', limit: 200 });
  let deleted = 0;
  for (const n of opened) {
    await setUserNotificationStatus(employeeId, n.id, 'dismissed');
    deleted += 1;
  }
  return { deleted };
}

/** Clear personal states so every admin sees the alert as unread again (daily nag). */
async function resetUserStatesForNotificationIds(notificationIds = []) {
  const ids = [...new Set((notificationIds || []).filter(isValidUUID))];
  if (!ids.length) return { deleted: 0 };
  const { data, error } = await supabase
    .from('notification_user_states')
    .delete()
    .in('notification_id', ids)
    .select('id');
  if (error) throw error;
  return { deleted: (data || []).length };
}

module.exports = {
  listNotificationsForUser,
  unreadCountForUser,
  setUserNotificationStatus,
  markAllUnreadReadForUser,
  deleteOpenedForUser,
  resetUserStatesForNotificationIds,
  effectiveStatus,
};
