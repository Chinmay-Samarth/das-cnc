/**
 * Excel payroll methodology regression tests (node:test).
 * Run: node --test server/services/salaryFormulaEngine.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLine,
  DEFAULT_FORMULAS,
  normalizeFormulas,
  overtimeHourlyRateFromBasic,
} = require('./salaryFormulaEngine');

function approxEqual(actual, expected, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`
  );
}

describe('Excel payroll formulas', () => {
  it('TEST 1 Swathi M — paid leave in Basic Earned, OT=basic/170, no basic−absent', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 9,
        paid_leave: 1,
        earned_leave: 0,
        absent_days: 3,
        unauthorized_absent_days: 0,
        overtime_hours: 11.6,
        basic: 16000,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS
    );

    assert.notEqual(outputs.basic_earned, 14400);
    approxEqual(outputs.basic_earned, 16000 / 30 * 10);
    approxEqual(outputs.absent_deduction, 16000 / 30 * 3);
    approxEqual(outputs.overtime_hourly_rate, 16000 / 170);
    approxEqual(outputs.overtime_pay, 11.6 * (16000 / 170));
    approxEqual(outputs.allowance, outputs.basic_earned * 0.15);
    // Allow override-style fixed allowance check from Excel scenario (800 ≈ 15%)
    approxEqual(outputs.regular_earnings, outputs.basic_earned + outputs.allowance);
    approxEqual(outputs.total_earned, outputs.regular_earnings + outputs.overtime_pay);
    // Absence must not be deducted again from net
    assert.ok(!String(DEFAULT_FORMULAS.total_deductions).includes('absent_deduction'));
    assert.ok(!String(DEFAULT_FORMULAS.net_paid).includes('absent_deduction'));
    approxEqual(outputs.total_deductions, outputs.esi + outputs.pf + outputs.pt);
    approxEqual(outputs.net_paid, outputs.total_earned - outputs.esi - outputs.pf - outputs.pt);
    assert.equal(DEFAULT_FORMULAS.net_paid, 'total_earned - esi - pf - pt');
  });

  it('TEST 1 with allowance fixed at 800 (Excel row)', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 9,
        paid_leave: 1,
        earned_leave: 0,
        absent_days: 3,
        unauthorized_absent_days: 0,
        overtime_hours: 11.6,
        basic: 16000,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS,
      { overrides: ['allowance'], values: { allowance: 800 } }
    );

    approxEqual(outputs.basic_earned, 5333.333333333333);
    approxEqual(outputs.absent_deduction, 1600);
    approxEqual(outputs.overtime_hourly_rate, 94.11764705882354);
    approxEqual(outputs.overtime_pay, 1091.764705882353);
    approxEqual(outputs.regular_earnings, 5333.333333333333 + 800);
    approxEqual(outputs.total_earned, 5333.333333333333 + 800 + 1091.764705882353);
  });

  it('TEST 2 Shashank M — Basic Earned 5100, absent cut 2266.67, gross incl OT', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 9,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 4,
        unauthorized_absent_days: 0,
        overtime_hours: 18.8,
        basic: 17000,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS,
      { overrides: ['allowance'], values: { allowance: 765 } }
    );

    approxEqual(outputs.basic_earned, 5100);
    approxEqual(outputs.absent_deduction, 17000 / 30 * 4);
    approxEqual(outputs.overtime_hourly_rate, 100);
    approxEqual(outputs.overtime_pay, 1880);
    approxEqual(outputs.regular_earnings, 5865);
    approxEqual(outputs.total_earned, 7745);
    // Net does not subtract absent_deduction again
    approxEqual(outputs.net_paid, outputs.total_earned - outputs.esi - outputs.pf - outputs.pt);
  });

  it('TEST 3 — wage period 31 Basic Earned; absent cut still /30', () => {
    const { outputs } = computeLine(
      {
        wage_period: 31,
        days_worked: 18,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 13,
        unauthorized_absent_days: 0,
        overtime_hours: 0,
        basic: 14500,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS
    );

    approxEqual(outputs.basic_earned, 14500 / 31 * 18);
    approxEqual(outputs.absent_deduction, 14500 / 30 * 13);
  });

  it('TEST 4 — unauthorized absence at 1.5×', () => {
    const { outputs } = computeLine(
      {
        wage_period: 31,
        days_worked: 6,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 6,
        unauthorized_absent_days: 5,
        overtime_hours: 0,
        basic: 14500,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS
    );

    approxEqual(outputs.absent_deduction, 14500 / 30 * 13.5);
    approxEqual(outputs.basic_earned, 14500 / 31 * 6);
  });

  it('PF excludes OT; ESI includes OT in gross', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 9,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 0,
        unauthorized_absent_days: 0,
        overtime_hours: 18.8,
        basic: 17000,
        incentive_paid: 0,
        production_allowance: 0,
      },
      DEFAULT_FORMULAS,
      { overrides: ['allowance'], values: { allowance: 765 } }
    );

    const pfWages = outputs.basic_earned + outputs.allowance;
    approxEqual(outputs.pf, Math.min(pfWages, 15000) * 0.12);
    approxEqual(outputs.esi, outputs.total_earned * 0.0075);
    assert.ok(outputs.total_earned > outputs.regular_earnings);
  });

  it('normalizeFormulas upgrades basic − absent_deduction and old OT rate', () => {
    const merged = normalizeFormulas({
      basic_earned: 'IF(basic > 0, basic - absent_deduction, 0)',
      overtime_hourly_rate: '((basic / 30) / 8.5) * 1.5',
      absent_deduction: 'IF(wage_period > 0, basic / wage_period * absent_days, 0)',
      total_earned: 'basic_earned + allowance + production_allowance + incentive_paid',
      total_deductions: 'esi + pf + pt + absent_deduction',
      net_paid: 'total_earned - total_deductions',
    });

    assert.equal(merged.basic_earned, DEFAULT_FORMULAS.basic_earned);
    assert.equal(merged.overtime_hourly_rate, DEFAULT_FORMULAS.overtime_hourly_rate);
    assert.equal(merged.absent_deduction, DEFAULT_FORMULAS.absent_deduction);
    assert.equal(merged.total_earned, DEFAULT_FORMULAS.total_earned);
    assert.equal(merged.total_deductions, DEFAULT_FORMULAS.total_deductions);
    assert.equal(merged.net_paid, DEFAULT_FORMULAS.net_paid);
    assert.equal(merged.regular_earnings, DEFAULT_FORMULAS.regular_earnings);
  });

  it('overtimeHourlyRateFromBasic uses /170', () => {
    approxEqual(overtimeHourlyRateFromBasic(16000), 16000 / 170);
    approxEqual(overtimeHourlyRateFromBasic(17000), 100);
  });
});
