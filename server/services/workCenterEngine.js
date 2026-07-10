const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MACHINE_MASTER_SLUG = 'machine';

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Confirm a master_records row exists and belongs to the `machine` master.
 */
async function validateMachineRecord(machineRecordId) {
  if (!isValidUUID(machineRecordId)) {
    const err = new Error('Invalid machine_record_id');
    err.status = 400;
    throw err;
  }

  const { data: master, error: masterErr } = await supabase
    .from('masters')
    .select('id, slug, is_active')
    .eq('slug', MACHINE_MASTER_SLUG)
    .eq('is_active', true)
    .maybeSingle();

  if (masterErr) throw masterErr;
  if (!master) {
    const err = new Error("Machine master (slug 'machine') not found");
    err.status = 404;
    throw err;
  }

  const { data: record, error } = await supabase
    .from('master_records')
    .select('id, master_id')
    .eq('id', machineRecordId)
    .eq('master_id', master.id)
    .maybeSingle();

  if (error) throw error;

  if (!record) {
    const err = new Error('Machine record not found');
    err.status = 404;
    throw err;
  }

  return record;
}

/**
 * Load machines assigned to a work center, enriched with labels from v_master_lookup.
 */
async function listMachinesForCenter(workCenterId) {
  const { data: rows, error } = await supabase
    .from('work_center_machines')
    .select('*')
    .eq('work_center_id', workCenterId)
    .order('sequence', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!rows?.length) return [];

  const recordIds = rows.map((r) => r.machine_record_id);
  const { data: lookups, error: lookupErr } = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .in('record_id', recordIds);

  if (lookupErr) throw lookupErr;

  const byId = new Map((lookups || []).map((row) => [row.record_id, row]));

  return rows.map((row) => {
    const lookup = byId.get(row.machine_record_id) || {};
    return {
      id: row.id,
      work_center_id: row.work_center_id,
      machine_record_id: row.machine_record_id,
      sequence: row.sequence,
      created_at: row.created_at,
      label: lookup.label || row.machine_record_id,
      master_slug: lookup.master_slug || MACHINE_MASTER_SLUG,
    };
  });
}

/**
 * Attach department name + machines (+ optional machine_count) to a work_centers row.
 */
async function enrichWorkCenter(workCenter, { includeMachines = true } = {}) {
  if (!workCenter) return null;

  let department = null;
  if (workCenter.department_id) {
    const { data: dept, error } = await supabase
      .from('departments')
      .select('id, name')
      .eq('id', workCenter.department_id)
      .maybeSingle();

    if (error) throw error;
    department = dept?.name || null;
  }

  const machines = includeMachines
    ? await listMachinesForCenter(workCenter.id)
    : [];

  return {
    id: workCenter.id,
    name: workCenter.name,
    code: workCenter.code,
    department_id: workCenter.department_id,
    department,
    overhead_hourly_rate: Number(workCenter.overhead_hourly_rate),
    speed: Number(workCenter.speed),
    efficiency: Number(workCenter.efficiency),
    is_active: workCenter.is_active,
    created_at: workCenter.created_at,
    updated_at: workCenter.updated_at,
    machine_count: includeMachines ? machines.length : undefined,
    machines: includeMachines ? machines : undefined,
  };
}

/**
 * Machine records belonging to the `machine` master that are not yet assigned.
 */
async function listAvailableMachines(search = '') {
  const { data: master, error: masterErr } = await supabase
    .from('masters')
    .select('id')
    .eq('slug', MACHINE_MASTER_SLUG)
    .eq('is_active', true)
    .maybeSingle();

  if (masterErr) throw masterErr;
  if (!master) {
    const err = new Error("Machine master (slug 'machine') not found");
    err.status = 404;
    throw err;
  }

  const { data: assigned, error: assignedErr } = await supabase
    .from('work_center_machines')
    .select('machine_record_id');

  if (assignedErr) throw assignedErr;

  const assignedIds = new Set((assigned || []).map((r) => r.machine_record_id));

  let query = supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .eq('master_slug', MACHINE_MASTER_SLUG)
    .order('label')
    .limit(100);

  if (search && String(search).trim()) {
    query = query.ilike('label', `%${String(search).trim()}%`);
  }

  const { data: lookups, error: lookupErr } = await query;
  if (lookupErr) throw lookupErr;

  return (lookups || [])
    .filter((row) => !assignedIds.has(row.record_id))
    .map((row) => ({
      record_id: row.record_id,
      label: row.label,
      master_slug: row.master_slug,
    }));
}

