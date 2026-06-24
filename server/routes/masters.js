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

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

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
function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

async function getMaster(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  if (error || !data) throw { status: 404, message: `Master '${slug}' not found` }
  return data
}
 
// Fetch full schema for a dynamic master (sections + fields)
async function getMasterSchema(masterId) {
  const { data, error } = await supabase
    .from('v_master_schema')
    .select('*')
    .eq('master_id', masterId)
 
  if (error) throw { status: 500, message: error.message }
 
  // Group into sections → fields tree
  const sectionsMap = {}
  for (const row of data) {
    if (!sectionsMap[row.section_id]) {
      sectionsMap[row.section_id] = {
        id:            row.section_id,
        name:          row.section_name,
        slug:          row.section_slug,
        is_repeatable: row.is_repeatable,
        order:         row.section_order,
        fields:        []
      }
    }
    sectionsMap[row.section_id].fields.push({
      id:                   row.field_id,
      label:                row.field_label,
      slug:                 row.field_slug,
      field_type:           row.field_type,
      options:              row.options,
      related_master_id:    row.related_master_id,
      related_master_name:  row.related_master_name,
      related_master_slug:  row.related_master_slug,
      placeholder:          row.placeholder,
      is_required:          row.is_required,
      order:                row.field_order
    })
  }
 
  return Object.values(sectionsMap).sort((a, b) => a.order - b.order)
}
 
// Upload a file to Supabase Storage, return public URL
async function uploadFile(file, masterSlug) {
  const ext      = file.originalname.split('.').pop()
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const path     = `masters/${masterSlug}/${filename}`
 
  const { error } = await supabase.storage
    .from('master-images')
    .upload(path, file.buffer, { contentType: file.mimetype })
 
  if (error) throw { status: 500, message: `File upload failed: ${error.message}` }
 
  const { data: urlData } = supabase.storage
    .from('master-images')
    .getPublicUrl(path)
 
  return { url: urlData.publicUrl, name: file.originalname, size: file.size }
}
 
// Error handler wrapper
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      const status = err.status || 500
      res.status(status).json({ error: err.message || 'Internal server error' })
    }
  }
}
 
// ---------------------------------------------------------------------------
// LEGACY MASTER HELPERS (suppliers / customers)
// ---------------------------------------------------------------------------
 
async function getLegacyRecords(master, { search, page, limit }) {
  const table   = master.source_table
  const labelCol = master.label_column
  const offset  = (page - 1) * limit
 
  let query = supabase.from(table).select('*', { count: 'exact' })
 
  if (search && master.search_columns?.length) {
    const filter = master.search_columns
      .map(col => `${col}.ilike.%${search}%`)
      .join(',')
    query = query.or(filter)
  }
 
  const { data, count, error } = await query
    .order(labelCol, { ascending: true })
    .range(offset, offset + limit - 1)
 
  if (error) throw { status: 500, message: error.message }
  return { records: data, total: count, page, limit }
}
 
async function getLegacyRecord(master, id) {
  const { data, error } = await supabase
    .from(master.source_table)
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) throw { status: 404, message: 'Record not found' }
  return data
}
 
// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------
 
// GET /api/masters
// List all active masters (for sidebar / nav)
router.get('/', wrap(async (req, res) => {
  const { data, error } = await supabase
    .from('masters')
    .select('id, name, slug, description, icon, source_type')
    .eq('is_active', true)
    .eq('source_type', 'dynamic')
    .order('name')
 
  if (error) throw { status: 500, message: error.message }
  res.json(data)
}))
 
// GET /api/masters/:slug/schema
// Returns sections + fields config for a dynamic master
// Frontend uses this to render the form
router.get('/:slug/schema', wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
 
  if (master.source_type === 'legacy') {
    return res.json({
      source_type: 'legacy',
      source_table: master.source_table,
      message: 'Legacy master — use its own dedicated routes'
    })
  }
 
  const sections = await getMasterSchema(master.id)
  res.json({ master, sections })
}))
 
