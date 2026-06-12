const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function uploadFileToBucket(bucket, file) {
  const extension = path.extname(file.originalname).toLowerCase() || '';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName);

  return {
    url: publicUrlData?.publicUrl || null,
    fileName,
  };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

async function masterExists(masterId) {
  if (!isValidUuid(masterId)) {
    return false;
  }

  const { data, error } = await supabase
    .from('masters')
    .select('id')
    .eq('id', masterId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function recordExists(masterId, recordId) {
  if (!isValidUuid(masterId) || !isValidUuid(recordId)) {
    return false;
  }

  const { data, error } = await supabase
    .from('master_records')
    .select('id')
    .eq('id', recordId)
    .eq('master_id', masterId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

// ─── Masters ───────────────────────────────────────────────

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('masters')
      .select('id, name, icon, description')
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json(data || []);
  } catch (err) {
    console.error('Master list error:', err);
    return res.status(500).json({ error: 'Unable to load masters' });
  }
});

router.post('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { name, description, icon } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data, error } = await supabase
      .from('masters')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        icon: icon?.trim() || null,
      })
      .select('id, name, icon, description, created_at, updated_at')
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      message: 'Master created successfully',
      master: data,
    });
  } catch (err) {
    console.error('Master creation error:', err);
    return res.status(500).json({ error: 'Unable to create master' });
  }
});

// ─── File uploads (must be before /:id) ────────────────────

router.post('/upload/image', verifyEmployeeAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const result = await uploadFileToBucket('master-images', req.file);
    return res.json(result);
  } catch (err) {
    console.error('Master image upload error:', err);
    return res.status(500).json({ error: 'Unable to upload image' });
  }
});

router.post('/upload/category-image', verifyEmployeeAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const result = await uploadFileToBucket('category-images', req.file);
    return res.json(result);
  } catch (err) {
    console.error('Category image upload error:', err);
    return res.status(500).json({ error: 'Unable to upload category image' });
  }
});

router.post('/upload/section-image', verifyEmployeeAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const result = await uploadFileToBucket('section-images', req.file);
    return res.json(result);
  } catch (err) {
    console.error('Section image upload error:', err);
    return res.status(500).json({ error: 'Unable to upload section image' });
  }
});

// ─── Master records (must be before /:id) ──────────────────

router.put('/:masterId/records/:recordId/categories', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await recordExists(masterId, recordId))) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const { error: deleteError } = await supabase
      .from('record_categories')
      .delete()
      .eq('record_id', recordId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Categories updated successfully', categories: [] });
    }

    const rows = items.map((item) => ({
      record_id: recordId,
      key: item.key || null,
      value_type: item.value_type || 'text',
      value: item.value_type === 'image' ? null : (item.value ?? null),
      image_url: item.value_type === 'image' ? (item.image_url || null) : null,
    }));

    const { data, error } = await supabase
      .from('record_categories')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Categories updated successfully', categories: data || [] });
  } catch (err) {
    console.error('Record categories update error:', err);
    return res.status(500).json({ error: 'Unable to update categories' });
  }
});

router.put('/:masterId/records/:recordId/overrides', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await recordExists(masterId, recordId))) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const { error: deleteError } = await supabase
      .from('record_rule_overrides')
      .delete()
      .eq('record_id', recordId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Rule overrides updated successfully', overrides: [] });
    }

    const rows = items.map((item) => ({
      record_id: recordId,
      rule_id: item.rule_id,
      threshold_value: item.threshold_value ?? null,
    }));

    const { data, error } = await supabase
      .from('record_rule_overrides')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Rule overrides updated successfully', overrides: data || [] });
  } catch (err) {
    console.error('Record overrides update error:', err);
    return res.status(500).json({ error: 'Unable to update rule overrides' });
  }
});

router.put('/:masterId/records/:recordId/sections', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await recordExists(masterId, recordId))) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const { error: deleteError } = await supabase
      .from('record_section_rows')
      .delete()
      .eq('record_id', recordId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Sections updated successfully', rows: [] });
    }

    const savedRows = [];

    for (const [index, item] of items.entries()) {
      const { data: row, error: rowError } = await supabase
        .from('record_section_rows')
        .insert({
          record_id: recordId,
          section_id: item.section_id,
          sort_order: item.sort_order != null ? Number(item.sort_order) : index,
        })
        .select('id, record_id, section_id, sort_order, created_at')
        .single();

      if (rowError) {
        throw rowError;
      }

      const valueRows = (item.values || []).map((value) => ({
        section_row_id: row.id,
        section_field_id: value.section_field_id,
        value: value.value ?? null,
        image_url: value.image_url || null,
        related_record_id: value.related_record_id || null,
      }));

      let insertedValues = [];

      if (valueRows.length > 0) {
        const { data: valuesData, error: valuesError } = await supabase
          .from('record_section_values')
          .insert(valueRows)
          .select('id, section_row_id, section_field_id, value, image_url, related_record_id, created_at');

        if (valuesError) {
          throw valuesError;
        }

        insertedValues = valuesData || [];
      }

      savedRows.push({
        ...row,
        record_section_values: insertedValues,
      });
    }

    return res.json({ message: 'Sections updated successfully', rows: savedRows });
  } catch (err) {
    console.error('Record sections update error:', err);
    return res.status(500).json({ error: 'Unable to update sections' });
  }
});