async function getWorkCenterById(id) {
  if (!isValidUUID(id)) {
    const err = new Error('Invalid work center id');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('work_centers')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error('Work center not found');
    err.status = 404;
    throw err;
  }

  return enrichWorkCenter(data, { includeMachines: true });
}

async function listWorkCenters() {
  const { data, error } = await supabase
    .from('work_centers')
    .select('*')
    .order('code', { ascending: true });

  if (error) throw error;

  const centers = data || [];
  if (!centers.length) return [];

  const centerIds = centers.map((c) => c.id);
  const deptIds = [...new Set(centers.map((c) => c.department_id).filter(Boolean))];

  const [{ data: depts }, { data: machineRows, error: machineErr }] = await Promise.all([
    deptIds.length
      ? supabase.from('departments').select('id, name').in('id', deptIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('work_center_machines')
      .select('work_center_id')
      .in('work_center_id', centerIds),
  ]);

  if (machineErr) throw machineErr;

  const deptMap = new Map((depts || []).map((d) => [d.id, d.name]));
  const countMap = new Map();
  for (const row of machineRows || []) {
    countMap.set(row.work_center_id, (countMap.get(row.work_center_id) || 0) + 1);
  }

  return centers.map((wc) => ({
    id: wc.id,
    name: wc.name,
    code: wc.code,
    department_id: wc.department_id,
    department: wc.department_id ? deptMap.get(wc.department_id) || null : null,
    overhead_hourly_rate: Number(wc.overhead_hourly_rate),
    speed: Number(wc.speed),
    efficiency: Number(wc.efficiency),
    is_active: wc.is_active,
    created_at: wc.created_at,
    updated_at: wc.updated_at,
    machine_count: countMap.get(wc.id) || 0,
  }));
}

async function addMachineToCenter(workCenterId, machineRecordId, sequence) {
  await validateMachineRecord(machineRecordId);

  // Ensure work center exists
  const { data: center, error: centerErr } = await supabase
    .from('work_centers')
    .select('id')
    .eq('id', workCenterId)
    .maybeSingle();

  if (centerErr) throw centerErr;
  if (!center) {
    const err = new Error('Work center not found');
    err.status = 404;
    throw err;
  }

  // Check if already assigned elsewhere
  const { data: existing, error: existingErr } = await supabase
    .from('work_center_machines')
    .select('id, work_center_id')
    .eq('machine_record_id', machineRecordId)
    .maybeSingle();

  if (existingErr) throw existingErr;
  if (existing) {
    const err = new Error(
      existing.work_center_id === workCenterId
        ? 'Machine is already assigned to this work center'
        : 'Machine is already assigned to another work center'
    );
    err.status = 409;
    throw err;
  }

  let seq = sequence;
  if (seq == null || Number.isNaN(Number(seq)) || Number(seq) < 1) {
    const { data: maxRows, error: maxErr } = await supabase
      .from('work_center_machines')
      .select('sequence')
      .eq('work_center_id', workCenterId)
      .order('sequence', { ascending: false })
      .limit(1);

    if (maxErr) throw maxErr;
    seq = (maxRows?.[0]?.sequence || 0) + 1;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('work_center_machines')
    .insert({
      work_center_id: workCenterId,
      machine_record_id: machineRecordId,
      sequence: Number(seq),
    })
    .select('*')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      const err = new Error('Machine is already assigned to a work center');
      err.status = 409;
      throw err;
    }
    throw insertErr;
  }

  const machines = await listMachinesForCenter(workCenterId);
  const match = machines.find((m) => m.id === inserted.id);
  return match || inserted;
}

async function removeMachineFromCenter(workCenterId, machineRecordId) {
  const { data, error } = await supabase
    .from('work_center_machines')
    .delete()
    .eq('work_center_id', workCenterId)
    .eq('machine_record_id', machineRecordId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error('Machine assignment not found');
    err.status = 404;
    throw err;
  }

  return { success: true };
}

module.exports = {
  MACHINE_MASTER_SLUG,
  isValidUUID,
  validateMachineRecord,
  listMachinesForCenter,
  enrichWorkCenter,
  listAvailableMachines,
  getWorkCenterById,
  listWorkCenters,
  addMachineToCenter,
  removeMachineFromCenter,
};
