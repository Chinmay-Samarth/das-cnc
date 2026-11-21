const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Permanently remove opened/dismissed notifications older than `olderThanDays`.
 * Unread alerts are never deleted by this sweep.
 */
async function purgeOpenedNotifications({ olderThanDays = 30 } = {}) {
  const days = Math.max(1, Number(olderThanDays) || 30);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('notifications')
    .delete()
    .eq('audience', 'admin')
    .in('status', ['read', 'dismissed'])
    .lt('created_at', cutoff)
    .select('id');
  if (error) throw error;
  return { deleted: (data || []).length, cutoff, olderThanDays: days };
}

module.exports = { purgeOpenedNotifications };
