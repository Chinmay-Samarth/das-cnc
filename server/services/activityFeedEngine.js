/**
 * Admin live activity feed — persist to Supabase, fan-out via Socket.IO.
 * Never throws into business callers (log + swallow).
 */

const { createClient } = require('@supabase/supabase-js');
const { emitActivityCreated } = require('../socket/emitter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const EVENT_TYPES = Object.freeze({
  PURCHASE_INVOICE_PUBLISHED: 'purchase_invoice_published',
  GIRN_UPLOADED: 'girn_uploaded',
  SALES_INVOICE_ISSUED: 'sales_invoice_issued',
  PURCHASE_PAYMENT_UPDATED: 'purchase_payment_updated',
  JOB_CARD_COMPLETED: 'job_card_completed',
});

/** Live feed retention window — older rows are deleted. */
const ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

const actorNameCache = new Map();

function activityCutoffIso(now = Date.now()) {
  return new Date(now - ACTIVITY_TTL_MS).toISOString();
}

/**
 * Delete events older than 24 hours. Safe to call often; never throws.
 * @returns {Promise<number>} deleted row count (best-effort)
 */
async function expireStaleActivityEvents() {
  try {
    const cutoff = activityCutoffIso();
    const { data, error } = await supabase
      .from('admin_activity_events')
      .delete()
      .lt('created_at', cutoff)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  } catch (err) {
    console.error('activityFeed expireStaleActivityEvents:', err.message || err);
    return 0;
  }
}

async function resolveActorName(actorId) {
  if (!actorId) return null;
  const key = String(actorId);
  if (actorNameCache.has(key)) return actorNameCache.get(key);
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', key)
      .maybeSingle();
    if (error) throw error;
    const name = data?.full_name || null;
    actorNameCache.set(key, name);
    return name;
  } catch (err) {
    console.error('activityFeed resolveActorName:', err.message || err);
    return null;
  }
}

/**
 * @param {{
 *   eventType: string,
 *   title: string,
 *   body?: string,
 *   entityType?: string | null,
 *   entityId?: string | null,
 *   href?: string | null,
 *   actorId?: string | null,
 *   actorName?: string | null,
 *   payload?: object,
 * }} input
 */
async function recordActivityEvent(input) {
  try {
    const eventType = String(input?.eventType || '').trim();
    const title = String(input?.title || '').trim();
    if (!eventType || !title) return null;

    let actorName = input.actorName || null;
    if (!actorName && input.actorId) {
      actorName = await resolveActorName(input.actorId);
    }

    const row = {
      event_type: eventType,
      title,
      body: String(input.body || ''),
      entity_type: input.entityType || null,
      entity_id: input.entityId != null ? String(input.entityId) : null,
      href: input.href || null,
      actor_id: input.actorId != null ? String(input.actorId) : null,
      actor_name: actorName || 'System',
      payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    };

    const { data, error } = await supabase
      .from('admin_activity_events')
      .insert(row)
      .select('*')
      .single();

    if (error) throw error;

    void expireStaleActivityEvents();
    emitActivityCreated(data);
    return data;
  } catch (err) {
    console.error('activityFeed recordActivityEvent:', err.message || err);
    return null;
  }
}

async function listActivityEvents({ limit = 40 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const cutoff = activityCutoffIso();

  // Expire anything past the window before reading
  await expireStaleActivityEvents();

  const { data, error } = await supabase
    .from('admin_activity_events')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(capped);
  if (error) throw error;
  return data || [];
}

module.exports = {
  EVENT_TYPES,
  ACTIVITY_TTL_MS,
  recordActivityEvent,
  listActivityEvents,
  expireStaleActivityEvents,
  resolveActorName,
};