// GET /api/masters/:slug/records
// List records for any master (dynamic or legacy)
router.get('/:slug/records', wrap(async (req, res) => {
  const master  = await getMaster(req.params.slug)
  const page    = parseInt(req.query.page)  || 1
  const limit   = parseInt(req.query.limit) || 20
  const search  = req.query.search || ''
 
  // ── Legacy master ──────────────────────────────────────────────────────────
  if (master.source_type === 'legacy') {
    const result = await getLegacyRecords(master, { search, page, limit })
    return res.json(result)
  }
 
  // ── Dynamic master ─────────────────────────────────────────────────────────
  // Fetch the first required text field per master to use as display label
  const { data: labelField } = await supabase
    .from('v_master_schema')
    .select('field_id, field_label, field_slug')
    .eq('master_id', master.id)
    .eq('is_required', true)
    .order('section_order')
    .order('field_order')
    .limit(1)
    .single()
 
  const offset = (page - 1) * limit
 
  let recordsQuery = supabase
    .from('master_records')
    .select('id, created_at', { count: 'exact' })
    .eq('master_id', master.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

 
  const { data: records, count, error } = await recordsQuery

  if (error) throw { status: 500, message: error.message }
 
  if (!records.length) return res.json({ records: [], total: 0, page, limit })
 
  // Attach label values (first required text field) for list display
  const recordIds = records.map(r => r.id)
  const { data: labelValues } = await supabase
    .from('record_values')
    .select('record_id, value, field_id(label)')
    .in('record_id', recordIds)
    .eq('field_id', labelField?.field_id)

    console.log(labelField.field_label)
 
  const labelMap = {}
  for (const lv of labelValues || []) labelMap[lv.record_id] = lv.value
 
  console.log(labelMap)
  // Apply search filter in JS (for simplicity; move to DB FTS later if needed)
  let result = records.map(r => ({
    id:         r.id,
    created_at: r.created_at,
    label:      labelMap[r.id] || '(unnamed)',
    field:      labelField.field_label
  }))
 
  if (search) {
    result = result.filter(r =>
      r.label.toLowerCase().includes(search.toLowerCase())
    )
  }
 
  res.json({ records: result, total: count, page, limit })
}))
 
// GET /api/masters/:slug/records/:id
// Fetch a single record with all its values (flat + repeatable sections)
router.get('/:slug/records/:id', wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
  const { id }  = req.params
 
  // ── Legacy ─────────────────────────────────────────────────────────────────
  if (master.source_type === 'legacy') {
    const record = await getLegacyRecord(master, id)
    return res.json(record)
  }
 
  // ── Dynamic ────────────────────────────────────────────────────────────────
  const { data: record, error: recErr } = await supabase
    .from('master_records')
    .select('id, master_id, created_at, updated_at')
    .eq('id', id)
    .eq('master_id', master.id)
    .single()
 
  if (recErr || !record) throw { status: 404, message: 'Record not found' }
 
  // Flat values
  const { data: flatValues } = await supabase
    .from('record_values')
    .select(`
      field_id,
      value,
      file_url,
      file_urls,
      linked_record_id,
      section_fields (
        label, slug, field_type,
        master_sections ( id, slug, is_repeatable )
      )
    `)
    .eq('record_id', id)
 
  // Repeatable section rows + their values
  const { data: sectionRows } = await supabase
    .from('record_section_rows')
    .select(`
      id, section_id, row_order,
      record_section_values (
        field_id, value, file_url, file_urls, linked_record_id,
        section_fields ( label, slug, field_type )
      ),
      master_sections ( slug, name )
    `)
    .eq('record_id', id)
    .order('row_order')
 
  // Shape flat values into { section_slug: { field_slug: value } }
  const flat = {}
  for (const rv of flatValues || []) {
    const sectionSlug = rv.section_fields?.master_sections?.slug
    if (!sectionSlug) continue
    if (!flat[sectionSlug]) flat[sectionSlug] = {}
    flat[sectionSlug][rv.section_fields.slug] = {
      value:            rv.value,
      file_url:         rv.file_url,
      file_urls:        rv.file_urls,
      linked_record_id: rv.linked_record_id,
    }
  }
 
  // Shape repeatable rows into { section_slug: [ { field_slug: value } ] }
  const repeatable = {}
  for (const row of sectionRows || []) {
    const slug = row.master_sections?.slug
    if (!slug) continue
    if (!repeatable[slug]) repeatable[slug] = []
    const cells = {}
    for (const cell of row.record_section_values || []) {
      cells[cell.section_fields.slug] = {
        value:            cell.value,
        file_url:         cell.file_url,
        file_urls:        cell.file_urls,
        linked_record_id: cell.linked_record_id,
      }
    }
    repeatable[slug].push({ row_id: row.id, row_order: row.row_order, ...cells })
  }
 
  res.json({ record, flat, repeatable })
}))
 
