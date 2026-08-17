/**
 * GIRN final approval queue — list, readiness check, admin notifications.
 */

const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');
const { itemInspectionComplete } = require('./girnInspectionEngine');
const { requiresInspection } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function accessLevelFromUser(user) {
  return String(user?.access_level || user?.accessLevel || user?.job_description || '').toUpperCase();
}

function canReviewGirn(user) {
  const level = accessLevelFromUser(user);
  return level === 'ADMIN' || level === 'SUPERVISOR';
}

async function loadInspectionsForItems(itemIds = []) {
  if (!itemIds.length) return {};

  const { data: inspections, error } = await supabase
    .from('girn_inspections')
    .select('*')
    .in('girn_item_id', itemIds);

  if (error) throw error;
  if (!inspections?.length) return {};

  const byItemId = {};
  for (const insp of inspections) {
    byItemId[insp.girn_item_id] = insp;
  }
  return byItemId;
}

function computeInspectionProgress(items = [], inspectionsByItem = {}) {
  const inspectable = items.filter((item) =>
    requiresInspection(item.item_category || 'raw_material')
  );
  const total = inspectable.length;
  let passed = 0;
  for (const item of inspectable) {
    const inspection = inspectionsByItem[item.id] || null;
    if (itemInspectionComplete(item, inspection)) passed += 1;
  }
  return {
    inspection_total: total,
    inspection_passed: passed,
    ready_for_approval: total > 0 && passed === total,
  };
}

async function loadGirnItemsWithProgress(girnId) {
  const { data: items, error } = await supabase
    .from('girn_items')
    .select('id, item_category, quantity, quantity_ok, quantity_not_ok')
    .eq('girn_id', girnId);

  if (error) throw error;

  const itemIds = (items || []).map((i) => i.id);
  const inspectionsByItem = await loadInspectionsForItems(itemIds);
  return computeInspectionProgress(items || [], inspectionsByItem);
}

async function isGirnReadyForApproval(girnId) {
  const { data: girn, error } = await supabase
    .from('girns')
    .select('id, status')
    .eq('id', girnId)
    .maybeSingle();

  if (error) throw error;
  if (!girn || girn.status !== 'pending_inspection') return false;

  const progress = await loadGirnItemsWithProgress(girnId);
  return progress.ready_for_approval;
}

function flattenGirnRow(row) {
  return {
    ...row,
    supplier_name: row.supplier?.name || null,
    received_by_name: row.receiver?.full_name || null,
    received_by_code: row.receiver?.employee_code || null,
    approver_name: row.approver?.full_name || null,
    approver_code: row.approver?.employee_code || null,
    rejecter_name: row.rejecter?.full_name || null,
    rejecter_code: row.rejecter?.employee_code || null,
    supplier: undefined,
    receiver: undefined,
    approver: undefined,
    rejecter: undefined,
  };
}

async function listGirnsForApproval({ status = 'ready' } = {}) {
  let query = supabase
    .from('girns')
    .select(
      `
      id, girn_number, status, received_date, created_at, updated_at, grand_total,
      approved_at, rejected_at,
      supplier:suppliers!girns_supplier_id_fkey(id, name),
      receiver:employees!girns_received_by_fkey(id, full_name, employee_code),
      approver:employees!girns_approved_by_fkey(id, full_name, employee_code),
      rejecter:employees!girns_rejected_by_fkey(id, full_name, employee_code)
    `
    )
    .order('updated_at', { ascending: false })
    .limit(200);

  if (status === 'approved') {
    query = query.eq('status', 'approved');
  } else if (status === 'rejected') {
    query = query.eq('status', 'rejected');
  } else if (status === 'all') {
    query = query.in('status', ['pending_inspection', 'approved', 'rejected']);
  } else {
    query = query.eq('status', 'pending_inspection');
  }

  const { data: girns, error } = await query;
  if (error) throw error;

  const girnIds = (girns || []).map((g) => g.id);
  if (!girnIds.length) return [];

  const { data: allItems, error: itemsError } = await supabase
    .from('girn_items')
    .select('id, girn_id, item_category, quantity, quantity_ok, quantity_not_ok')
    .in('girn_id', girnIds);

  if (itemsError) throw itemsError;

  const itemIds = (allItems || []).map((i) => i.id);
  const inspectionsByItem = await loadInspectionsForItems(itemIds);

  const itemsByGirn = {};
  for (const item of allItems || []) {
    if (!itemsByGirn[item.girn_id]) itemsByGirn[item.girn_id] = [];
    itemsByGirn[item.girn_id].push(item);
  }

  let rows = (girns || []).map((girn) => {
    const items = itemsByGirn[girn.id] || [];
    const progress = computeInspectionProgress(items, inspectionsByItem);
    return flattenGirnRow({
      ...girn,
      item_count: items.length,
      ...progress,
      queue_status:
        girn.status === 'pending_inspection'
          ? progress.ready_for_approval
            ? 'ready'
            : 'awaiting_inspection'
          : girn.status,
    });
  });

  if (status === 'ready') {
    rows = rows.filter((row) => row.queue_status === 'ready');
  } else if (status === 'awaiting_inspection') {
    rows = rows.filter((row) => row.queue_status === 'awaiting_inspection');
  }

  return rows;
}

async function notifyGirnReadyForApproval(girnId) {
  const { data: girn, error } = await supabase
    .from('girns')
    .select(
      `
      id, girn_number, status,
      supplier:suppliers!girns_supplier_id_fkey(id, name)
    `
    )
    .eq('id', girnId)
    .maybeSingle();

  if (error) throw error;
  if (!girn || girn.status !== 'pending_inspection') return { created: false };

  const label = girn.girn_number || String(girn.id).slice(0, 8);
  const supplierName = girn.supplier?.name || null;

  return ensureNotification({
    audience: 'admin',
    category: 'inventory',
    type: 'girn_ready_for_approval',
    severity: 'warning',
    priority: 2,
    title: 'GIRN ready for approval',
    body: `${label}${supplierName ? ` (${supplierName})` : ''} — all inspections passed, awaiting approval.`,
    dedupe_key: `inv:girn_ready:${girnId}`,
    payload: {
      girn_id: girnId,
      girn_number: girn.girn_number || null,
      supplier_id: girn.supplier?.id || null,
      vendor_name: supplierName,
    },
  });
}

async function maybeNotifyGirnReadyForApproval(girnId) {
  if (!(await isGirnReadyForApproval(girnId))) return { created: false };
  return notifyGirnReadyForApproval(girnId);
}

async function dismissGirnReadyNotification(girnId) {
  const dedupeKey = `inv:girn_ready:${girnId}`;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications')
    .update({ status: 'dismissed', dismissed_at: now })
    .eq('dedupe_key', dedupeKey)
    .in('status', ['unread', 'read']);
  if (error) throw error;
}

module.exports = {
  canReviewGirn,
  listGirnsForApproval,
  isGirnReadyForApproval,
  notifyGirnReadyForApproval,
  maybeNotifyGirnReadyForApproval,
  dismissGirnReadyNotification,
};