router.put('/:masterId/records/:recordId/values', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await recordExists(masterId, recordId))) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const { error: deleteError } = await supabase
      .from('record_values')
      .delete()
      .eq('record_id', recordId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Values updated successfully', values: [] });
    }

    const rows = items.map((item) => ({
      record_id: recordId,
      field_id: item.field_id,
      value: item.value ?? null,
      image_url: item.image_url || null,
      related_record_id: item.related_record_id || null,
    }));

    const { data, error } = await supabase
      .from('record_values')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Values updated successfully', values: data || [] });
  } catch (err) {
    console.error('Record values update error:', err);
    return res.status(500).json({ error: 'Unable to update values' });
  }
});

router.get('/:masterId/records/:recordId', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;

    const { data: record, error: recordError } = await supabase
      .from('master_records')
      .select('id, master_id, name, code, created_at, updated_at')
      .eq('id', recordId)
      .eq('master_id', masterId)
      .maybeSingle();

    if (recordError) {
      throw recordError;
    }

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const [valuesResult, overridesResult, categoriesResult, fieldsResult, sectionRowsResult] =
      await Promise.all([
        supabase
          .from('record_values')
          .select('id, field_id, value, image_url, related_record_id')
          .eq('record_id', recordId),
        supabase
          .from('record_rule_overrides')
          .select('id, rule_id, threshold_value')
          .eq('record_id', recordId),
        supabase
          .from('record_categories')
          .select('id, key, value_type, value, image_url')
          .eq('record_id', recordId),
        supabase
          .from('master_fields')
          .select(
            'id, master_id, label, field_key, type, required, options, related_master_id, sort_order'
          )
          .eq('master_id', masterId),
        supabase
          .from('record_section_rows')
          .select(
            'id, record_id, section_id, sort_order, created_at, record_section_values(id, section_row_id, section_field_id, value, image_url, related_record_id, created_at, master_section_fields(id, section_id, label, field_key, type, required, options, related_master_id, sort_order))'
          )
          .eq('record_id', recordId)
          .order('sort_order', { ascending: true }),
      ]);

    if (valuesResult.error) {
      throw valuesResult.error;
    }

    if (overridesResult.error) {
      throw overridesResult.error;
    }

    if (categoriesResult.error) {
      throw categoriesResult.error;
    }

    if (fieldsResult.error) {
      throw fieldsResult.error;
    }

    if (sectionRowsResult.error) {
      throw sectionRowsResult.error;
    }

    const fieldsById = Object.fromEntries((fieldsResult.data || []).map((field) => [field.id, field]));
    const recordValues = (valuesResult.data || []).map((value) => ({
      ...value,
      master_fields: fieldsById[value.field_id] || null,
    }));

    const recordSectionRows = (sectionRowsResult.data || []).map((row) => ({
      ...row,
      record_section_values: (row.record_section_values || []).sort(
        (a, b) =>
          (a.master_section_fields?.sort_order ?? 0) - (b.master_section_fields?.sort_order ?? 0)
      ),
    }));

    

    return res.json({
      record: {
        ...record,
        record_values: recordValues,
        record_rule_overrides: overridesResult.data || [],
        record_categories: categoriesResult.data || [],
        record_section_rows: recordSectionRows,
      },
    });
  } catch (err) {
    console.error('Record detail error:', err);
    return res.status(500).json({ error: 'Unable to load record details' });
  }
});

router.put('/:masterId/records/:recordId', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;
    const { name, code } = req.body;

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (code !== undefined) updatePayload.code = code;
    updatePayload.updated_at = new Date().toISOString();

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    const { data, error } = await supabase
      .from('master_records')
      .update(updatePayload)
      .eq('id', recordId)
      .eq('master_id', masterId)
      .select('id, master_id, name, code, created_at, updated_at')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Record not found' });
    }

    return res.json({
      message: 'Record updated successfully',
      record: data,
    });
  } catch (err) {
    console.error('Record update error:', err);
    return res.status(500).json({ error: 'Unable to update record' });
  }
});

router.delete('/:masterId/records/:recordId', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId, recordId } = req.params;

    const { data, error } = await supabase
      .from('master_records')
      .delete()
      .eq('id', recordId)
      .eq('master_id', masterId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Record not found' });
    }

    return res.json({ message: 'Record deleted successfully' });
  } catch (err) {
    console.error('Record delete error:', err);
    return res.status(500).json({ error: 'Unable to delete record' });
  }
});