// POST /api/masters/:slug/records
// Create a new record
// Body: { flat: { section_slug: { field_slug: value } }, repeatable: { section_slug: [ row ] } }
// Files: multipart fields named as "file__<section_slug>__<field_slug>"
//        or "file__<section_slug>__<row_index>__<field_slug>" for repeatable
router.post('/:slug/records', upload.any(), wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
 
  if (master.source_type === 'legacy') {
    throw { status: 400, message: 'Legacy masters use their own routes (/api/suppliers or /api/customers)' }
  }
 
  const body       = JSON.parse(req.body.data || '{}')
  const flatData   = body.flat       || {}
  const repeatData = body.repeatable || {}
  const files      = req.files       || []
 
  const sections = await getMasterSchema(master.id)
 
  // Build a lookup: field_slug → field config (for the whole master)
  const fieldMap = {}
  const sectionMap = {}
  for (const section of sections) {
    sectionMap[section.slug] = section
    for (const field of section.fields) {
      fieldMap[`${section.slug}__${field.slug}`] = field
    }
  }
 
  // Create master record
  const { data: record, error: recErr } = await supabase
    .from('master_records')
    .insert({ master_id: master.id })
    .select()
    .single()
 
  if (recErr) throw { status: 500, message: recErr.message }
 
  // ── Insert flat values ─────────────────────────────────────────────────────
  const flatInserts = []
 
  for (const [sectionSlug, fields] of Object.entries(flatData)) {
    for (const [fieldSlug, value] of Object.entries(fields)) {
      const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
      if (!field) continue
 
      const row = { record_id: record.id, field_id: field.id }
 
      if (field.field_type === 'relation') {
        row.linked_record_id = value || null
      } else if (field.field_type === 'file' || field.field_type === 'multi_file') {
        // handled via uploaded files below
        continue
      } else {
        row.value = value != null ? String(value) : null
      }
 
      flatInserts.push(row)
    }
  }
 
  // Handle flat file uploads
  for (const file of files) {
    // file fieldname format: "file__<sectionSlug>__<fieldSlug>"
    const parts = file.fieldname.split('__')
    if (parts.length !== 3) continue
    const [, sectionSlug, fieldSlug] = parts
    const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
    if (!field) continue
 
    const uploaded = await uploadFile(file, master.slug)
    const row = { record_id: record.id, field_id: field.id }
 
    if (field.field_type === 'file') {
      row.file_url = uploaded.url
    } else {
      // multi_file — collect all files for this field
      const existing = flatInserts.find(r => r.field_id === field.id)
      if (existing) {
        existing.file_urls = [...(existing.file_urls || []), uploaded]
      } else {
        row.file_urls = [uploaded]
        flatInserts.push(row)
        continue
      }
    }
 
    flatInserts.push(row)
  }
 
  if (flatInserts.length) {
    const { error } = await supabase.from('record_values').insert(flatInserts)
    if (error) throw { status: 500, message: error.message }
  }
 
  // ── Insert repeatable rows ─────────────────────────────────────────────────
  for (const [sectionSlug, rows] of Object.entries(repeatData)) {
    const section = sectionMap[sectionSlug]
    if (!section || !section.is_repeatable) continue
 
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const rowData = rows[rowIndex]
 
      const { data: sectionRow, error: rowErr } = await supabase
        .from('record_section_rows')
        .insert({ record_id: record.id, section_id: section.id, row_order: rowIndex })
        .select()
        .single()
 
      if (rowErr) throw { status: 500, message: rowErr.message }
 
      const cellInserts = []
 
      for (const [fieldSlug, value] of Object.entries(rowData)) {
        const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
        if (!field) continue
 
        const cell = { row_id: sectionRow.id, field_id: field.id }
 
        if (field.field_type === 'relation') {
          cell.linked_record_id = value || null
        } else if (field.field_type === 'file' || field.field_type === 'multi_file') {
          continue // handled via uploaded files
        } else {
          cell.value = value != null ? String(value) : null
        }
 
        cellInserts.push(cell)
      }
 
      // Handle repeatable file uploads
      // fieldname format: "file__<sectionSlug>__<rowIndex>__<fieldSlug>"
      for (const file of files) {
        const parts = file.fieldname.split('__')
        if (parts.length !== 4) continue
        const [, fSectionSlug, fRowIndex, fFieldSlug] = parts
        if (fSectionSlug !== sectionSlug || parseInt(fRowIndex) !== rowIndex) continue
 
        const field = fieldMap[`${sectionSlug}__${fFieldSlug}`]
        if (!field) continue
 
        const uploaded = await uploadFile(file, master.slug)
        const cell = { row_id: sectionRow.id, field_id: field.id }
 
        if (field.field_type === 'file') {
          cell.file_url = uploaded.url
        } else {
          cell.file_urls = [uploaded]
        }
        cellInserts.push(cell)
      }
 
      if (cellInserts.length) {
        const { error } = await supabase.from('record_section_values').insert(cellInserts)
        if (error) throw { status: 500, message: error.message }
      }
    }
  }
 
  res.status(201).json({ id: record.id })
}))
 
