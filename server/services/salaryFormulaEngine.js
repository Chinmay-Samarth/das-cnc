/**
 * Safe salary formula evaluator + Excel-baseline compute helpers.
 * Supports arithmetic, comparisons, parentheses, and IF(cond, a, b).
 */

const INPUT_KEYS = [
  'wage_period',
  'days_worked',
  'paid_leave',
  'earned_leave',
  'overtime_hours',
  'basic',
  'incentive_paid',
  'production_allowance',
];

const OUTPUT_KEYS = [
  'basic_earned',
  'allowance',
  'inc_plus_prod_all',
  'allowance_plus_pa',
  'overtime_pay',
  'total_earned',
  'esi',
  'pf',
  'pt',
  'total_deductions',
  'net_paid',
];

const COMPUTE_ORDER = [...OUTPUT_KEYS];

const DEFAULT_FORMULAS = {
  basic_earned:
    'IF(basic > 0, basic / wage_period * (days_worked + paid_leave + earned_leave), 0)',
  allowance: 'basic_earned * 0.15',
  inc_plus_prod_all: 'incentive_paid + production_allowance',
  allowance_plus_pa: 'allowance + production_allowance',
  overtime_pay: '0',
  total_earned:
    'basic_earned + allowance + production_allowance + incentive_paid + overtime_pay',
  esi: 'total_earned * 0.75 / 100',
  pf: 'IF((basic_earned + allowance) <= 15000, (basic_earned + allowance) * 0.12, 15000 * 0.12)',
  pt: 'IF(total_earned > 25000, 200, 0)',
  total_deductions: 'esi + pf + pt',
  net_paid: 'total_earned - total_deductions',
};

const ALLOWED_IDENTIFIERS = new Set([...INPUT_KEYS, ...OUTPUT_KEYS]);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
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
      const upper = id.toUpperCase();
      if (upper === 'IF') tokens.push({ type: 'if' });
      else tokens.push({ type: 'id', value: id.toLowerCase() });
      continue;
    }
    throw httpError(`Invalid character in formula: ${ch}`);
  }
  return tokens;
}

function parseExpression(tokens) {
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(expected) {
    const t = tokens[pos];
    if (!t) throw httpError('Unexpected end of formula');
    if (expected) {
      const ok =
        typeof expected === 'string'
          ? t.type === expected
          : expected.includes(t.type);
      if (!ok) throw httpError(`Expected ${expected} in formula`);
    }
    pos += 1;
    return t;
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw httpError('Unexpected end of formula');

    if (t.type === 'number') {
      consume();
      return { kind: 'number', value: t.value };
    }
    if (t.type === 'id') {
      consume();
      if (!ALLOWED_IDENTIFIERS.has(t.value)) {
        throw httpError(`Unknown variable in formula: ${t.value}`);
      }
      return { kind: 'id', name: t.value };
    }
    if (t.type === 'if') {
      consume();
      consume('(');
      const cond = parseComparison();
      consume(',');
      const thenBranch = parseComparison();
      consume(',');
      const elseBranch = parseComparison();
      consume(')');
      return { kind: 'if', cond, thenBranch, elseBranch };
    }
    if (t.type === '(') {
      consume();
      const inner = parseComparison();
      consume(')');
      return inner;
    }
    if (t.type === '-' || t.type === '+') {
      const op = consume().type;
      const arg = parsePrimary();
      return op === '-' ? { kind: 'unary', op: '-', arg } : arg;
    }
    throw httpError('Invalid formula expression');
  }

  function parseMulDiv() {
    let left = parsePrimary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = consume().type;
      const right = parsePrimary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume().type;
      const right = parseMulDiv();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseComparison() {
    let left = parseAddSub();
    while (peek() && peek().type === 'op') {
      const op = consume().value;
      const right = parseAddSub();
      left = { kind: 'cmp', op, left, right };
    }
    return left;
  }

  const ast = parseComparison();
  if (pos < tokens.length) throw httpError('Unexpected tokens in formula');
  return ast;
}

function evalAst(ast, vars) {
  switch (ast.kind) {
    case 'number':
      return ast.value;
    case 'id':
      return toNumber(vars[ast.name], 0);
    case 'unary':
      return -evalAst(ast.arg, vars);
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
  for (const key of OUTPUT_KEYS) {
    if (!merged[key] || typeof merged[key] !== 'string') {
      merged[key] = DEFAULT_FORMULAS[key];
    }
    // Validate compile-time
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
  // Guard: wage_period zero → basic_earned becomes 0 via division guard in evaluator
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
};
