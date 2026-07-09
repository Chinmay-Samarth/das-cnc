const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig, requiresInspection } = require('../../config/girnCategoryConfig');
const { getActivePlanForRecord } = require('../../services/inspectionPlanEngine');
const { computeSampleSize } = require('../../services/inspectionSampling');
const {
  evaluateParameterResult,
  computeOverallResult,
} = require('../../services/inspectionResultEngine');
const { assignLotToGirnItem } = require('../../services/componentLotEngine');
const { emitGirnUpdated } = require('../../socket/emitter');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

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

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function uploadInspectionFile(file, girnId, itemId) {
  const ext = file.originalname.split('.').pop();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `inspections/${girnId}/${itemId}/${filename}`;

  const { error } = await supabase.storage
    .from('master-images')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });

  if (error) throw error;

  const { data: urlData } = supabase.storage.from('master-images').getPublicUrl(storagePath);
  return urlData.publicUrl;
}

async function loadInspectionExecution(girnItemId) {
  const { data: inspection, error } = await supabase
    .from('girn_inspections')
    .select('*')
    .eq('girn_item_id', girnItemId)
    .maybeSingle();

  if (error) throw error;
  if (!inspection) return null;

  const [{ data: values }, { data: documents }] = await Promise.all([
    supabase.from('girn_inspection_values').select('*').eq('inspection_id', inspection.id),
    supabase.from('girn_inspection_documents').select('*').eq('inspection_id', inspection.id),
  ]);

  return {
    ...inspection,
    values: values || [],
    documents: documents || [],
  };
}

router.get('/:girnId/items/:itemId/inspection', verifyEmployeeAuth, async (req, res) => {
  try {
    const { girnId, itemId } = req.params;

    const { data: item, error: itemError } = await supabase
      .from('girn_items')
      .select('*')
      .eq('id', itemId)
      .eq('girn_id', girnId)
      .maybeSingle();

    if (itemError) throw itemError;
    if (!item) return res.status(404).json({ error: 'GIRN item not found' });

    const category = item.item_category || 'raw_material';
    if (!requiresInspection(category)) {
      return res.status(409).json({ error: 'This item category does not require inspection' });
    }

    const masterRecordId = item.master_record_id || item.raw_material_id;
    if (!masterRecordId) {
      return res.status(400).json({ error: 'GIRN item is not linked to a master record' });
    }

    const plan = await getActivePlanForRecord(masterRecordId);
    if (!plan) {
      return res.status(404).json({ error: 'No active inspection plan for this item' });
    }

    const lotQty = toNumber(item.quantity);
    const sampleSize = computeSampleSize(lotQty, plan.sampling_rule_type, plan.sampling_rule_value);
    const execution = await loadInspectionExecution(itemId);

    return res.json({
      plan,
      sample_size: sampleSize,
      lot_qty: lotQty,
      execution,
    });
  } catch (err) {
    console.error('GIRN inspection GET error:', err);
    return res.status(500).json({ error: err.message || 'Unable to load inspection' });
  }
});