// PUT /api/masters/:slug/records/:id
// Full update — replaces all values for the record
// Same body/file format as POST
router.put('/:slug/records/:id', upload.any(), wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
  if (master.source_type === 'legacy') {
    throw { status: 400, message: 'Use legacy routes for this master' }
  }
 
  const { id } = req.params
 
  // Verify record exists
  const { data: existing, error: chkErr } = await supabase
    .from('master_records')
    .select('id')
    .eq('id', id)
    .eq('master_id', master.id)
    .single()
 
  if (chkErr || !existing) throw { status: 404, message: 'Record not found' }
 
  // Wipe existing values — re-insert fresh
  await supabase.from('record_values').delete().eq('record_id', id)
  await supabase.from('record_section_rows').delete().eq('record_id', id)
  // record_section_values cascade-deletes with record_section_rows
 
  // Update timestamp
  await supabase
    .from('master_records')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)
 
  // Re-use POST logic by faking the record
  req.params.slug = master.slug
  const body       = JSON.parse(req.body.data || '{}')
  const flatData   = body.flat       || {}
  const repeatData = body.repeatable || {}
  const files      = req.files       || []
 
  const sections = await getMasterSchema(master.id)
  const fieldMap  = {}
  const sectionMap = {}
  for (const section of sections) {
    sectionMap[section.slug] = section
    for (const field of section.fields) fieldMap[`${section.slug}__${field.slug}`] = field
  }
 
  // ── Flat values ────────────────────────────────────────────────────────────
  const flatInserts = []
  for (const [sectionSlug, fields] of Object.entries(flatData)) {
    for (const [fieldSlug, value] of Object.entries(fields)) {
      const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
      if (!field) continue
      const row = { record_id: id, field_id: field.id }
      if (field.field_type === 'relation')                         row.linked_record_id = value || null
      else if (field.field_type === 'file' || field.field_type === 'multi_file') continue
      else                                                          row.value = value != null ? String(value) : null
      flatInserts.push(row)
    }
  }
 
  for (const file of files) {
    const parts = file.fieldname.split('__')
    if (parts.length !== 3) continue
    const [, sectionSlug, fieldSlug] = parts
    const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
    if (!field) continue
    const uploaded = await uploadFile(file, master.slug)
    const row = { record_id: id, field_id: field.id }
    if (field.field_type === 'file') row.file_url = uploaded.url
    else row.file_urls = [uploaded]
    flatInserts.push(row)
  }
 
  if (flatInserts.length) {
    const { error } = await supabase.from('record_values').insert(flatInserts)
    if (error) throw { status: 500, message: error.message }
  }
 
  // ── Repeatable rows ────────────────────────────────────────────────────────
  for (const [sectionSlug, rows] of Object.entries(repeatData)) {
    const section = sectionMap[sectionSlug]
    if (!section?.is_repeatable) continue
 
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const { data: sectionRow } = await supabase
        .from('record_section_rows')
        .insert({ record_id: id, section_id: section.id, row_order: rowIndex })
        .select().single()
 
      const cellInserts = []
      for (const [fieldSlug, value] of Object.entries(rows[rowIndex])) {
        const field = fieldMap[`${sectionSlug}__${fieldSlug}`]
        if (!field) continue
        const cell = { row_id: sectionRow.id, field_id: field.id }
        if (field.field_type === 'relation')                         cell.linked_record_id = value || null
        else if (field.field_type === 'file' || field.field_type === 'multi_file') continue
        else                                                          cell.value = value != null ? String(value) : null
        cellInserts.push(cell)
      }
 
      for (const file of files) {
        const parts = file.fieldname.split('__')
        if (parts.length !== 4) continue
        const [, fS, fR, fF] = parts
        if (fS !== sectionSlug || parseInt(fR) !== rowIndex) continue
        const field = fieldMap[`${sectionSlug}__${fF}`]
        if (!field) continue
        const uploaded = await uploadFile(file, master.slug)
        const cell = { row_id: sectionRow.id, field_id: field.id }
        if (field.field_type === 'file') cell.file_url = uploaded.url
        else cell.file_urls = [uploaded]
        cellInserts.push(cell)
      }
 
      if (cellInserts.length) {
        const { error } = await supabase.from('record_section_values').insert(cellInserts)
        if (error) throw { status: 500, message: error.message }
      }
    }
  }
 
  res.json({ id })
}))
 
