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
  overtimeHourlyRateFromBasic,
} = require('./salaryFormulaEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRESENT_FAMILY = new Set(['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY']);
/** A full working day is 8.5 hours; anything beyond it on the same day is overtime. */
const FULL_DAY_MINUTES = 8.5 * 60;
const EDITABLE_INPUT_KEYS = ['basic', 'esi_basic'];

const OPTIONAL_LINE_COLUMNS = [
  'inc_plus_prod_all',
  'absent_days',
  'unauthorized_absent_days',
  'absent_deduction',
  'regular_earnings',
  'overtime_hours',
  'overtime_hourly_rate',
  'overtime_pay',
];
// esi_basic is required for dual-basic payroll — never treat as optional/strippable

/** Outputs are formula-driven — never accept manual output patches from the grid. */
const EDITABLE_OUTPUT_KEYS = [];
const EDITABLE_LINE_KEYS = [...EDITABLE_INPUT_KEYS];

const MANUAL_OVERRIDE_KEYS = new Set(['basic', 'esi_basic']);

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

/** Derived money fields that must stay formula-driven (never freeze via stale overrides). */
const DERIVED_GROSS_NET_KEYS = [
  'absent_deduction',
  'basic_earned',
  'allowance',
  'production_allowance',
  'inc_plus_prod_all',
  'allowance_plus_pa',
  'regular_earnings',
  'total_earned',
  'overtime_hourly_rate',
  'overtime_pay',
  'esi',
  'pf',
  'pt',
  'total_deductions',
  'net_paid',
];

function applyGrossAndNetGuarantees(row) {
  // Accounting column: always show LOP cut (not applied again to Net)
  row.absent_deduction =
    (toNumber(row.basic) / 30) * toNumber(row.absent_days) +
    (toNumber(row.basic) / 30) * toNumber(row.unauthorized_absent_days) * 1.5;

  const wage = toNumber(row.wage_period);
  const esiBasic = toNumber(row.esi_basic, 0);
  // Basic Earned = ESI basic / wage × paid days (no OT) — always resync
  if (wage > 0 && esiBasic > 0) {
    row.basic_earned =
      (esiBasic / wage) *
      (toNumber(row.days_worked) + toNumber(row.paid_leave) + toNumber(row.earned_leave));
  } else {
    row.basic_earned = 0;
  }
  row.allowance = toNumber(row.basic_earned) * 0.15;

  const otRate = overtimeHourlyRateFromBasic(row.basic);
  row.overtime_hourly_rate = otRate;
  row.overtime_pay = toNumber(row.overtime_hours) * otRate;

  // Gross for ESI / Net = company basic + OT − leave deductions
  row.total_earned =
    toNumber(row.basic) + toNumber(row.overtime_pay) - toNumber(row.absent_deduction);

  // PA = Total Earned − Basic Earned − Allowance
  row.production_allowance =
    toNumber(row.total_earned) -
    toNumber(row.basic_earned) -
    toNumber(row.allowance);

  row.inc_plus_prod_all =
    toNumber(row.incentive_paid) + toNumber(row.production_allowance);
  row.allowance_plus_pa =
    toNumber(row.allowance) + toNumber(row.production_allowance);

  row.regular_earnings =
    toNumber(row.basic_earned) +
    toNumber(row.allowance) +
    toNumber(row.production_allowance) +
    toNumber(row.incentive_paid);

  const pfBase = toNumber(row.basic_earned) + toNumber(row.allowance);
  row.pf = pfBase <= 15000 ? pfBase * 0.12 : 15000 * 0.12;

  const gross = toNumber(row.total_earned);
  row.esi = (gross * 0.75) / 100;
  row.pt = gross > 25000 ? 200 : 0;
  row.total_deductions = toNumber(row.esi) + toNumber(row.pf) + toNumber(row.pt);
  row.net_paid =
    toNumber(row.total_earned) -
    toNumber(row.esi) -
    toNumber(row.pf) -
    toNumber(row.pt);

  return row;
}

function stripDerivedOverrides(overrides) {
  const list = Array.isArray(overrides) ? overrides : [];
  // Only Basic / ESI Basic may remain as manual overrides; everything else is auto
  return list.filter((k) => MANUAL_OVERRIDE_KEYS.has(k));
}

function hydratePayrollLine(row) {
  if (!row) return row;
  const snapshotIn = row.computed_snapshot?.inputs || {};
  const snapshotOut = row.computed_snapshot?.outputs || {};
  const overrides = stripDerivedOverrides(parseOverrides(row.manual_overrides));
  row.manual_overrides = overrides;
  // Always normalize — ignore stale snapshot formulas that still use company basic
  const formulas = normalizeFormulas(
    row.computed_snapshot?.formulas || DEFAULT_FORMULAS
  );

  if (row.inc_plus_prod_all == null) {
    row.inc_plus_prod_all = toNumber(
      snapshotOut.inc_plus_prod_all,
      toNumber(row.incentive_paid) + toNumber(row.production_allowance)
    );
  }
  if (row.overtime_hours == null) {
    row.overtime_hours = toNumber(snapshotIn.overtime_hours, 0);
  }
  if (row.absent_days == null) {
    row.absent_days = toNumber(snapshotIn.absent_days, 0);
  }
  if (row.unauthorized_absent_days == null) {
    row.unauthorized_absent_days = toNumber(snapshotIn.unauthorized_absent_days, 0);
  }
  if (row.esi_basic == null) {
    row.esi_basic = toNumber(snapshotIn.esi_basic, 0);
  }
  if (row.absent_deduction == null) {
    row.absent_deduction = toNumber(snapshotOut.absent_deduction, 0);
  }

  // Recompute salary outputs so Total Earned always includes OT Pay (gross),
  // even when stored rows were generated with the old regular-only formula.
  const inputs = {
    wage_period: toNumber(row.wage_period, snapshotIn.wage_period),
    days_worked: toNumber(row.days_worked, snapshotIn.days_worked),
    absent_days: toNumber(row.absent_days, snapshotIn.absent_days),
    unauthorized_absent_days: toNumber(
      row.unauthorized_absent_days,
      snapshotIn.unauthorized_absent_days
    ),
    paid_leave: toNumber(row.paid_leave, snapshotIn.paid_leave),
    earned_leave: toNumber(row.earned_leave, snapshotIn.earned_leave),
    overtime_hours: toNumber(row.overtime_hours, snapshotIn.overtime_hours),
    basic: toNumber(row.basic, snapshotIn.basic),
    esi_basic: toNumber(row.esi_basic, toNumber(snapshotIn.esi_basic, 0)),
    incentive_paid: toNumber(row.incentive_paid, snapshotIn.incentive_paid),
  };

  const overrideValues = {};
  for (const key of OUTPUT_KEYS) {
    if (overrides.includes(key)) {
      overrideValues[key] = toNumber(row[key], toNumber(snapshotOut[key], 0));
    }
  }

  const { outputs } = computeLine(inputs, formulas, {
    overrides,
    values: overrideValues,
  });

  for (const key of OUTPUT_KEYS) {
    if (!overrides.includes(key)) {
      row[key] = outputs[key];
    } else if (row[key] == null) {
      row[key] = toNumber(snapshotOut[key], outputs[key]);
    }
  }

  return applyGrossAndNetGuarantees(row);
}

function stripUnknownColumn(payload, column) {
  if (Array.isArray(payload)) {
    return payload.map((row) => {
      const next = { ...row };
      delete next[column];
      return next;
    });
  }
  const next = { ...payload };
  delete next[column];
  return next;
}

function isMissingColumnError(error, column) {
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  const col = String(column || '').toLowerCase();
  if (!col) return false;
  // Must mention this column — do NOT treat every PGRST204 as a match for every optional field
  // (that previously stripped esi_basic while retrying unrelated missing columns).
  const mentionsColumn =
    msg.includes(`'${col}'`) ||
    msg.includes(`"${col}"`) ||
    msg.includes(`.${col}`) ||
    msg.includes(` ${col} `) ||
    msg.includes(`column ${col}`) ||
    msg.endsWith(col);
  if (!mentionsColumn) return false;
  return (
    error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
}

function missingOptionalColumn(error, payload) {
  const keys = Array.isArray(payload)
    ? OPTIONAL_LINE_COLUMNS.filter((col) => payload.some((row) => row && col in row))
    : OPTIONAL_LINE_COLUMNS.filter((col) => payload && col in payload);
  return keys.find((col) => isMissingColumnError(error, col)) || null;
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
 * Counts only rows already filtered to the payroll month.
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

function collectDatesByStatus(records, statuses) {
  const wanted = new Set((statuses || []).map((s) => String(s).toUpperCase()));
  const dates = new Set();
  for (const r of records || []) {
    const status = String(r.status || '').toUpperCase();
    if (!wanted.has(status)) continue;
    const date = String(r.shift_date || '').slice(0, 10);
    if (date) dates.add(date);
  }
  return dates;
}

function eachDateInclusive(startYmd, endYmd) {
  const out = [];
  if (!startYmd || !endYmd || startYmd > endYmd) return out;
  const cur = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Paid leave from approved leave_requests (pay_type=paid, defaulting like leave approve).
 * Those days count as attended for Basic Earned / LOP residual, but never increase days_worked.
 * Days already PRESENT-family are dropped from paid_leave so BE does not double-count.
 * Absent days:
 *  1) explicit ABSENT / unpaid LEAVE attendance, plus
 *  2) LOP residual when those status rows are missing:
 *     accountableDays − days_worked − paid_leave − earned_leave
 * For the current month, accountable days stop at today so future days are not LOP yet.
 */
function computeLeaveAndAbsent(
  records,
  leaveRows,
  monthStart,
  monthEnd,
  { daysWorked = null, earnedLeave = 0, wagePeriod = null } = {}
) {
  const paidLeaveDates = new Set();
  const unpaidLeaveDates = new Set();

  for (const row of leaveRows || []) {
    if (String(row.status || '').toLowerCase() !== 'approved') continue;
    const rangeStart = row.start_date > monthStart ? row.start_date : monthStart;
    const rangeEnd = row.end_date < monthEnd ? row.end_date : monthEnd;
    const dates = eachDateInclusive(rangeStart, rangeEnd);
    // Match leaveRequestEngine: anything other than explicit unpaid is paid
    const payType = String(row.pay_type || '').toLowerCase() === 'unpaid' ? 'unpaid' : 'paid';
    const target = payType === 'paid' ? paidLeaveDates : unpaidLeaveDates;
    for (const d of dates) target.add(d);
  }

  const absentAttendance = collectDatesByStatus(records, ['ABSENT']);
  const leaveAttendance = collectDatesByStatus(records, ['LEAVE']);
  const presentDates = collectDatesByStatus(records, [...PRESENT_FAMILY]);

  // Paid leave supplements attendance only — never stack on a day already worked
  for (const d of presentDates) {
    paidLeaveDates.delete(d);
    unpaidLeaveDates.delete(d);
  }

  const absentDates = new Set();
  for (const d of absentAttendance) {
    if (!paidLeaveDates.has(d) && !presentDates.has(d)) absentDates.add(d);
  }
  for (const d of unpaidLeaveDates) {
    if (!paidLeaveDates.has(d) && !presentDates.has(d)) absentDates.add(d);
  }
  for (const d of leaveAttendance) {
    if (!paidLeaveDates.has(d) && !presentDates.has(d)) absentDates.add(d);
  }

  const worked =
    daysWorked == null ? presentDates.size : toNumber(daysWorked, presentDates.size);
  const paidLeave = paidLeaveDates.size;
  const earned = toNumber(earnedLeave, 0);
  const accountableDays = accountableDaysInMonth(monthStart, monthEnd, wagePeriod);
  const residualAbsent = Math.max(0, accountableDays - worked - paidLeave - earned);
  const absentDays = Math.max(absentDates.size, residualAbsent);

  return {
    paid_leave: paidLeave,
    absent_days: absentDays,
  };
}

/** Calendar days in the payroll month that can already be treated as LOP-eligible. */
function accountableDaysInMonth(monthStart, monthEnd, wagePeriod = null) {
  const today = new Date().toISOString().slice(0, 10);
  const end = monthEnd < today ? monthEnd : today < monthStart ? monthStart : today;
  const elapsed = eachDateInclusive(monthStart, end).length;
  if (monthEnd < today && wagePeriod != null && Number(wagePeriod) > 0) {
    return Number(wagePeriod);
  }
  return elapsed;
}

/**
 * Overtime = minutes worked beyond 8.5 hours on a single calendar day,
 * summed only for the records passed in (already limited to one payroll month).
 */
function sumOvertimeHours(records) {
  const minutesByDate = new Map();
  for (const r of records || []) {
    const date = String(r.shift_date || '').slice(0, 10);
    if (!date) continue;
    minutesByDate.set(date, (minutesByDate.get(date) || 0) + toNumber(r.minutes_worked, 0));
  }

  let overtimeMinutes = 0;
  for (const dayMinutes of minutesByDate.values()) {
    overtimeMinutes += Math.max(0, dayMinutes - FULL_DAY_MINUTES);
  }
  return Math.round((overtimeMinutes / 60) * 10) / 10;
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
        .select('employee_id, shift_date, status, minutes_worked')
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

async function loadLeaveRequestsByEmployee(employeeIds, start, end) {
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
        .lte('start_date', end)
        .gte('end_date', start)
        .order('employee_id', { ascending: true })
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

/** @deprecated use loadLeaveRequestsByEmployee + computeLeaveAndAbsent */
async function loadPaidLeaveDaysByEmployee(employeeIds, start, end) {
  const leaveMap = await loadLeaveRequestsByEmployee(employeeIds, start, end);
  const map = {};
  for (const [employeeId, rows] of Object.entries(leaveMap)) {
    const { paid_leave } = computeLeaveAndAbsent([], rows, start, end);
    map[employeeId] = paid_leave;
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
    absent_days: toNumber(inputs.absent_days),
    unauthorized_absent_days: toNumber(inputs.unauthorized_absent_days),
    paid_leave: toNumber(inputs.paid_leave),
    earned_leave: toNumber(inputs.earned_leave),
    overtime_hours: toNumber(inputs.overtime_hours),
    basic: toNumber(inputs.basic),
    esi_basic: toNumber(inputs.esi_basic, 0),
    incentive_paid: toNumber(inputs.incentive_paid),
    production_allowance: toNumber(outputs.production_allowance),
    basic_earned: toNumber(outputs.basic_earned),
    allowance: toNumber(outputs.allowance),
    inc_plus_prod_all: toNumber(outputs.inc_plus_prod_all),
    allowance_plus_pa: toNumber(outputs.allowance_plus_pa),
    overtime_hourly_rate: toNumber(outputs.overtime_hourly_rate),
    overtime_pay: toNumber(outputs.overtime_pay),
    absent_deduction: toNumber(outputs.absent_deduction),
    regular_earnings: toNumber(outputs.regular_earnings),
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

  return (data || []).map((row) =>
    hydratePayrollLine({
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
    })
  );
}

async function getPayroll(year, month) {
  const { run, bounds } = await getOrCreateRun(year, month);
  let lines = await listLinesForRun(run.id);
  // Draft months always show live attendance stats for THIS month only
  // (days worked, absent days, overtime hours) so prior months never leak in.
  if (run.status !== 'locked' && lines.length) {
    const formulas =
      run.formula_version?.formulas ||
      (await getFormulaVersionById(run.formula_version_id)).formulas ||
      DEFAULT_FORMULAS;
    lines = await attachLiveAttendanceStats(lines, bounds, formulas);
    await persistLiveAttendanceStats(lines);
  }
  return { run, lines, bounds };
}

/**
 * Write live attendance + recomputed salary fields back to salary_payroll_lines
 * so absent_days / absent_deduction are stored, not only returned in the API.
 */
async function persistLiveAttendanceStats(lines) {
  if (!lines.length) return;
  const now = new Date().toISOString();
  const chunkSize = 40;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (line) => {
        if (!line?.id) return;
        // Do NOT write esi_basic / basic here — those are manual inputs.
        // Refresh derived amounts + drop stale derived overrides / snapshot formulas.
        const cleanedOverrides = stripDerivedOverrides(parseOverrides(line.manual_overrides));
        const inputs = {
          wage_period: toNumber(line.wage_period),
          days_worked: toNumber(line.days_worked),
          absent_days: toNumber(line.absent_days),
          unauthorized_absent_days: toNumber(line.unauthorized_absent_days),
          paid_leave: toNumber(line.paid_leave),
          earned_leave: toNumber(line.earned_leave),
          overtime_hours: toNumber(line.overtime_hours),
          basic: toNumber(line.basic),
          esi_basic: toNumber(line.esi_basic, 0),
          incentive_paid: toNumber(line.incentive_paid),
        };
        const outputs = {
          absent_deduction: toNumber(line.absent_deduction),
          overtime_hourly_rate: toNumber(line.overtime_hourly_rate),
          overtime_pay: toNumber(line.overtime_pay),
          basic_earned: toNumber(line.basic_earned),
          allowance: toNumber(line.allowance),
          production_allowance: toNumber(line.production_allowance),
          inc_plus_prod_all: toNumber(line.inc_plus_prod_all),
          allowance_plus_pa: toNumber(line.allowance_plus_pa),
          regular_earnings: toNumber(line.regular_earnings),
          total_earned: toNumber(line.total_earned),
          esi: toNumber(line.esi),
          pf: toNumber(line.pf),
          pt: toNumber(line.pt),
          total_deductions: toNumber(line.total_deductions),
          net_paid: toNumber(line.net_paid),
        };
        const payload = {
          days_worked: inputs.days_worked,
          absent_days: inputs.absent_days,
          unauthorized_absent_days: inputs.unauthorized_absent_days,
          paid_leave: inputs.paid_leave,
          overtime_hours: inputs.overtime_hours,
          absent_deduction: outputs.absent_deduction,
          production_allowance: outputs.production_allowance,
          basic_earned: outputs.basic_earned,
          allowance: outputs.allowance,
          inc_plus_prod_all: outputs.inc_plus_prod_all,
          allowance_plus_pa: outputs.allowance_plus_pa,
          overtime_hourly_rate: outputs.overtime_hourly_rate,
          overtime_pay: outputs.overtime_pay,
          regular_earnings: outputs.regular_earnings,
          total_earned: outputs.total_earned,
          esi: outputs.esi,
          pf: outputs.pf,
          pt: outputs.pt,
          total_deductions: outputs.total_deductions,
          net_paid: outputs.net_paid,
          manual_overrides: cleanedOverrides,
          computed_snapshot: {
            inputs,
            outputs,
            formulas: normalizeFormulas(DEFAULT_FORMULAS),
          },
          updated_at: now,
        };
        let body = payload;
        for (let attempt = 0; attempt <= OPTIONAL_LINE_COLUMNS.length; attempt++) {
          const { error } = await supabase
            .from('salary_payroll_lines')
            .update(body)
            .eq('id', line.id);
          if (!error) break;
          const missing = missingOptionalColumn(error, body);
          if (!missing) {
            console.error('persistLiveAttendanceStats failed:', error.message || error);
            break;
          }
          body = stripUnknownColumn(body, missing);
        }
      })
    );
  }
}

/**
 * Fill days_worked / paid_leave / absent_days / overtime_* from attendance + leave_requests,
 * then recompute salary. Absent deduction is shown for accounting; net uses
 * paid-days Basic Earned (no second LOP cut).
 */
async function attachLiveAttendanceStats(lines, bounds, formulas = DEFAULT_FORMULAS) {
  const employeeIds = [...new Set(lines.map((l) => l.employee_id).filter(Boolean))];
  const attendanceMap = await loadAttendanceByEmployee(
    employeeIds,
    bounds.start,
    bounds.end
  );
  const leaveMap = await loadLeaveRequestsByEmployee(
    employeeIds,
    bounds.start,
    bounds.end
  );

  return lines.map((line) => {
    const overrides = stripDerivedOverrides(parseOverrides(line.manual_overrides));
    const monthRecords = attendanceMap[line.employee_id] || [];
    const leaveRows = leaveMap[line.employee_id] || [];
    const worked = overrides.includes('days_worked')
      ? toNumber(line.days_worked)
      : countDaysWorked(monthRecords);
    const earnedLeave = overrides.includes('earned_leave')
      ? toNumber(line.earned_leave)
      : toNumber(line.earned_leave, 0);
    const leaveStats = computeLeaveAndAbsent(
      monthRecords,
      leaveRows,
      bounds.start,
      bounds.end,
      {
        daysWorked: worked,
        earnedLeave,
        wagePeriod: bounds.wagePeriod,
      }
    );
    const next = { ...line, manual_overrides: overrides };

    if (!overrides.includes('days_worked')) {
      next.days_worked = worked;
    }
    if (!overrides.includes('paid_leave')) {
      next.paid_leave = leaveStats.paid_leave;
    }
    if (!overrides.includes('absent_days')) {
      next.absent_days = leaveStats.absent_days;
    }
    if (!overrides.includes('overtime_hours')) {
      next.overtime_hours = sumOvertimeHours(monthRecords);
    }

    const inputs = {
      wage_period: toNumber(next.wage_period, bounds.wagePeriod),
      days_worked: toNumber(next.days_worked),
      absent_days: toNumber(next.absent_days),
      unauthorized_absent_days: toNumber(next.unauthorized_absent_days),
      paid_leave: toNumber(next.paid_leave),
      earned_leave: toNumber(next.earned_leave),
      overtime_hours: toNumber(next.overtime_hours),
      basic: toNumber(next.basic),
      esi_basic: toNumber(next.esi_basic, 0),
      incentive_paid: toNumber(next.incentive_paid),
    };

    const overrideValues = {};
    for (const key of OUTPUT_KEYS) {
      if (overrides.includes(key)) {
        overrideValues[key] = toNumber(next[key], 0);
      }
    }

    const { outputs } = computeLine(inputs, formulas, {
      overrides,
      values: overrideValues,
    });

    for (const key of OUTPUT_KEYS) {
      if (!overrides.includes(key)) {
        next[key] = outputs[key];
      }
    }

    return applyGrossAndNetGuarantees(next);
  });
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
    .select('id, full_name, employee_code, basic_salary, esi_basic_salary, is_active')
    .eq('is_active', true)
    .order('employee_code', { ascending: true });
  let employeeRows = employees;
  if (empErr) {
    // Older DBs may not have esi_basic_salary yet
    const retry = await supabase
      .from('employees')
      .select('id, full_name, employee_code, basic_salary, is_active')
      .eq('is_active', true)
      .order('employee_code', { ascending: true });
    if (retry.error) throw empErr;
    employeeRows = retry.data;
  }

  const employeeIds = (employeeRows || []).map((e) => e.id);
  const existingLines = await listLinesForRun(run.id);
  const existingByEmp = Object.fromEntries(existingLines.map((l) => [l.employee_id, l]));

  const attendanceMap = await loadAttendanceByEmployee(employeeIds, bounds.start, bounds.end);
  const leaveMap = await loadLeaveRequestsByEmployee(employeeIds, bounds.start, bounds.end);

  const upserts = [];
  for (const emp of employeeRows || []) {
    const existing = existingByEmp[emp.id];
    const overrides = stripDerivedOverrides(
      preserveOverrides ? parseOverrides(existing?.manual_overrides) : []
    );

    const monthRecords = attendanceMap[emp.id] || [];
    const autoDays = countDaysWorked(monthRecords);
    const earnedLeave = overrides.includes('earned_leave')
      ? toNumber(existing?.earned_leave, 0)
      : toNumber(existing?.earned_leave, 0);
    const leaveStats = computeLeaveAndAbsent(
      monthRecords,
      leaveMap[emp.id] || [],
      bounds.start,
      bounds.end,
      {
        daysWorked: overrides.includes('days_worked')
          ? toNumber(existing.days_worked)
          : autoDays,
        earnedLeave,
        wagePeriod: bounds.wagePeriod,
      }
    );
    const autoAbsentDays = leaveStats.absent_days;
    const autoPaidLeave = leaveStats.paid_leave;
    const autoBasic = toNumber(emp.basic_salary, 0);
    // ESI basic is manual — only use employee master if explicitly set; else leave blank (0)
    const autoEsiBasic = toNumber(emp.esi_basic_salary, 0);
    const autoOvertimeHours = sumOvertimeHours(monthRecords);

    const inputs = {
      wage_period: bounds.wagePeriod,
      days_worked: overrides.includes('days_worked')
        ? toNumber(existing.days_worked)
        : autoDays,
      absent_days: overrides.includes('absent_days')
        ? toNumber(existing?.absent_days, 0)
        : autoAbsentDays,
      unauthorized_absent_days: overrides.includes('unauthorized_absent_days')
        ? toNumber(existing?.unauthorized_absent_days, 0)
        : toNumber(existing?.unauthorized_absent_days, 0),
      paid_leave: overrides.includes('paid_leave')
        ? toNumber(existing.paid_leave)
        : autoPaidLeave,
      earned_leave: overrides.includes('earned_leave')
        ? toNumber(existing?.earned_leave, 0)
        : toNumber(existing?.earned_leave, 0),
      overtime_hours: overrides.includes('overtime_hours')
        ? toNumber(existing?.overtime_hours, 0)
        : autoOvertimeHours,
      basic: overrides.includes('basic') ? toNumber(existing.basic) : autoBasic,
      esi_basic: (() => {
        if (overrides.includes('esi_basic')) {
          return toNumber(existing?.esi_basic, 0);
        }
        const stored = toNumber(existing?.esi_basic, 0);
        if (stored > 0) return stored;
        return autoEsiBasic;
      })(),
      incentive_paid: overrides.includes('incentive_paid')
        ? toNumber(existing?.incentive_paid, 0)
        : toNumber(existing?.incentive_paid, 0),
    };

    // Always refresh wage_period for the month
    inputs.wage_period = bounds.wagePeriod;

    const overrideValues = {};
    for (const key of OUTPUT_KEYS) {
      if (overrides.includes(key)) {
        overrideValues[key] = toNumber(existing?.[key], 0);
      }
    }
    const { outputs } = computeLine(inputs, formulas, {
      overrides,
      values: overrideValues,
    });
    const synced = applyGrossAndNetGuarantees({ ...inputs, ...outputs });
    const payload = buildLinePayload({
      runId: run.id,
      employeeId: emp.id,
      formulaVersionId: formulaVersion.id,
      inputs,
      outputs: synced,
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
    let rows = upserts;
    let lastErr = null;
    for (let attempt = 0; attempt <= OPTIONAL_LINE_COLUMNS.length; attempt++) {
      const { error: upErr } = await supabase
        .from('salary_payroll_lines')
        .upsert(rows, { onConflict: 'run_id,employee_id' });
      if (!upErr) {
        lastErr = null;
        break;
      }
      lastErr = upErr;
      const missing = missingOptionalColumn(upErr, rows);
      if (!missing) break;
      rows = stripUnknownColumn(rows, missing);
    }
    if (lastErr) throw lastErr;
  }

  await supabase
    .from('salary_payroll_runs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', run.id);

  return getPayroll(year, month);
}

async function updatePayrollLine(lineId, patch, userId) {
  if (!isValidUUID(lineId)) throw httpError('Invalid line id');

  const { data: lineRaw, error } = await supabase
    .from('salary_payroll_lines')
    .select('*, run:salary_payroll_runs(*)')
    .eq('id', lineId)
    .maybeSingle();
  if (error) throw error;
  if (!lineRaw) throw httpError('Payroll line not found', 404);
  const line = hydratePayrollLine(lineRaw);
  if (line.run?.status === 'locked') {
    throw httpError('Payroll month is locked', 409);
  }

  const formulaVersion = await getFormulaVersionById(line.formula_version_id);
  const overrides = new Set(
    stripDerivedOverrides(parseOverrides(line.manual_overrides))
  );

  const inputs = {
    wage_period: toNumber(line.wage_period),
    days_worked: toNumber(line.days_worked),
    absent_days: toNumber(line.absent_days),
    unauthorized_absent_days: toNumber(line.unauthorized_absent_days),
    paid_leave: toNumber(line.paid_leave),
    earned_leave: toNumber(line.earned_leave),
    overtime_hours: toNumber(line.overtime_hours),
    basic: toNumber(line.basic),
    esi_basic: toNumber(line.esi_basic, 0),
    incentive_paid: toNumber(line.incentive_paid),
  };

  for (const key of EDITABLE_INPUT_KEYS) {
    if (patch[key] !== undefined) {
      inputs[key] = toNumber(patch[key], 0);
      overrides.add(key);
    }
  }
  // wage_period is not manually overridable via patch for safety
  inputs.wage_period = toNumber(line.wage_period);

  const overrideValues = {};
  for (const key of OUTPUT_KEYS) {
    overrideValues[key] = toNumber(line[key], 0);
    // Outputs are never manually patched — always formula / guarantee driven
  }

  // Recalculate all derived fields (nothing stays frozen except basic / esi_basic)

  const { outputs, formulas } = computeLine(inputs, formulaVersion.formulas, {
    overrides: [...overrides],
    values: overrideValues,
  });
  const synced = applyGrossAndNetGuarantees({
    ...inputs,
    ...outputs,
  });
  // Prefer explicit patch / inputs for company + ESI basic (guarantees only touch derived $)
  synced.basic = toNumber(inputs.basic);
  synced.esi_basic = toNumber(inputs.esi_basic, 0);
  const payload = buildLinePayload({
    runId: line.run_id,
    employeeId: line.employee_id,
    formulaVersionId: formulaVersion.id,
    inputs: {
      ...inputs,
      esi_basic: synced.esi_basic,
    },
    outputs: synced,
    overrides: [...overrides],
    formulas,
  });

  let body = payload;
  let updated = null;
  let lastErr = null;
  for (let attempt = 0; attempt <= OPTIONAL_LINE_COLUMNS.length; attempt++) {
    const { data, error: uErr } = await supabase
      .from('salary_payroll_lines')
      .update(body)
      .eq('id', lineId)
      .select('*')
      .single();
    if (!uErr) {
      updated = data;
      lastErr = null;
      break;
    }
    lastErr = uErr;
    const missing = missingOptionalColumn(uErr, body);
    if (!missing) break;
    // Never drop esi_basic / basic on optional-column retry — those must persist
    if (missing === 'esi_basic' || missing === 'basic') break;
    body = stripUnknownColumn(body, missing);
  }
  if (lastErr) throw lastErr;

  // Hard guarantee: basics + overrides always land even if a prior select omit/schema glitch
  const forcedBasics = {
    basic: toNumber(synced.basic),
    esi_basic: toNumber(synced.esi_basic, 0),
    manual_overrides: [...overrides],
    computed_snapshot: payload.computed_snapshot,
    updated_at: new Date().toISOString(),
  };
  {
    const { data: forced, error: forceErr } = await supabase
      .from('salary_payroll_lines')
      .update(forcedBasics)
      .eq('id', lineId)
      .select('*')
      .single();
    if (forceErr) {
      console.error('payroll forced basic/esi_basic write failed:', forceErr.message || forceErr);
      throw httpError(
        forceErr.message || 'Could not save Basic / ESI Basic — check database schema',
        500
      );
    }
    updated = forced || updated;
  }

  // Keep employee master ESI basic in sync when payroll line saves it
  if (patch.esi_basic !== undefined && line.employee_id) {
    const esiVal = toNumber(synced.esi_basic);
    await supabase
      .from('employees')
      .update({ esi_basic_salary: esiVal > 0 ? esiVal : null })
      .eq('id', line.employee_id);
  }

  await supabase
    .from('salary_payroll_runs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', line.run_id);

  void userId;
  return hydratePayrollLine({
    ...updated,
    esi_basic: toNumber(
      updated?.esi_basic !== undefined && updated?.esi_basic !== null
        ? updated.esi_basic
        : synced.esi_basic,
      synced.esi_basic
    ),
    basic: toNumber(
      updated?.basic !== undefined && updated?.basic !== null ? updated.basic : synced.basic,
      synced.basic
    ),
    manual_overrides: [...overrides],
  });
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
  return { run, line: hydratePayrollLine(line), bounds };
}

/**
 * Export payroll as .xlsx matching the current Payroll grid formulas:
 *   OT rate = basic/170
 *   Absent cut = basic/30 × absent (+ unauthorized × 1.5)
 *   OT pay = hours × rate
 *   Total Earned = basic + OT pay − absent cut
 *   Basic Earned = esi_basic / wage × (worked + paid leave + earned leave)
 *   Allowance = BE × 15%
 *   PA = total_earned − basic_earned − allowance
 *   Net = total_earned − ESI − PF − PT
 * Calculated cells carry live Excel formulas (with cached values).
 */
async function exportPayrollWorkbook(year, month) {
  let payload = await getPayroll(year, month);
  if (!payload.lines.length) {
    payload = await generatePayroll(year, month);
  }

  const lines = (payload.lines || []).map((line) =>
    applyGrossAndNetGuarantees({ ...line })
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DasCNC';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Payroll', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });

  // Column order matches PayrollPage ATTENDANCE_COLUMNS + SALARY_COLUMNS
  const headers = [
    'SL.No',
    'Name',
    'Employee Code',
    'Wage Period',
    'Days Worked',
    'Paid Leave',
    'Earned Leave',
    'Absent Days',
    'Unauthorized Absent',
    'Overtime Hourly Rate',
    'Total Overtime (hrs)',
    'Basic',
    'Absent Deduction',
    'Overtime Pay',
    'Total Earned',
    'ESI Basic',
    'Basic Earned',
    'Allowance',
    'Incentive Paid',
    'Production Allowance',
    'Inc+ Prod All',
    'Allowance + Production Allowance',
    'ESI',
    'PF',
    'PT',
    'Total',
    'Net Paid',
  ];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };

  const widths = [
    8, 24, 14, 12, 12, 12, 12, 12, 14, 14, 14, 12, 14, 12, 12, 12, 12, 12, 12, 16,
    12, 18, 10, 10, 8, 10, 12,
  ];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  lines.forEach((line, idx) => {
    const r = idx + 2; // Excel row (row 1 = headers)
    const row = sheet.getRow(r);

    // Inputs / attendance (values)
    row.getCell(1).value = idx + 1; // A SL.No
    row.getCell(2).value = line.employee_name || ''; // B Name
    row.getCell(3).value = line.employee_code || ''; // C Code
    row.getCell(4).value = toNumber(line.wage_period); // D Wage Period
    row.getCell(5).value = toNumber(line.days_worked); // E Days Worked
    row.getCell(6).value = toNumber(line.paid_leave); // F Paid Leave
    row.getCell(7).value = toNumber(line.earned_leave); // G Earned Leave
    row.getCell(8).value = toNumber(line.absent_days); // H Absent Days
    row.getCell(9).value = toNumber(line.unauthorized_absent_days); // I Unauth
    row.getCell(11).value = toNumber(line.overtime_hours); // K OT hours
    row.getCell(12).value = toNumber(line.basic); // L Basic
    row.getCell(16).value = toNumber(line.esi_basic, 0); // P ESI Basic
    row.getCell(19).value = toNumber(line.incentive_paid); // S Incentive

    // Formulas (current methodology) — result cached for offline openers
    // J Overtime Hourly Rate = basic / 170
    row.getCell(10).value = { formula: `IF(L${r}>0,L${r}/170,0)`, result: toNumber(line.overtime_hourly_rate) };
    // M Absent Deduction = basic/30*absent + basic/30*unauth*1.5
    row.getCell(13).value = {
      formula: `L${r}/30*H${r}+L${r}/30*I${r}*1.5`,
      result: toNumber(line.absent_deduction),
    };
    // N Overtime Pay = hours × rate
    row.getCell(14).value = {
      formula: `K${r}*J${r}`,
      result: toNumber(line.overtime_pay),
    };
    // O Total Earned = basic + OT − absent
    row.getCell(15).value = {
      formula: `L${r}+N${r}-M${r}`,
      result: toNumber(line.total_earned),
    };
    // Q Basic Earned = esi_basic / wage × (worked + paid + earned)
    row.getCell(17).value = {
      formula: `IF(AND(D${r}>0,P${r}>0),P${r}/D${r}*(E${r}+F${r}+G${r}),0)`,
      result: toNumber(line.basic_earned),
    };
    // R Allowance = BE * 15%
    row.getCell(18).value = {
      formula: `Q${r}*0.15`,
      result: toNumber(line.allowance),
    };
    // T Production Allowance = total_earned − basic_earned − allowance
    row.getCell(20).value = {
      formula: `O${r}-Q${r}-R${r}`,
      result: toNumber(line.production_allowance),
    };
    // U Inc+ Prod All
    row.getCell(21).value = {
      formula: `S${r}+T${r}`,
      result: toNumber(line.inc_plus_prod_all),
    };
    // V Allowance + Production Allowance
    row.getCell(22).value = {
      formula: `R${r}+T${r}`,
      result: toNumber(line.allowance_plus_pa),
    };
    // W ESI = total_earned * 0.75%
    row.getCell(23).value = {
      formula: `O${r}*0.75/100`,
      result: toNumber(line.esi),
    };
    // X PF (capped)
    row.getCell(24).value = {
      formula: `IF((Q${r}+R${r})<=15000,(Q${r}+R${r})*0.12,15000*0.12)`,
      result: toNumber(line.pf),
    };
    // Y PT
    row.getCell(25).value = {
      formula: `IF(O${r}>25000,200,0)`,
      result: toNumber(line.pt),
    };
    // Z Total deductions
    row.getCell(26).value = {
      formula: `W${r}+X${r}+Y${r}`,
      result: toNumber(line.total_deductions),
    };
    // AA Net Paid
    row.getCell(27).value = {
      formula: `O${r}-W${r}-X${r}-Y${r}`,
      result: toNumber(line.net_paid),
    };

    for (let c = 1; c <= 27; c += 1) {
      const cell = row.getCell(c);
      if (c >= 10 && c !== 11) {
        cell.numFmt = '#,##0.00';
      } else if ([4, 5, 6, 7, 8, 9, 11].includes(c)) {
        cell.numFmt = '0.##';
      }
    }
  });

  // Second sheet: formula legend matching the Formulas panel
  const legend = workbook.addWorksheet('Formulas');
  legend.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Excel formula (per row)', key: 'formula', width: 72 },
  ];
  legend.getRow(1).font = { bold: true };
  const legendRows = [
    ['Overtime Hourly Rate', 'Basic / 170'],
    ['Absent Deduction', 'Basic/30 × Absent Days + Basic/30 × Unauthorized Absent × 1.5'],
    ['Overtime Pay', 'Total Overtime (hrs) × Overtime Hourly Rate'],
    ['Total Earned', 'Basic + Overtime Pay − Absent Deduction'],
    ['Basic Earned', 'ESI Basic / Wage Period × (Days Worked + Paid Leave + Earned Leave)'],
    ['Allowance', 'Basic Earned × 15%'],
    ['Production Allowance', 'Total Earned − Basic Earned − Allowance'],
    ['Inc+ Prod All', 'Incentive Paid + Production Allowance'],
    ['Allowance + Production Allowance', 'Allowance + Production Allowance'],
    ['ESI', 'Total Earned × 0.75%'],
    ['PF', '12% of (Basic Earned + Allowance), capped at ₹15,000 wage base'],
    ['PT', '200 if Total Earned > 25000, else 0'],
    ['Total', 'ESI + PF + PT'],
    ['Net Paid', 'Total Earned − ESI − PF − PT'],
  ];
  for (const [field, formula] of legendRows) {
    legend.addRow({ field, formula });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `payroll-${payload.bounds.year}-${String(payload.bounds.month).padStart(2, '0')}.xlsx`;
  return { buffer, filename, payload: { ...payload, lines } };
}


module.exports = {
  INPUT_KEYS,
  OUTPUT_KEYS,
  EDITABLE_INPUT_KEYS,
  EDITABLE_OUTPUT_KEYS,
  EDITABLE_LINE_KEYS,
  DEFAULT_FORMULAS,
  normalizeFormulas,
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
  // Exported for unit tests
  computeLeaveAndAbsent,
  countDaysWorked,
};
