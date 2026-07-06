const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function loadPlanChildren(planId) {
  const [{ data: parameters, error: pErr }, { data: documents, error: dErr }] = await Promise.all([
    supabase
      .from('inspection_plan_parameters')
      .select('*')
      .eq('plan_id', planId)
      .order('sequence', { ascending: true }),
    supabase
      .from('inspection_plan_documents')
      .select('*')
      .eq('plan_id', planId)
      .order('document_type', { ascending: true }),
  ]);

  if (pErr) throw pErr;
  if (dErr) throw dErr;

  return { parameters: parameters || [], documents: documents || [] };
}

async function getActivePlanForRecord(masterRecordId) {
  const { data: plan, error } = await supabase
    .from('inspection_plans')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!plan) return null;

  const children = await loadPlanChildren(plan.id);
  return { ...plan, ...children };
}

async function getPlanById(planId) {
  const { data: plan, error } = await supabase
    .from('inspection_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (error) throw error;
  if (!plan) return null;

  const children = await loadPlanChildren(plan.id);
  return { ...plan, ...children };
}

async function getLatestPlanForRecord(masterRecordId) {
  const { data: plan, error } = await supabase
    .from('inspection_plans')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!plan) return null;

  const children = await loadPlanChildren(plan.id);
  return { ...plan, ...children };
}

async function getPlanHistory(masterRecordId) {
  const { data: plans, error } = await supabase
    .from('inspection_plans')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false });

  if (error) throw error;
  return plans || [];
}

async function clonePlanRevision(activePlan, createdBy) {
  const { data: retired, error: retireErr } = await supabase
    .from('inspection_plans')
    .update({ status: 'retired' })
    .eq('id', activePlan.id)
    .select()
    .single();

  if (retireErr) throw retireErr;

  const { data: newPlan, error: insertErr } = await supabase
    .from('inspection_plans')
    .insert({
      master_record_id: activePlan.master_record_id,
      plan_code: activePlan.plan_code,
      revision: activePlan.revision + 1,
      status: 'draft',
      effective_from: null,
      sampling_rule_type: activePlan.sampling_rule_type,
      sampling_rule_value: activePlan.sampling_rule_value,
      created_by: createdBy || activePlan.created_by,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  const children = await loadPlanChildren(activePlan.id);

  if (children.parameters.length) {
    const paramRows = children.parameters.map((p) => ({
      plan_id: newPlan.id,
      sequence: p.sequence,
      parameter_name: p.parameter_name,
      check_type: p.check_type,
      nominal_value: p.nominal_value,
      tol_plus: p.tol_plus,
      tol_minus: p.tol_minus,
      unit: p.unit,
      instrument_required: p.instrument_required,
      is_mandatory: p.is_mandatory,
    }));

    const { error: pErr } = await supabase.from('inspection_plan_parameters').insert(paramRows);
    if (pErr) throw pErr;
  }

  if (children.documents.length) {
    const docRows = children.documents.map((d) => ({
      plan_id: newPlan.id,
      document_type: d.document_type,
      is_mandatory: d.is_mandatory,
    }));

    const { error: dErr } = await supabase.from('inspection_plan_documents').insert(docRows);
    if (dErr) throw dErr;
  }

  const full = await getPlanById(newPlan.id);
  return { retired, draft: full };
}

async function activatePlan(planId, masterRecordId) {
  const { error: retireErr } = await supabase
    .from('inspection_plans')
    .update({ status: 'retired' })
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active');

  if (retireErr) throw retireErr;

  const { data: activated, error: activateErr } = await supabase
    .from('inspection_plans')
    .update({
      status: 'active',
      effective_from: new Date().toISOString().slice(0, 10),
    })
    .eq('id', planId)
    .eq('master_record_id', masterRecordId)
    .select()
    .single();

  if (activateErr) throw activateErr;
  return getPlanById(activated.id);
}

module.exports = {
  loadPlanChildren,
  getActivePlanForRecord,
  getPlanById,
  getLatestPlanForRecord,
  getPlanHistory,
  clonePlanRevision,
  activatePlan,
};