// DELETE /api/masters/:slug/records/:id
router.delete('/:slug/records/:id', wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
  if (master.source_type === 'legacy') {
    throw { status: 400, message: 'Use legacy routes for this master' }
  }
 
  const { error } = await supabase
    .from('master_records')
    .delete()
    .eq('id', req.params.id)
    .eq('master_id', master.id)
 
  if (error) throw { status: 500, message: error.message }
  res.json({ success: true })
}))
 
// GET /api/masters/:slug/lookup
// Used by relation field dropdowns — returns id + label pairs
// Works for both dynamic and legacy masters
router.get('/:slug/lookup', wrap(async (req, res) => {
  const master = await getMaster(req.params.slug)
  const search = req.query.search || ''
 
  let query = supabase
    .from('v_master_lookup')
    .select('record_id, label')
    .eq('master_slug', master.slug)
    .order('label')
    .limit(50)
 
  if (search) {
    query = query.ilike('label', `%${search}%`)
  }
 
  const { data, error } = await query
  if (error) throw { status: 500, message: error.message }
 
  res.json(data)
}))

router.get('/:slug/record', async(req,res)=>{
  const master= await getMaster(req.params.slug)

    // ── Dynamic master ─────────────────────────────────────────────────────────
  const sections = await getMasterSchema(master.id)

  const columns = (sections[0]?.fields || [])
    .slice(0, 3)
    .map(f => ({
      id: f.id,
      label: f.label
    }))


  const { data: records, count, error } = await supabase
    .from('master_records')
    .select('id, created_at', { count: 'exact' })
    .eq('master_id', master.id)
    .order('created_at', { ascending: false })

  if (error) throw { status: 500, message: error.message }

  if (!records.length) {
    return res.json({
      columns,
      records: [],
      total: 0,
    })
  }

  const recordIds = records.map(r => r.id)
  const fieldIds = columns.map(c => c.id)

  const { data: values, error: valuesError } = await supabase
    .from('record_values')
    .select('record_id, field_id, value')
    .in('record_id', recordIds)
    .in('field_id', fieldIds)

  if (valuesError) {
    throw { status: 500, message: valuesError.message }
  }

  // Build lookup:
  // {
  //   recordId: {
  //     fieldId: value
  //   }
  // }
  const valuesMap = {}

  for (const value of values || []) {
    if (!valuesMap[value.record_id]) {
      valuesMap[value.record_id] = {}
    }

    valuesMap[value.record_id][value.field_id] = value.value
  }

  let result = records.map(record => ({
    id: record.id,
    created_at: record.created_at,
    values: valuesMap[record.id] || {}
  }))

  // Search against visible columns


  res.json({
    columns,
    records: result,
    total: count,

  })
})