router.get('/:masterId/records', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId } = req.params;

    if (!(await masterExists(masterId))) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const { data, error } = await supabase
      .from('master_records')
      .select('id, name, code, created_at')
      .eq('master_id', masterId)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({ records: data || [] });
  } catch (err) {
    console.error('Record list error:', err);
    return res.status(500).json({ error: 'Unable to load records' });
  }
});

router.post('/:masterId/records', verifyEmployeeAuth, async (req, res) => {
  try {
    const { masterId } = req.params;
    const { name, code } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (!(await masterExists(masterId))) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const { data, error } = await supabase
      .from('master_records')
      .insert({
        master_id: masterId,
        name: name.trim(),
        code: code?.trim() || null,
      })
      .select('id, master_id, name, code, created_at, updated_at')
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      message: 'Record created successfully',
      record: data,
    });
  } catch (err) {
    console.error('Record creation error:', err);
    return res.status(500).json({ error: 'Unable to create record' });
  }
});

// ─── Master fields & rules ─────────────────────────────────

router.put('/:id/fields', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await masterExists(masterId))) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('master_fields')
      .select('id, field_key')
      .eq('master_id', masterId);

    if (existingError) {
      throw existingError;
    }

    const incomingIds = new Set(items.filter((item) => item.id).map((item) => item.id));
    const incomingKeys = new Set(items.filter((item) => item.field_key).map((item) => item.field_key));
    const toDelete = (existing || []).filter(
      (field) => !incomingIds.has(field.id) && !(field.field_key && incomingKeys.has(field.field_key))
    );

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('master_fields')
        .delete()
        .in(
          'id',
          toDelete.map((field) => field.id)
        );

      if (deleteError) {
        throw deleteError;
      }
    }

    if (items.length === 0) {
      return res.json({ message: 'Fields updated successfully', fields: [] });
    }

    const savedFields = [];

    for (const [index, item] of items.entries()) {
      const row = {
        master_id: masterId,
        label: item.label || null,
        field_key: item.field_key || null,
        type: item.type || 'text',
        required: Boolean(item.required),
        options: item.options ?? null,
        related_master_id: item.related_master_id || null,
        sort_order: item.sort_order != null ? Number(item.sort_order) : index,
      };

      const match = item.id
        ? (existing || []).find((field) => field.id === item.id)
        : (existing || []).find((field) => field.field_key && field.field_key === item.field_key);

      if (match) {
        const { data, error } = await supabase
          .from('master_fields')
          .update(row)
          .eq('id', match.id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        savedFields.push(data);
      } else {
        const { data, error } = await supabase.from('master_fields').insert(row).select().single();

        if (error) {
          throw error;
        }

        savedFields.push(data);
      }
    }

    savedFields.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    return res.json({ message: 'Fields updated successfully', fields: savedFields });
  } catch (err) {
    console.error('Master fields update error:', err);
    return res.status(500).json({ error: 'Unable to update fields' });
  }
});

router.put('/:id/sections', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await masterExists(masterId))) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const { error: deleteError } = await supabase
      .from('master_sections')
      .delete()
      .eq('master_id', masterId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Sections updated successfully', sections: [] });
    }

    const savedSections = [];

    for (const [sectionIndex, item] of items.entries()) {
      const { data: section, error: sectionError } = await supabase
        .from('master_sections')
        .insert({
          master_id: masterId,
          name: item.name || null,
          description: item.description || null,
          sort_order: item.sort_order != null ? Number(item.sort_order) : sectionIndex,
        })
        .select('id, master_id, name, description, sort_order, created_at')
        .single();

      if (sectionError) {
        throw sectionError;
      }

      const fieldRows = (item.fields || []).map((field, fieldIndex) => ({
        section_id: section.id,
        label: field.label || null,
        field_key: field.field_key || null,
        type: field.type || 'text',
        required: Boolean(field.required),
        options: field.options ?? null,
        related_master_id: field.related_master_id || null,
        sort_order: field.sort_order != null ? Number(field.sort_order) : fieldIndex,
      }));

      let insertedFields = [];

      if (fieldRows.length > 0) {
        const { data: fieldsData, error: fieldsError } = await supabase
          .from('master_section_fields')
          .insert(fieldRows)
          .select(
            'id, section_id, label, field_key, type, required, options, related_master_id, sort_order, created_at'
          );

        if (fieldsError) {
          throw fieldsError;
        }

        insertedFields = (fieldsData || []).sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );
      }

      savedSections.push({
        ...section,
        master_section_fields: insertedFields,
      });
    }

    return res.json({ message: 'Sections updated successfully', sections: savedSections });
  } catch (err) {
    console.error('Master sections update error:', err);
    return res.status(500).json({ error: 'Unable to update sections' });
  }
});

