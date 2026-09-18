/**
 * Safe salary formula evaluator + Excel-baseline compute helpers.
 * Supports arithmetic, comparisons, parentheses, and IF(cond, a, b).
 *
 * Dual basic model:
 * - basic = company / "our" basic (manual / employee master)
 * - esi_basic = ESI submission basic (blank until entered manually)
 *
 * - Basic Earned = esi_basic / wage_period × (days_worked + paid_leave + earned_leave) (no OT)
 * - Allowance = 15% of Basic Earned
 * - Production Allowance = (company basic − Basic Earned) + Allowance
 * - Absent Deduction = company basic/30 × absent (+ unauthorized × 1.5) — accounting only
 * - OT Hourly Rate = company basic / 170
 * - Total Earned = company basic + overtime_pay − absent_deduction (leave cut)
 * - ESI on total_earned @ 0.75%; PF on basic_earned+allowance (capped); PT on total_earned
 * - Net Paid = total_earned − ESI − PF − PT
 */

const INPUT_KEYS = [
  'wage_period',
  'days_worked',
  'absent_days',
  'unauthorized_absent_days',
  'paid_leave',
  'earned_leave',
  'overtime_hours',
  'basic',
  'esi_basic',
  'incentive_paid',
];

const OUTPUT_KEYS = [
  'absent_deduction',
  'overtime_hourly_rate',
  'overtime_pay',
  'basic_earned',
  'allowance',
  'production_allowance',
  'inc_plus_prod_all',
  'allowance_plus_pa',
  'regular_earnings',
  'total_earned',
  'esi',
  'pf',
  'pt',
  'total_deductions',
  'net_paid',
];

const COMPUTE_ORDER = [...OUTPUT_KEYS];

const DEFAULT_FORMULAS = {
  // Company basic → LOP cut (accounting only)
  absent_deduction:
    'basic / 30 * absent_days + basic / 30 * unauthorized_absent_days * 1.5',
  overtime_hourly_rate: 'basic / 170',
  overtime_pay: 'overtime_hours * overtime_hourly_rate',
  // ESI basic → pro-rata paid days (worked + paid leave + earned leave); OT not included
  basic_earned:
    'IF(wage_period > 0, IF(esi_basic > 0, esi_basic / wage_period * (days_worked + paid_leave + earned_leave), 0), 0)',
  allowance: 'basic_earned * 0.15',
  // PA = (company basic − basic earned) + allowance
  production_allowance: 'basic - basic_earned + allowance',
  inc_plus_prod_all: 'incentive_paid + production_allowance',
  allowance_plus_pa: 'allowance + production_allowance',
  regular_earnings:
    'basic_earned + allowance + production_allowance + incentive_paid',
  // Company basic + OT − leave (absent) deductions — not ESI basic
  total_earned: 'basic + overtime_pay - absent_deduction',
  esi: 'total_earned * 0.75 / 100',
  pf: 'IF((basic_earned + allowance) <= 15000, (basic_earned + allowance) * 0.12, 15000 * 0.12)',
  pt: 'IF(total_earned > 25000, 200, 0)',
  total_deductions: 'esi + pf + pt',
  net_paid: 'total_earned - esi - pf - pt',
};

const ALLOWED_IDENTIFIERS = new Set([...INPUT_KEYS, ...OUTPUT_KEYS]);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Company OT rate: Basic / 170 */
function overtimeHourlyRateFromBasic(basic) {
  const b = toNumber(basic, 0);
  if (b <= 0) return 0;
  return b / 170;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tokenize(expr) {
  const src = String(expr || '').trim();
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ('(),+-*/'.includes(ch)) {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '=' || ch === '!') {
      let op = ch;
      if (i + 1 < src.length && src[i + 1] === '=') {
        op += '=';
        i += 2;
      } else {
        i += 1;
      }
      if (op === '=') op = '==';
      tokens.push({ type: 'op', value: op });
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && i + 1 < src.length && /\d/.test(src[i + 1]))) {
      let num = '';
      while (i < src.length && /[\d.]/.test(src[i])) {
        num += src[i];
        i += 1;
      }
      tokens.push({ type: 'number', value: Number(num) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let id = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) {
        id += src[i];
        i += 1;
      }
      if (id.toUpperCase() === 'IF') {
        tokens.push({ type: 'if' });
      } else {
        if (!ALLOWED_IDENTIFIERS.has(id)) {
          throw httpError(`Unknown identifier: ${id}`);
        }
        tokens.push({ type: 'id', value: id });
      }
      continue;
    }
    throw httpError(`Unexpected character: ${ch}`);
  }
  return tokens;
}