router.get('/:id', wrap(async(req,res)=>{
  const {id} = req.params

  const {data: master, error} = await supabase
  .from("masters")
  .select("*")
  .eq('id',id)
  .single()

  if(error || !master){
    throw {status: 404, message: 'Master not found'}
  }

  const sections = await getMasterSchema(id)

  res.json({
    master, 
    sections
  })
}))
 

router.post('/', wrap(async(req,res)=>{
  const {master, sections}= req.body

  const {data: newMaster, error:masterError} = await supabase
  .from('masters')
  .insert({
    name: master.name,
    slug: master.slug,
    description: master.description,
    icon: master.icon,
    source_type: 'dynamic',
    is_active: true
  })
  .select()
  .single()

  if(masterError) throw masterError

  for(let sectionIndex= 0 ; sectionIndex<sections.length; sectionIndex++){
    const section = sections[sectionIndex]

    const {data: newSection, error:sectionErr} = await supabase
    .from("master_sections")
    .insert({
      master_id: newMaster.id,
      name: section.name,
      slug: section.slug,
      is_repeatable: section.is_repeatable,
      section_order: sectionIndex+1
    })
    .select()
    .single()

    if (sectionErr) throw sectionErr

    const fieldRows = section.fields.map((field,fieldIndex)=>({
      section_id: newSection.id,
      label: field.label,
      slug: field.slug,
      field_type: field.field_type,
      options: field.options || null,
      related_master_id: field.related_master_id || null,
      placeholder: field.placeholder || null,
      is_required: field.is_required || false,
      field_order: fieldIndex + 1
    }))

    if (fieldRows.length){
      const {error:fieldError} = await supabase
      .from('section_fields')
      .insert(fieldRows)
    }

    if(fieldError) throw fieldError

  }

  return res.status(201).json({
    id: newMaster.id
  })
}))

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ message: 'Invalid master id' });
 
  const master = req.body.body.master
  const sections = req.body.body.sections

 
  if (!master?.name || !master?.slug) {
    return res.status(400).json({ message: 'master.name and master.slug are required' });
  }
 
  // ── 1. Verify master exists ──────────────────────────────────────────────
  const { data: existing, error: checkErr } = await supabase
    .from('masters')
    .select('id')
    .eq('id', id)
    .single();
 
  if (checkErr || !existing) return res.status(404).json({ message: 'Master not found' });
 
  // ── 2. Update master row ─────────────────────────────────────────────────
  const { data: updatedMaster, error: mErr } = await supabase
    .from('masters')
    .update(clean({
      name:        master.name,
      slug:        master.slug,
      description: master.description ?? null,
      icon:        master.icon        ?? null,
    }))
    .eq('id', id)
    .select()
    .single();
 
  if (mErr) {
    if (mErr.code === '23505') return res.status(409).json({ message: `Slug "${master.slug}" is already used by another master` });
    return res.status(500).json({ message: mErr.message });

  }

  console.log('I reached updated master')

  // ── 3. Sync sections ─────────────────────────────────────────────────────
  //
  // Strategy: compare incoming section ids against existing db rows.
  //   • ids present in DB but NOT in payload  → delete (cascades to fields via FK)
  //   • ids present in payload with valid uuid → upsert
  //   • ids absent / null in payload           → insert as new
  //
  const incomingSectionIds = (sections || [])
    .map((s) => s.id)
    .filter(isValidUUID);
 
  // Fetch current section ids for this master
  const { data: existingSections, error: esErr } = await supabase
    .from('master_sections')
    .select('id')
    .eq('master_id', id);
 
  if (esErr) return res.status(500).json({ message: esErr.message });
 
  const existingSectionIds = (existingSections || []).map((s) => s.id);
 
  // Sections to hard-delete (removed from UI)
  const toDeleteSectionIds = existingSectionIds.filter((eid) => !incomingSectionIds.includes(eid));
 
  if (toDeleteSectionIds.length > 0) {
    // master_fields will cascade-delete if you have ON DELETE CASCADE on section_id FK,
    // otherwise delete fields first:
    await supabase.from('master_fields').delete().in('section_id', toDeleteSectionIds);
    const { error: delErr } = await supabase
      .from('master_sections')
      .delete()
      .in('id', toDeleteSectionIds);
    if (delErr) return res.status(500).json({ message: delErr.message });
  }

  console.log('im done with deleting sections')
 
  // ── 4. Upsert remaining sections + their fields ──────────────────────────
  
  const syncedSections = await upsertSectionsAndFields(id, sections || []);

  console.log('im done with syncing sections')
 
  return res.json({ master: updatedMaster, sections: syncedSections });
});
 
