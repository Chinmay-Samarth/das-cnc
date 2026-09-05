/**
 * Monthly payroll runs: generate from attendance + paid leave, recompute with formula versions.
 */

const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');
const {
  INPUT_KEYS,
  OUTPUT_KEYS,
  DEFAULT_FORMULAS,
  computeLine,
  normalizeFormulas,
  daysInMonth,
  toNumber,
} = require('./salaryFormulaEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRESENT_FAMILY = new Set(['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY']);
const EDITABLE_INPUT_KEYS = [
  'days_worked',
  'paid_leave',
  'earned_leave',
  'incentive_paid',
  'production_allowance',
  'basic',
];

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) {
    throw httpError('Invalid year or month');
  }
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDay = daysInMonth(y, m);
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { year: y, month: m, start, end, wagePeriod: endDay };
}

function parseOverrides(raw) {
  if (Array.isArray(raw)) return raw.filter((k) => typeof k === 'string');
  return [];
}

async function getLatestFormulaVersion() {
  const { data, error } = await supabase
    .from('salary_formula_versions')
    .select('*')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('No salary formula version configured', 500);
  return data;
}

async function getFormulaVersionById(id) {
  const { data, error } = await supabase
    .from('salary_formula_versions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Formula version not found', 404);
  return data;
}