function parseExpression(tokens) {
  let pos = 0;

  function peek() {
    return tokens[pos];
  }
  function consume() {
    const t = tokens[pos];
    pos += 1;
    return t;
  }
  function expect(type) {
    const t = peek();
    if (!t || t.type !== type) throw httpError(`Expected ${type}`);
    return consume();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw httpError('Unexpected end of formula');
    if (t.type === 'number') {
      consume();
      return { type: 'number', value: t.value };
    }
    if (t.type === 'id') {
      consume();
      return { type: 'id', value: t.value };
    }
    if (t.type === '(') {
      consume();
      const expr = parseCmp();
      expect(')');
      return expr;
    }
    if (t.type === 'if') {
      consume();
      expect('(');
      const cond = parseCmp();
      expect(',');
      const thenBranch = parseCmp();
      expect(',');
      const elseBranch = parseCmp();
      expect(')');
      return { type: 'if', cond, thenBranch, elseBranch };
    }
    if (t.type === '-' || t.type === '+') {
      const op = consume().type;
      const arg = parsePrimary();
      return op === '-' ? { type: 'unary', op: '-', arg } : arg;
    }
    throw httpError(`Unexpected token: ${t.type}`);
  }

  function parseMul() {
    let left = parsePrimary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = consume().type;
      const right = parsePrimary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const right = parseMul();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  function parseCmp() {
    let left = parseAdd();
    while (
      peek() &&
      peek().type === 'op' &&
      ['>', '<', '>=', '<=', '==', '!=', '===', '!=='].includes(peek().value)
    ) {
      const op = consume().value;
      const right = parseAdd();
      left = { type: 'cmp', op, left, right };
    }
    return left;
  }

  const ast = parseCmp();
  if (pos < tokens.length) throw httpError('Unexpected trailing tokens');
  return ast;
}

function evalAst(ast, vars) {
  switch (ast.type) {
    case 'number':
      return ast.value;
    case 'id':
      return toNumber(vars[ast.value], 0);
    case 'unary':
      return ast.op === '-' ? -evalAst(ast.arg, vars) : evalAst(ast.arg, vars);
    case 'binary': {
      const a = evalAst(ast.left, vars);
      const b = evalAst(ast.right, vars);
      if (ast.op === '+') return a + b;
      if (ast.op === '-') return a - b;
      if (ast.op === '*') return a * b;
      if (ast.op === '/') return b === 0 ? 0 : a / b;
      throw httpError(`Unknown operator ${ast.op}`);
    }
    case 'cmp': {
      const a = evalAst(ast.left, vars);
      const b = evalAst(ast.right, vars);
      if (ast.op === '>') return a > b ? 1 : 0;
      if (ast.op === '<') return a < b ? 1 : 0;
      if (ast.op === '>=') return a >= b ? 1 : 0;
      if (ast.op === '<=') return a <= b ? 1 : 0;
      if (ast.op === '==' || ast.op === '===') return a === b ? 1 : 0;
      if (ast.op === '!=' || ast.op === '!==') return a !== b ? 1 : 0;
      throw httpError(`Unknown comparison ${ast.op}`);
    }
    case 'if': {
      const cond = evalAst(ast.cond, vars);
      return cond ? evalAst(ast.thenBranch, vars) : evalAst(ast.elseBranch, vars);
    }
    default:
      throw httpError('Invalid AST node');
  }
}

function compileFormula(expr) {
  const tokens = tokenize(expr);
  return parseExpression(tokens);
}

function evaluateFormula(expr, vars) {
  const ast = compileFormula(expr);
  const value = evalAst(ast, vars);
  return Number.isFinite(value) ? value : 0;
}

function normalizeFormulas(formulas) {
  const merged = { ...DEFAULT_FORMULAS, ...(formulas || {}) };

  const storedRate = String(merged.overtime_hourly_rate || '').trim();
  if (
    !storedRate ||
    storedRate === '0' ||
    storedRate.includes('8.5') ||
    storedRate.includes('/ 30')
  ) {
    merged.overtime_hourly_rate = DEFAULT_FORMULAS.overtime_hourly_rate;
  }

  const storedOt = String(merged.overtime_pay || '').trim();
  if (!storedOt || storedOt === '0' || !/\bovertime_hourly_rate\b/.test(storedOt)) {
    merged.overtime_pay = DEFAULT_FORMULAS.overtime_pay;
  }

  const storedAbsent = String(merged.absent_deduction || '').trim();
  if (
    !storedAbsent ||
    storedAbsent === '0' ||
    storedAbsent.includes('wage_period') ||
    !storedAbsent.includes('unauthorized_absent_days')
  ) {
    merged.absent_deduction = DEFAULT_FORMULAS.absent_deduction;
  }

  const storedBasic = String(merged.basic_earned || '').trim();
  if (
    !storedBasic ||
    storedBasic.includes('absent_deduction') ||
    !storedBasic.includes('days_worked') ||
    !/\besi_basic\b/.test(storedBasic) ||
    !/\bpaid_leave\b/.test(storedBasic) ||
    /\bovertime_pay\b/.test(storedBasic)
  ) {
    merged.basic_earned = DEFAULT_FORMULAS.basic_earned;
  }

  if (!String(merged.regular_earnings || '').trim()) {
    merged.regular_earnings = DEFAULT_FORMULAS.regular_earnings;
  }

  const storedPa = String(merged.production_allowance || '').trim();
  if (
    !storedPa ||
    storedPa === '0' ||
    storedPa.includes('absent_deduction') ||
    storedPa.includes('overtime_pay') ||
    !storedPa.includes('basic_earned') ||
    !storedPa.includes('allowance')
  ) {
    merged.production_allowance = DEFAULT_FORMULAS.production_allowance;
  }

  const totalExpr = String(merged.total_earned || '').trim();
  if (
    !totalExpr ||
    /\bregular_earnings\b/.test(totalExpr) ||
    !/\bbasic\b/.test(totalExpr) ||
    !/\bovertime_pay\b/.test(totalExpr) ||
    !/\babsent_deduction\b/.test(totalExpr)
  ) {
    merged.total_earned = DEFAULT_FORMULAS.total_earned;
  }

  const storedPf = String(merged.pf || '').trim();
  if (
    !storedPf ||
    !/\b15000\b/.test(storedPf) ||
    !/\bbasic_earned\b/.test(storedPf)
  ) {
    merged.pf = DEFAULT_FORMULAS.pf;
  }

  const dedExpr = String(merged.total_deductions || '');
  if (
    !dedExpr ||
    /\babsent_deduction\b/.test(dedExpr) ||
    !/\besi\b/.test(dedExpr) ||
    !/\bpf\b/.test(dedExpr) ||
    !/\bpt\b/.test(dedExpr)
  ) {
    merged.total_deductions = DEFAULT_FORMULAS.total_deductions;
  }
  const netExpr = String(merged.net_paid || '');
  if (
    !netExpr ||
    /\babsent_deduction\b/.test(netExpr) ||
    !/\btotal_earned\b/.test(netExpr) ||
    !/\besi\b/.test(netExpr) ||
    !/\bpf\b/.test(netExpr) ||
    !/\bpt\b/.test(netExpr)
  ) {
    merged.net_paid = DEFAULT_FORMULAS.net_paid;
  }

  for (const key of OUTPUT_KEYS) {
    if (!merged[key] || typeof merged[key] !== 'string') {
      merged[key] = DEFAULT_FORMULAS[key];
    }
    compileFormula(merged[key]);
  }
  return merged;
}

function computeLine(inputs, formulas, options = {}) {
  const normalized = normalizeFormulas(formulas);
  const overrideSet = new Set(
    Array.isArray(options.overrides) ? options.overrides : []
  );
  const overrideValues = options.values || inputs || {};
  const vars = {};
  for (const key of INPUT_KEYS) {
    vars[key] = toNumber(inputs[key], 0);
  }
  // esi_basic stays blank/0 until entered manually — do not fall back to company basic
  if (vars.wage_period <= 0) {
    vars.wage_period = 0;
  }

  const outputs = {};
  for (const key of COMPUTE_ORDER) {
    let value = 0;
    try {
      if (overrideSet.has(key)) {
        value = toNumber(overrideValues[key], 0);
      } else if (key === 'basic_earned' && vars.wage_period <= 0) {
        value = 0;
      } else {
        value = evaluateFormula(normalized[key], vars);
      }
    } catch (err) {
      throw httpError(`Formula error on ${key}: ${err.message}`);
    }
    vars[key] = value;
    outputs[key] = value;
  }

  return {
    inputs: Object.fromEntries(INPUT_KEYS.map((k) => [k, vars[k]])),
    outputs,
    formulas: normalized,
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

module.exports = {
  INPUT_KEYS,
  OUTPUT_KEYS,
  DEFAULT_FORMULAS,
  computeLine,
  normalizeFormulas,
  evaluateFormula,
  daysInMonth,
  toNumber,
  overtimeHourlyRateFromBasic,
};
