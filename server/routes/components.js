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

async function componentExists(componentId) {
  const { data, error } = await supabase
    .from('components')
    .select('id')
    .eq('id', componentId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('components')
      .select('id, name, code, size, used_for')
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({ components: data || [] });
  } catch (err) {
    console.error('Component list error:', err);
    return res.status(500).json({ error: 'Unable to load components' });
  }
});

router.post('/upload/drawing', verifyEmployeeAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const result = await uploadFileToBucket('drawings', req.file);
    return res.json(result);
  } catch (err) {
    console.error('Drawing upload error:', err);
    return res.status(500).json({ error: 'Unable to upload drawing' });
  }
});

router.post('/upload/photo', verifyEmployeeAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const result = await uploadFileToBucket('photos', req.file);
    return res.json(result);
  } catch (err) {
    console.error('Photo upload error:', err);
    return res.status(500).json({ error: 'Unable to upload photo' });
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

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const { data, error } = await supabase
      .from('components')
      .select(`
        id,
        name,
        code,
        size,
        specification,
        used_for,
        created_at,
        updated_at,
        commercials (
          id,
          name,
          rate,
          moq,
          created_at
        ),
        standards (
          id,
          minimum_quantity,
          maximum_quantity,
          location,
          created_at
        ),
        drawings (
          id,
          name,
          customer_specification,
          file_url,
          file_name,
          created_at
        ),
        photos (
          id,
          name,
          file_url,
          file_name,
          created_at
        ),
        categories (
          id,
          key,
          value_type,
          value,
          image_url,
          created_at
        )
      `)
      .eq('id', componentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const standards = data.standards;
    const standard = Array.isArray(standards)
      ? standards[0] || null
      : standards || null;

    return res.json({
      component: {
        ...data,
        standard,
      },
    });
  } catch (err) {
    console.error('Component detail error:', err);
    return res.status(500).json({ error: 'Unable to load component details' });
  }
});

router.post('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { name, code, size, specification, used_for } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    const { data, error } = await supabase
      .from('components')
      .insert({
        name,
        code,
        size: size || null,
        specification: specification || null,
        used_for: used_for || null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      message: 'Component created successfully',
      component: data,
    });
  } catch (err) {
    console.error('Component creation error:', err);
    return res.status(500).json({ error: 'Unable to create component' });
  }
});

router.put('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const { name, code, size, specification, used_for } = req.body;

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (code !== undefined) updatePayload.code = code;
    if (size !== undefined) updatePayload.size = size || null;
    if (specification !== undefined) updatePayload.specification = specification || null;
    if (used_for !== undefined) updatePayload.used_for = used_for || null;
    updatePayload.updated_at = new Date().toISOString();

    if (Object.keys(updatePayload).length === 1) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    const { data, error } = await supabase
      .from('components')
      .update(updatePayload)
      .eq('id', componentId)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Component not found' });
    }

    return res.json({
      message: 'Component updated successfully',
      component: data,
    });
  } catch (err) {
    console.error('Component update error:', err);
    return res.status(500).json({ error: 'Unable to update component' });
  }
});

router.delete('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const { data, error } = await supabase
      .from('components')
      .delete()
      .eq('id', componentId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Component not found' });
    }

    return res.json({ message: 'Component deleted successfully' });
  } catch (err) {
    console.error('Component delete error:', err);
    return res.status(500).json({ error: 'Unable to delete component' });
  }
});

router.put('/:id/commercials', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await componentExists(componentId))) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const { error: deleteError } = await supabase
      .from('commercials')
      .delete()
      .eq('component_id', componentId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Commercials updated successfully', commercials: [] });
    }

    const rows = items.map((item) => ({
      component_id: componentId,
      name: item.name || null,
      rate: item.rate != null && item.rate !== '' ? Number(item.rate) : null,
      moq: item.moq != null && item.moq !== '' ? Number(item.moq) : null,
    }));

    const { data, error } = await supabase
      .from('commercials')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Commercials updated successfully', commercials: data || [] });
  } catch (err) {
    console.error('Commercials update error:', err);
    return res.status(500).json({ error: 'Unable to update commercials' });
  }
});

router.put('/:id/standard', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const { minimum_quantity, maximum_quantity, location } = req.body;

    if (!(await componentExists(componentId))) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const { error: deleteError } = await supabase
      .from('standards')
      .delete()
      .eq('component_id', componentId);

    if (deleteError) {
      throw deleteError;
    }

    const hasValues =
      (minimum_quantity != null && minimum_quantity !== '') ||
      (maximum_quantity != null && maximum_quantity !== '') ||
      (location != null && String(location).trim() !== '');

    if (!hasValues) {
      return res.json({ message: 'Standard updated successfully', standard: null });
    }

    const payload = {
      component_id: componentId,
      minimum_quantity: minimum_quantity != null && minimum_quantity !== ''
        ? Number(minimum_quantity)
        : null,
      maximum_quantity: maximum_quantity != null && maximum_quantity !== ''
        ? Number(maximum_quantity)
        : null,
      location: location ? String(location).trim() : null,
    };

    const { data, error } = await supabase
      .from('standards')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Standard updated successfully', standard: data });
  } catch (err) {
    console.error('Standard update error:', err);
    return res.status(500).json({ error: 'Unable to update standard' });
  }
});

router.put('/:id/drawings', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await componentExists(componentId))) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const { error: deleteError } = await supabase
      .from('drawings')
      .delete()
      .eq('component_id', componentId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Drawings updated successfully', drawings: [] });
    }

    const rows = items.map((item) => ({
      component_id: componentId,
      name: item.name || null,
      customer_specification: item.customer_specification || null,
      file_url: item.file_url || null,
      file_name: item.file_name || null,
    }));

    const { data, error } = await supabase
      .from('drawings')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Drawings updated successfully', drawings: data || [] });
  } catch (err) {
    console.error('Drawings update error:', err);
    return res.status(500).json({ error: 'Unable to update drawings' });
  }
});

router.put('/:id/photos', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await componentExists(componentId))) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const { error: deleteError } = await supabase
      .from('photos')
      .delete()
      .eq('component_id', componentId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Photos updated successfully', photos: [] });
    }

    const rows = items.map((item) => ({
      component_id: componentId,
      name: item.name || null,
      file_url: item.file_url || null,
      file_name: item.file_name || null,
    }));

    const { data, error } = await supabase
      .from('photos')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Photos updated successfully', photos: data || [] });
  } catch (err) {
    console.error('Photos update error:', err);
    return res.status(500).json({ error: 'Unable to update photos' });
  }
});

router.put('/:id/categories', verifyEmployeeAuth, async (req, res) => {
  try {
    const componentId = req.params.id;
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must be an array' });
    }

    if (!(await componentExists(componentId))) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('component_id', componentId);

    if (deleteError) {
      throw deleteError;
    }

    if (items.length === 0) {
      return res.json({ message: 'Categories updated successfully', categories: [] });
    }

    const rows = items.map((item) => ({
      component_id: componentId,
      key: item.key || null,
      value_type: item.value_type || 'text',
      value: item.value_type === 'image' ? null : (item.value ?? null),
      image_url: item.value_type === 'image' ? (item.image_url || null) : null,
    }));

    const { data, error } = await supabase
      .from('categories')
      .insert(rows)
      .select();

    if (error) {
      throw error;
    }

    return res.json({ message: 'Categories updated successfully', categories: data || [] });
  } catch (err) {
    console.error('Categories update error:', err);
    return res.status(500).json({ error: 'Unable to update categories' });
  }
});

module.exports = router;
