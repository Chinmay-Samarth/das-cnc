const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { isInspectableMasterSlug } = require('../../config/inspectableMasterSlugs');
const {
  getActivePlanForRecord,
  getLatestPlanForRecord,
  getPlanById,
  getPlanHistory,
  clonePlanRevision,
  activatePlan,
} = require('../../services/inspectionPlanEngine');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Inspection plan route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

async function getMaster(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    const e = new Error(`Master '${slug}' not found`);
    e.status = 404;
    throw e;
  }
  return data;
}

async function verifyRecordBelongsToMaster(recordId, masterId) {
  const { data, error } = await supabase
    .from('master_records')
    .select('id, master_id')
    .eq('id', recordId)
    .eq('master_id', masterId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const e = new Error('Master record not found');
    e.status = 404;
    throw e;
  }
  return data;
}

async function syncPlanChildren(planId, parameters = [], documents = []) {
  const [{ data: existingParams }, { data: existingDocs }] = await Promise.all([
    supabase.from('inspection_plan_parameters').select('id').eq('plan_id', planId),
    supabase.from('inspection_plan_documents').select('id').eq('plan_id', planId),
  ]);

  const incomingParamIds = parameters.map((p) => p.id).filter(isValidUUID);
  const incomingDocIds = documents.map((d) => d.id).filter(isValidUUID);

  const toDeleteParamIds = (existingParams || [])
    .map((p) => p.id)
    .filter((id) => !incomingParamIds.includes(id));
  const toDeleteDocIds = (existingDocs || [])
    .map((d) => d.id)
    .filter((id) => !incomingDocIds.includes(id));

  if (toDeleteParamIds.length) {
    const { error } = await supabase
      .from('inspection_plan_parameters')
      .delete()
      .in('id', toDeleteParamIds);
    if (error) throw error;
  }

  if (toDeleteDocIds.length) {
    const { error } = await supabase
      .from('inspection_plan_documents')
      .delete()
      .in('id', toDeleteDocIds);
    if (error) throw error;
  }

  for (const [idx, param] of parameters.entries()) {
    const payload = {
      plan_id: planId,
      sequence: param.sequence ?? idx + 1,
      parameter_name: param.parameter_name,
      check_type: param.check_type,
      nominal_value: param.nominal_value ?? null,
      tol_plus: param.tol_plus ?? null,
      tol_minus: param.tol_minus ?? null,
      unit: param.unit ?? null,
      instrument_required: param.instrument_required ?? null,
      is_mandatory: param.is_mandatory !== false,
    };

    if (isValidUUID(param.id)) {
      const { error } = await supabase
        .from('inspection_plan_parameters')
        .update(payload)
        .eq('id', param.id)
        .eq('plan_id', planId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('inspection_plan_parameters').insert(payload);
      if (error) throw error;
    }
  }

  for (const doc of documents) {
    const payload = {
      plan_id: planId,
      document_type: doc.document_type,
      is_mandatory: doc.is_mandatory !== false,
    };

    if (isValidUUID(doc.id)) {
      const { error } = await supabase
        .from('inspection_plan_documents')
        .update(payload)
        .eq('id', doc.id)
        .eq('plan_id', planId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('inspection_plan_documents').insert(payload);
      if (error) throw error;
    }
  }
}

router.use(verifyEmployeeAuth);

router.get('/:slug/records/:recordId/inspection-plan', wrap(async (req, res) => {
  const { slug, recordId } = req.params;

  if (!isInspectableMasterSlug(slug)) {
    return res.status(404).json({ error: 'Inspection plans are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const active = await getActivePlanForRecord(recordId);
  if (!active) {
    const latest = await getLatestPlanForRecord(recordId);
    return res.json({ plan: latest, is_active: false });
  }

  return res.json({ plan: active, is_active: true });
}));

router.get('/:slug/records/:recordId/inspection-plan/history', wrap(async (req, res) => {
  const { slug, recordId } = req.params;

  if (!isInspectableMasterSlug(slug)) {
    return res.status(404).json({ error: 'Inspection plans are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const history = await getPlanHistory(recordId);
  return res.json({ history });
}));

router.put('/:slug/records/:recordId/inspection-plan', wrap(async (req, res) => {
  const { slug, recordId } = req.params;
  const {
    plan_code,
    sampling_rule_type = 'percentage',
    sampling_rule_value = 100,
    parameters = [],
    documents = [],
  } = req.body;

  if (!isInspectableMasterSlug(slug)) {
    return res.status(404).json({ error: 'Inspection plans are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  let plan = await getLatestPlanForRecord(recordId);

  if (!plan) {
    if (!plan_code) {
      return res.status(400).json({ error: 'plan_code is required for the first plan' });
    }

    const { data: created, error } = await supabase
      .from('inspection_plans')
      .insert({
        master_record_id: recordId,
        plan_code,
        revision: 1,
        status: 'draft',
        sampling_rule_type,
        sampling_rule_value,
        created_by: req.user?.sub || null,
      })
      .select()
      .single();

    if (error) throw error;
    await syncPlanChildren(created.id, parameters, documents);
    plan = await getPlanById(created.id);
    return res.json({ plan, message: 'Inspection plan created' });
  }

  if (plan.status === 'active') {
    const { draft } = await clonePlanRevision(plan, req.user?.sub);
    const { error } = await supabase
      .from('inspection_plans')
      .update({
        plan_code: plan_code || draft.plan_code,
        sampling_rule_type,
        sampling_rule_value,
      })
      .eq('id', draft.id);

    if (error) throw error;
    await syncPlanChildren(draft.id, parameters, documents);
    const updated = await getPlanById(draft.id);
    return res.json({
      plan: updated,
      message: 'Active plan revised — new draft created',
      previous_revision: plan.revision,
    });
  }

  const { error: updateErr } = await supabase
    .from('inspection_plans')
    .update({
      plan_code: plan_code || plan.plan_code,
      sampling_rule_type,
      sampling_rule_value,
    })
    .eq('id', plan.id);

  if (updateErr) throw updateErr;
  await syncPlanChildren(plan.id, parameters, documents);
  const updated = await getPlanById(plan.id);
  return res.json({ plan: updated, message: 'Inspection plan saved' });
}));

router.post('/:slug/records/:recordId/inspection-plan/activate', wrap(async (req, res) => {
  const { slug, recordId } = req.params;
  const { plan_id: planId } = req.body;

  if (!isInspectableMasterSlug(slug)) {
    return res.status(404).json({ error: 'Inspection plans are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const targetId = planId || (await getLatestPlanForRecord(recordId))?.id;
  if (!targetId) {
    return res.status(404).json({ error: 'No inspection plan found to activate' });
  }

  const plan = await getPlanById(targetId);
  if (!plan || plan.master_record_id !== recordId) {
    return res.status(404).json({ error: 'Inspection plan not found' });
  }

  if (plan.status === 'active') {
    return res.json({ plan, message: 'Plan is already active' });
  }

  if (!plan.parameters?.length) {
    return res.status(400).json({ error: 'Plan must have at least one parameter before activation' });
  }

  const activated = await activatePlan(targetId, recordId);
  return res.json({ plan: activated, message: 'Inspection plan activated' });
}));

module.exports = router;