async function listFormulaVersions() {
  const { data, error } = await supabase
    .from('salary_formula_versions')
    .select('*')
    .order('version_number', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createFormulaVersion({ formulas, label, createdBy }) {
  const normalized = normalizeFormulas(formulas);
  const latest = await getLatestFormulaVersion();
  const nextNumber = Number(latest.version_number || 0) + 1;
  const { data, error } = await supabase
    .from('salary_formula_versions')
    .insert({
      version_number: nextNumber,
      label: label || `Version ${nextNumber}`,
      effective_from: new Date().toISOString().slice(0, 10),
      formulas: normalized,
      created_by: createdBy || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateRun(year, month) {
  const bounds = monthBounds(year, month);
  const { data: existing, error } = await supabase
    .from('salary_payroll_runs')
    .select('*, formula_version:salary_formula_versions(*)')
    .eq('year', bounds.year)
    .eq('month', bounds.month)
    .maybeSingle();
  if (error) throw error;
  if (existing) {
    return {
      run: {
        ...existing,
        formula_version: existing.formula_version || null,
      },
      bounds,
      created: false,
    };
  }

  const formula = await getLatestFormulaVersion();
  const now = new Date().toISOString();
  const { data: created, error: cErr } = await supabase
    .from('salary_payroll_runs')
    .insert({
      year: bounds.year,
      month: bounds.month,
      status: 'draft',
      formula_version_id: formula.id,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (cErr) throw cErr;

  return {
    run: { ...created, formula_version: formula },
    bounds,
    created: true,
  };
}

/**
 * Days worked = unique calendar days with PRESENT / COMPLETED / LATE / HALF_DAY.
 * Matches Employee Details → Attendance tab "Present" tile.
 */
function countDaysWorked(records) {
  const presentDates = new Set();
  for (const r of records || []) {
    const status = String(r.status || '').toUpperCase();
    if (!PRESENT_FAMILY.has(status)) continue;
    const date = String(r.shift_date || '').slice(0, 10);
    if (date) presentDates.add(date);
  }
  return presentDates.size;
}

function overlapDaysInclusive(aStart, aEnd, bStart, bEnd) {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  return Math.floor((e - s) / 86400000) + 1;
}

/** Paginate past PostgREST max-rows (often 1000) so every attendance row is loaded. */
async function loadAttendanceByEmployee(employeeIds, start, end) {
  if (!employeeIds.length) return {};
  const map = {};
  const idChunkSize = 80;
  const pageSize = 1000;

  for (let i = 0; i < employeeIds.length; i += idChunkSize) {
    const chunk = employeeIds.slice(i, i + idChunkSize);
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('attendance_records')
        .select('employee_id, shift_date, status')
        .in('employee_id', chunk)
        .gte('shift_date', start)
        .lte('shift_date', end)
        .order('employee_id', { ascending: true })
        .order('shift_date', { ascending: true })
        .range(from, to);
      if (error) throw error;

      const rows = data || [];
      for (const row of rows) {
        if (!map[row.employee_id]) map[row.employee_id] = [];
        map[row.employee_id].push(row);
      }

      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return map;
}

async function loadPaidLeaveDaysByEmployee(employeeIds, start, end) {
  if (!employeeIds.length) return {};
  const map = {};
  const idChunkSize = 80;
  const pageSize = 1000;

  for (let i = 0; i < employeeIds.length; i += idChunkSize) {
    const chunk = employeeIds.slice(i, i + idChunkSize);
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('leave_requests')
        .select('employee_id, start_date, end_date, days, pay_type, status')
        .in('employee_id', chunk)
        .eq('status', 'approved')
        .eq('pay_type', 'paid')
        .lte('start_date', end)
        .gte('end_date', start)
        .order('employee_id', { ascending: true })
        .range(from, to);
      if (error) throw error;

      const rows = data || [];
      for (const row of rows) {
        const days = overlapDaysInclusive(row.start_date, row.end_date, start, end);
        map[row.employee_id] = (map[row.employee_id] || 0) + days;
      }

      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return map;
}

function buildLinePayload({
  runId,
  employeeId,
  formulaVersionId,
  inputs,
  outputs,
  overrides = [],
  formulas,
}) {
  const now = new Date().toISOString();
  return {
    run_id: runId,
    employee_id: employeeId,
    formula_version_id: formulaVersionId,
    wage_period: toNumber(inputs.wage_period),
    days_worked: toNumber(inputs.days_worked),
    paid_leave: toNumber(inputs.paid_leave),
    earned_leave: toNumber(inputs.earned_leave),
    basic: toNumber(inputs.basic),
    incentive_paid: toNumber(inputs.incentive_paid),
    production_allowance: toNumber(inputs.production_allowance),
    basic_earned: toNumber(outputs.basic_earned),
    allowance: toNumber(outputs.allowance),
    allowance_plus_pa: toNumber(outputs.allowance_plus_pa),
    total_earned: toNumber(outputs.total_earned),
    esi: toNumber(outputs.esi),
    pf: toNumber(outputs.pf),
    pt: toNumber(outputs.pt),
    total_deductions: toNumber(outputs.total_deductions),
    net_paid: toNumber(outputs.net_paid),
    manual_overrides: overrides,
    computed_snapshot: { inputs, outputs, formulas },
    updated_at: now,
  };
}

async function listLinesForRun(runId) {
  const { data, error } = await supabase
    .from('salary_payroll_lines')
    .select(
      `
      *,
      employee:employees!salary_payroll_lines_employee_id_fkey(
        id, full_name, employee_code, is_active, basic_salary, ESI_no,
        bank_name, bank_account_number, ifsc, account_type
      )
    `
    )
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data || []).map((row) => ({
    ...row,
    employee_name: row.employee?.full_name || null,
    employee_code: row.employee?.employee_code || null,
    employee_active: row.employee?.is_active ?? null,
    bank_name: row.employee?.bank_name || null,
    bank_account_number: row.employee?.bank_account_number || null,
    ifsc: row.employee?.ifsc || null,
    account_type: row.employee?.account_type || null,
    ESI_no: row.employee?.ESI_no || null,
    employee: undefined,
  }));
}

async function getPayroll(year, month) {
  const { run, bounds } = await getOrCreateRun(year, month);
  const lines = await listLinesForRun(run.id);
  return { run, lines, bounds };
}

async function generatePayroll(year, month, { preserveOverrides = true } = {}) {
  const { run, bounds } = await getOrCreateRun(year, month);
  if (run.status === 'locked') {
    throw httpError('Payroll month is locked and cannot be regenerated', 409);
  }

  // Draft months always recompute with the latest formula version (version control for history)
  const latestFormula = await getLatestFormulaVersion();
  if (run.formula_version_id !== latestFormula.id) {
    const { error: fvErr } = await supabase
      .from('salary_payroll_runs')
      .update({
        formula_version_id: latestFormula.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    if (fvErr) throw fvErr;
    run.formula_version_id = latestFormula.id;
    run.formula_version = latestFormula;
  }

  const formulaVersion = run.formula_version || latestFormula;
  const formulas = formulaVersion.formulas || DEFAULT_FORMULAS;

  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, basic_salary, is_active')
    .eq('is_active', true)
    .order('employee_code', { ascending: true });
  if (empErr) throw empErr;

  const employeeIds = (employees || []).map((e) => e.id);
  const existingLines = await listLinesForRun(run.id);
  const existingByEmp = Object.fromEntries(existingLines.map((l) => [l.employee_id, l]));

  const attendanceMap = await loadAttendanceByEmployee(employeeIds, bounds.start, bounds.end);
  const paidLeaveMap = await loadPaidLeaveDaysByEmployee(employeeIds, bounds.start, bounds.end);

  const upserts = [];
  for (const emp of employees || []) {
    const existing = existingByEmp[emp.id];
    const overrides = preserveOverrides ? parseOverrides(existing?.manual_overrides) : [];

    const autoDays = countDaysWorked(attendanceMap[emp.id]);
    const autoPaidLeave = paidLeaveMap[emp.id] || 0;
    const autoBasic = toNumber(emp.basic_salary, 0);

    const inputs = {
      wage_period: bounds.wagePeriod,
      days_worked: overrides.includes('days_worked')
        ? toNumber(existing.days_worked)
        : autoDays,
      paid_leave: overrides.includes('paid_leave')
        ? toNumber(existing.paid_leave)
        : autoPaidLeave,
      earned_leave: overrides.includes('earned_leave')
        ? toNumber(existing?.earned_leave, 0)
        : toNumber(existing?.earned_leave, 0),
      basic: overrides.includes('basic') ? toNumber(existing.basic) : autoBasic,
      incentive_paid: overrides.includes('incentive_paid')
        ? toNumber(existing?.incentive_paid, 0)
        : toNumber(existing?.incentive_paid, 0),
      production_allowance: overrides.includes('production_allowance')
        ? toNumber(existing?.production_allowance, 0)
        : toNumber(existing?.production_allowance, 0),
    };

    // Always refresh wage_period for the month
    inputs.wage_period = bounds.wagePeriod;

    const { outputs } = computeLine(inputs, formulas);
    const payload = buildLinePayload({
      runId: run.id,
      employeeId: emp.id,
      formulaVersionId: formulaVersion.id,
      inputs,
      outputs,
      overrides,
      formulas,
    });
    if (!existing) {
      payload.created_at = new Date().toISOString();
    } else {
      payload.id = existing.id;
    }
    upserts.push(payload);
  }

  if (upserts.length) {
    const { error: upErr } = await supabase
      .from('salary_payroll_lines')
      .upsert(upserts, { onConflict: 'run_id,employee_id' });
    if (upErr) throw upErr;
  }

  await supabase
    .from('salary_payroll_runs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', run.id);

  return getPayroll(year, month);
}

async function updatePayrollLine(lineId, patch, userId) {
  if (!isValidUUID(lineId)) throw httpError('Invalid line id');

  const { data: line, error } = await supabase
    .from('salary_payroll_lines')
    .select('*, run:salary_payroll_runs(*)')
    .eq('id', lineId)
    .maybeSingle();
  if (error) throw error;
  if (!line) throw httpError('Payroll line not found', 404);
  if (line.run?.status === 'locked') {
    throw httpError('Payroll month is locked', 409);
  }

  const formulaVersion = await getFormulaVersionById(line.formula_version_id);
  const overrides = new Set(parseOverrides(line.manual_overrides));

  const inputs = {
    wage_period: toNumber(line.wage_period),
    days_worked: toNumber(line.days_worked),
    paid_leave: toNumber(line.paid_leave),
    earned_leave: toNumber(line.earned_leave),
    basic: toNumber(line.basic),
    incentive_paid: toNumber(line.incentive_paid),
    production_allowance: toNumber(line.production_allowance),
  };

  for (const key of EDITABLE_INPUT_KEYS) {
    if (patch[key] !== undefined) {
      inputs[key] = toNumber(patch[key], 0);
      overrides.add(key);
    }
  }
  // wage_period is not manually overridable via patch for safety
  inputs.wage_period = toNumber(line.wage_period);

  const { outputs, formulas } = computeLine(inputs, formulaVersion.formulas);
  const payload = buildLinePayload({
    runId: line.run_id,
    employeeId: line.employee_id,
    formulaVersionId: formulaVersion.id,
    inputs,
    outputs,
    overrides: [...overrides],
    formulas,
  });

  const { data: updated, error: uErr } = await supabase
    .from('salary_payroll_lines')
    .update(payload)
    .eq('id', lineId)
    .select('*')
    .single();
  if (uErr) throw uErr;

  await supabase
    .from('salary_payroll_runs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', line.run_id);

  void userId;
  return updated;
}

async function lockPayroll(year, month, lockedBy) {
  const { run } = await getOrCreateRun(year, month);
  if (run.status === 'locked') {
    return getPayroll(year, month);
  }

  const lines = await listLinesForRun(run.id);
  if (!lines.length) {
    throw httpError('Generate payroll before locking the month', 400);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('salary_payroll_runs')
    .update({
      status: 'locked',
      locked_at: now,
      locked_by: lockedBy || null,
      updated_at: now,
    })
    .eq('id', run.id);
  if (error) throw error;

  return getPayroll(year, month);
}

async function getEmployeePayroll(employeeId, year, month) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee id');
  const { run, bounds } = await getOrCreateRun(year, month);
  const { data: line, error } = await supabase
    .from('salary_payroll_lines')
    .select('*')
    .eq('run_id', run.id)
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  return { run, line, bounds };
}

async function exportPayrollWorkbook(year, month) {
  let payload = await getPayroll(year, month);
  if (!payload.lines.length) {
    payload = await generatePayroll(year, month);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payroll');
  sheet.columns = [
    { header: 'SL.No', key: 'sl', width: 10 },
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Employee Code', key: 'code', width: 14 },
    { header: 'Wage Period', key: 'wage_period', width: 12 },
    { header: 'Days Worked', key: 'days_worked', width: 12 },
    { header: 'Paid Leave', key: 'paid_leave', width: 12 },
    { header: 'Earned Leave', key: 'earned_leave', width: 12 },
    { header: 'Basic', key: 'basic', width: 12 },
    { header: 'Basic Earned', key: 'basic_earned', width: 14 },
    { header: 'Allowance', key: 'allowance', width: 12 },
    { header: 'Incentive Paid', key: 'incentive_paid', width: 14 },
    { header: 'Production Allowance', key: 'production_allowance', width: 18 },
    { header: 'Allowance + Production Allowance', key: 'allowance_plus_pa', width: 22 },
    { header: 'Total Earned', key: 'total_earned', width: 14 },
    { header: 'ESI', key: 'esi', width: 12 },
    { header: 'PF', key: 'pf', width: 12 },
    { header: 'PT', key: 'pt', width: 10 },
    { header: 'Total', key: 'total_deductions', width: 12 },
    { header: 'Net Paid', key: 'net_paid', width: 14 },
  ];

  payload.lines.forEach((line, idx) => {
    sheet.addRow({
      sl: idx + 1,
      name: line.employee_name || '',
      code: line.employee_code || '',
      wage_period: Number(line.wage_period),
      days_worked: Number(line.days_worked),
      paid_leave: Number(line.paid_leave),
      earned_leave: Number(line.earned_leave),
      basic: Number(line.basic),
      basic_earned: Number(line.basic_earned),
      allowance: Number(line.allowance),
      incentive_paid: Number(line.incentive_paid),
      production_allowance: Number(line.production_allowance),
      allowance_plus_pa: Number(line.allowance_plus_pa),
      total_earned: Number(line.total_earned),
      esi: Number(line.esi),
      pf: Number(line.pf),
      pt: Number(line.pt),
      total_deductions: Number(line.total_deductions),
      net_paid: Number(line.net_paid),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `payroll-${payload.bounds.year}-${String(payload.bounds.month).padStart(2, '0')}.xlsx`;
  return { buffer, filename, payload };
}

module.exports = {
  INPUT_KEYS,
  OUTPUT_KEYS,
  EDITABLE_INPUT_KEYS,
  DEFAULT_FORMULAS,
  getPayroll,
  generatePayroll,
  updatePayrollLine,
  lockPayroll,
  getEmployeePayroll,
  exportPayrollWorkbook,
  listFormulaVersions,
  createFormulaVersion,
  getLatestFormulaVersion,
  monthBounds,
};