router.post(
  '/:girnId/items/:itemId/inspection',
  verifyEmployeeAuth,
  upload.any(),
  async (req, res) => {
    try {
      const { girnId, itemId } = req.params;

      const { data: girn, error: girnError } = await supabase
        .from('girns')
        .select('id, status')
        .eq('id', girnId)
        .maybeSingle();

      if (girnError) throw girnError;
      if (!girn) return res.status(404).json({ error: 'GIRN not found' });
      if (girn.status !== 'pending_inspection') {
        return res.status(409).json({ error: 'Inspection can only be submitted when GIRN is pending inspection' });
      }

      const existing = await loadInspectionExecution(itemId);
      if (existing) {
        return res.status(409).json({ error: 'Inspection already submitted for this item' });
      }

      const { data: item, error: itemError } = await supabase
        .from('girn_items')
        .select('*')
        .eq('id', itemId)
        .eq('girn_id', girnId)
        .maybeSingle();

      if (itemError) throw itemError;
      if (!item) return res.status(404).json({ error: 'GIRN item not found' });

      const category = item.item_category || 'raw_material';
      const cfg = getCategoryConfig(category);

      if (!cfg.requiresInspection) {
        return res.status(409).json({ error: 'This item category does not require inspection' });
      }

      const masterRecordId = item.master_record_id || item.raw_material_id;
      if (!masterRecordId) {
        return res.status(400).json({ error: 'GIRN item is not linked to a master record' });
      }

      const plan = await getActivePlanForRecord(masterRecordId);
      if (!plan) {
        return res.status(404).json({ error: 'No active inspection plan for this item' });
      }

      let valuesInput = [];
      let docVerified = {};
      try {
        valuesInput = JSON.parse(req.body.values || '[]');
        docVerified = JSON.parse(req.body.documents || '{}');
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid values or documents JSON' });
      }

      const itemUpdate = {};
      if (category === 'gauge') {
        itemUpdate.quantity_ok = toNumber(req.body.quantity_ok);
        itemUpdate.quantity_not_ok = toNumber(req.body.quantity_not_ok);
        const total = toNumber(item.quantity);
        if (itemUpdate.quantity_ok + itemUpdate.quantity_not_ok !== total) {
          return res.status(400).json({ error: 'OK + Not OK quantities must equal received quantity' });
        }
      }

      if (Object.keys(itemUpdate).length) {
        const { error: qtyError } = await supabase
          .from('girn_items')
          .update(itemUpdate)
          .eq('id', itemId);
        if (qtyError) throw qtyError;
      }

      const valueResults = (plan.parameters || []).map((param) => {
        const input = valuesInput.find((v) => v.plan_parameter_id === param.id) || {};
        const evaluated = evaluateParameterResult(param, input);
        return {
          plan_parameter_id: param.id,
          measured_value: evaluated.measured_value,
          result: evaluated.result,
          remarks: input.remarks || null,
        };
      });

      const uploadedDocs = [];
      for (const file of req.files || []) {
        const docType = file.fieldname.replace(/^doc_/, '');
        const fileUrl = await uploadInspectionFile(file, girnId, itemId);
        uploadedDocs.push({
          document_type: docType,
          file_url: fileUrl,
          verified: docVerified[docType] === true || docVerified[docType] === 'true',
        });
      }

      const overallResult = computeOverallResult(
        plan.parameters || [],
        valueResults,
        plan.documents || [],
        uploadedDocs
      );

      const lotQty = toNumber(item.quantity);
      const sampleSize = computeSampleSize(lotQty, plan.sampling_rule_type, plan.sampling_rule_value);

      const { data: inspection, error: inspErr } = await supabase
        .from('girn_inspections')
        .insert({
          girn_item_id: itemId,
          plan_id: plan.id,
          plan_revision_snapshot: plan.revision,
          lot_qty: lotQty,
          sample_size: sampleSize,
          inspector_id: req.user?.sub || null,
          overall_result: overallResult,
        })
        .select()
        .single();

      if (inspErr) throw inspErr;

      if (valueResults.length) {
        const { error: valErr } = await supabase.from('girn_inspection_values').insert(
          valueResults.map((v) => ({
            inspection_id: inspection.id,
            plan_parameter_id: v.plan_parameter_id,
            measured_value: v.measured_value,
            result: v.result,
            remarks: v.remarks,
          }))
        );
        if (valErr) throw valErr;
      }

      if (uploadedDocs.length) {
        const { error: docErr } = await supabase.from('girn_inspection_documents').insert(
          uploadedDocs.map((d) => ({
            inspection_id: inspection.id,
            document_type: d.document_type,
            file_url: d.file_url,
            verified: d.verified,
          }))
        );
        if (docErr) throw docErr;
      }

      let lotNumber = item.lot_number;
      if (
        category === 'component' &&
        cfg.assignsLot &&
        overallResult === 'pass' &&
        masterRecordId &&
        !lotNumber
      ) {
        lotNumber = await assignLotToGirnItem(itemId, masterRecordId);
      }

      const execution = await loadInspectionExecution(itemId);

      emitGirnUpdated({ girnId, action: 'inspection', status: girn.status });

      return res.json({
        message: 'Inspection submitted successfully',
        execution,
        lot_number: lotNumber || null,
      });
    } catch (err) {
      console.error('GIRN inspection POST error:', err);
      return res.status(500).json({ error: err.message || 'Unable to submit inspection' });
    }
  }
);

module.exports = router;