/* ─── Shared helper: upsert sections + fields for a master ───────────────── */
async function upsertSectionsAndFields(masterId, sections) {
  const results = [];
  let syncedFields = [];
 
  for (const [sIdx, section] of sections.entries()) {
    const sectionPayload = clean({
      master_id:     masterId,
      name:          section.name,
      slug:          section.slug,
      is_repeatable: section.is_repeatable ?? false,
      display_order:         sIdx,
    });
 
    let sectionRow;
 
    if (section.id && isValidUUID(section.id)) {
      // Update existing section
      const { data, error } = await supabase
        .from('master_sections')
        .update(sectionPayload)
        .eq('id', section.id)
        .eq('master_id', masterId)   // safety: don't update sections belonging to other masters
        .select()
        .single();
 
      if (error) throw new Error(`Section update failed: ${error.message}`);
      sectionRow = data;
    } else {
      // Insert new section
      const { data, error } = await supabase
        .from('master_sections')
        .insert(sectionPayload)
        .select()
        .single();
 
      if (error) throw new Error(`Section insert failed: ${error.message}`);
      sectionRow = data;
    }
 
    // ── Sync fields for this section ───────────────────────────────────────
    const incomingFieldIds = (section.fields || [])
      .map((f) => f.id)
      .filter(isValidUUID);
 
    // Delete fields that were removed in the UI
    const { data: existingFields } = await supabase
      .from('section_fields')
      .select('id')
      .eq('section_id', sectionRow.id);
 
    const existingFieldIds = (existingFields || []).map((f) => f.id);
    const toDeleteFieldIds = existingFieldIds.filter((eid) => !incomingFieldIds.includes(eid));
 
    if (toDeleteFieldIds.length > 0) {
      await supabase.from('master_fields').delete().in('id', toDeleteFieldIds);
    }
 
    // Upsert each field
    for (const [fIdx, field] of (section.fields || []).entries()) {
      const fieldPayload = clean({
        section_id:        sectionRow.id,
        label:             field.label,
        slug:              field.slug,
        field_type:        field.field_type,
        options:           field.options?.length ? field.options : null,
        related_master_id: field.related_master_id && isValidUUID(field.related_master_id)
                             ? field.related_master_id
                             : null,
        is_required:       field.is_required ?? false,
        display_order:             fIdx,
      });
 
      let fieldRow;
 
      if (field.id && isValidUUID(field.id)) {
        const { data, error } = await supabase
          .from('section_fields')
          .update(fieldPayload)
          .eq('id', field.id)
          .eq('section_id', sectionRow.id)
          .select()
          .single();
 
        if (error) throw new Error(`Field update failed: ${error.message}`);
        fieldRow = data;
      } else {
        const { data, error } = await supabase
          .from('section_fields')
          .insert(fieldPayload)
          .select()
          .single();
 
        if (error) throw new Error(`Field insert failed: ${error.message}`);
        fieldRow = data;
      }
 
      syncedFields.push(fieldRow);
      console.log(syncedFields)
    }
 
    results.push({ ...sectionRow, fields: syncedFields });
  }
 
  return results;
}


router.delete('/:id', wrap(async (req, res) => {
  const { id } = req.params

  const { data: sections } = await supabase
    .from('master_sections')
    .select('id')
    .eq('master_id', id)

  const sectionIds = sections?.map(s => s.id) || []

  if (sectionIds.length) {
    await supabase
      .from('section_fields')
      .delete()
      .in('section_id', sectionIds)

    await supabase
      .from('master_sections')
      .delete()
      .eq('master_id', id)
  }

  await supabase
    .from('masters')
    .delete()
    .eq('id', id)

  res.json({
    success: true
  })
}))


module.exports = router