router.put('/:id/rules', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await masterExists(masterId))) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('master_rules')
      .select('id')
      .eq('master_id', masterId);

    if (existingError) {
      throw existingError;
    }

    if (items.length === 0) {
      if ((existing || []).length > 0) {
        const { error: deleteError } = await supabase
          .from('master_rules')
          .delete()
          .eq('master_id', masterId);

        if (deleteError) {
          throw deleteError;
        }
      }

      return res.json({ message: 'Rules updated successfully', rules: [] });
    }

    const keptIds = new Set();
    const savedRules = [];

    for (const item of items) {
      const row = {
        master_id: masterId,
        name: item.name || null,
        condition_field_id: item.condition_field_id || null,
        operator: item.operator || null,
        threshold_field_id: item.threshold_field_id || null,
        threshold_value: item.threshold_value ?? null,
        action_type: item.action_type || null,
        action_message: item.action_message || null,
      };

      if (item.id) {
        const { data, error } = await supabase
          .from('master_rules')
          .update(row)
          .eq('id', item.id)
          .eq('master_id', masterId)
          .select()
          .single();

        if (error) {
          throw error;
        }

        savedRules.push(data);
        keptIds.add(data.id);
      } else {
        const { data, error } = await supabase.from('master_rules').insert(row).select().single();

        if (error) {
          throw error;
        }

        savedRules.push(data);
        keptIds.add(data.id);
      }
    }

    const toDelete = (existing || []).filter((rule) => !keptIds.has(rule.id));

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('master_rules')
        .delete()
        .in(
          'id',
          toDelete.map((rule) => rule.id)
        );

      if (deleteError) {
        throw deleteError;
      }
    }

    return res.json({ message: 'Rules updated successfully', rules: savedRules });
  } catch (err) {
    console.error('Master rules update error:', err);
    return res.status(500).json({ error: 'Unable to update rules' });
  }
});

// ─── Single master CRUD ────────────────────────────────────

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;

    if (!isValidUuid(masterId)) {
      return res.status(400).json({ error: 'Invalid master id' });
    }

    const { data: master, error: masterError } = await supabase
      .from('masters')
      .select('id, name, description, icon, created_at, updated_at')
      .eq('id', masterId)
      .maybeSingle();

    if (masterError) {
      throw masterError;
    }

    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const [fieldsResult, rulesResult, sectionsResult] = await Promise.all([
      supabase
        .from('master_fields')
        .select(
          'id, master_id, label, field_key, type, required, options, related_master_id, sort_order'
        )
        .eq('master_id', masterId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('master_rules')
        .select(
          'id, master_id, name, condition_field_id, operator, threshold_field_id, threshold_value, action_type, action_message'
        )
        .eq('master_id', masterId),
      supabase
        .from('master_sections')
        .select(
          'id, master_id, name, description, sort_order, created_at, master_section_fields(id, section_id, label, field_key, type, required, options, related_master_id, sort_order, created_at)'
        )
        .eq('master_id', masterId)
        .order('sort_order', { ascending: true }),
    ]);

    if (fieldsResult.error) {
      throw fieldsResult.error;
    }

    if (rulesResult.error) {
      throw rulesResult.error;
    }

    if (sectionsResult.error) {
      throw sectionsResult.error;
    }

    const masterSections = (sectionsResult.data || []).map((section) => ({
      ...section,
      master_section_fields: (section.master_section_fields || []).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      ),
    }));

    return res.json({
      master: {
        ...master,
        master_fields: fieldsResult.data || [],
        master_rules: rulesResult.data || [],
        master_sections: masterSections,
      },
    });
  } catch (err) {
    console.error('Master detail error:', err);
    return res.status(500).json({ error: 'Unable to load master details' });
  }
});

router.put('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;
    const { name, description, icon } = req.body;

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (description !== undefined) updatePayload.description = description || null;
    if (icon !== undefined) updatePayload.icon = icon || null;
    updatePayload.updated_at = new Date().toISOString();

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    const { data, error } = await supabase
      .from('masters')
      .update(updatePayload)
      .eq('id', masterId)
      .select('id, name, description, icon, created_at, updated_at')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Master not found' });
    }

    return res.json({
      message: 'Master updated successfully',
      master: data,
    });
  } catch (err) {
    console.error('Master update error:', err);
    return res.status(500).json({ error: 'Unable to update master' });
  }
});

router.delete('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const masterId = req.params.id;

    const { data, error } = await supabase
      .from('masters')
      .delete()
      .eq('id', masterId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Master not found' });
    }

    return res.json({ message: 'Master deleted successfully' });
  } catch (err) {
    console.error('Master delete error:', err);
    return res.status(500).json({ error: 'Unable to delete master' });
  }
});

module.exports = router;
