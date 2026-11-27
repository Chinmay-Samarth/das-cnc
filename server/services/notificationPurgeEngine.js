const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Purge old personal ledger rows (read/dismissed) and master notifications that
 * were business-dismissed long ago. Unread personal items are never removed.
 */
async function purgeOpenedNotifications({ olderThanDays = 30 } = {}) {
  const days = Math.max(1, Number(olderThanDays) || 30);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  let statesDeleted = 0;
  try {
    const { data: states, error: stateErr } = await supabase
      .from('notification_user_states')
      .delete()
      .in('status', ['read', 'dismissed'])
      .lt('updated_at', cutoff)
      .select('id');
    if (stateErr) throw stateErr;
    statesDeleted = (states || []).length;
  } catch (err) {
    if (!/notification_user_states|does not exist|42P01/i.test(String(err.message || ''))) {
      throw err;
    }
  }

  const { data: masters, error } = await supabase
    .from('notifications')
    .delete()
    .eq('audience', 'admin')
    .eq('status', 'dismissed')
    .lt('created_at', cutoff)
    .select('id');
  if (error) throw error;

  return {
    deleted: statesDeleted + (masters || []).length,
    statesDeleted,
    mastersDeleted: (masters || []).length,
    cutoff,
    olderThanDays: days,
  };
}

module.exports = { purgeOpenedNotifications };
