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
  it('ESI basic blank → Basic Earned 0; PA = company basic + 0', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 10,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 0,
        unauthorized_absent_days: 0,
        overtime_hours: 5,
        basic: 17000,
        esi_basic: 0,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );
    approxEqual(outputs.basic_earned, 0);
    approxEqual(outputs.allowance, 0);
    approxEqual(outputs.production_allowance, 17000);
    approxEqual(outputs.overtime_pay, 5 * (17000 / 170));
    approxEqual(outputs.total_earned, 17000 + 5 * (17000 / 170));
  });

  it('Swathi: BE = esi/wage × (days_worked + paid_leave), no OT', () => {
    const { outputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 23,
        paid_leave: 1,
        earned_leave: 0,
        absent_days: 3,
        unauthorized_absent_days: 0,
        overtime_hours: 11.6,
        basic: 16000,
        esi_basic: 16500,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );

    const otPay = 11.6 * (16000 / 170);
    const absent = (16000 / 30) * 3;
    const be = (16500 / 30) * (23 + 1);
    const allowance = be * 0.15;
    const pa = 16000 - be + allowance;
    const totalEarned = 16000 + otPay - absent;

    approxEqual(outputs.overtime_pay, otPay);
    approxEqual(outputs.absent_deduction, absent);
    approxEqual(outputs.basic_earned, be);
    approxEqual(outputs.basic_earned, 13200);
    approxEqual(outputs.production_allowance, pa);
    approxEqual(outputs.total_earned, totalEarned);
    approxEqual(outputs.net_paid, totalEarned - outputs.esi - outputs.pf - outputs.pt);
  });

  it('Basic Earned excludes OT; Total Earned includes OT', () => {
    const { outputs } = computeLine(
      {
        wage_period: 31,
        days_worked: 28,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 3,
        unauthorized_absent_days: 0,
        overtime_hours: 10,
        basic: 14000,
        esi_basic: 14500,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );

    const otPay = 10 * (14000 / 170);
    const be = (14500 / 31) * 28;
    const allowance = be * 0.15;
    const pa = 14000 - be + allowance;

    approxEqual(outputs.overtime_pay, otPay);
    approxEqual(outputs.basic_earned, be);
    approxEqual(outputs.allowance, allowance);
    approxEqual(outputs.production_allowance, pa);
    approxEqual(outputs.total_earned, 14000 + otPay - (14000 / 30) * 3);
  });

  it('does not fall back esi_basic to company basic', () => {
    const { inputs } = computeLine(
      {
        wage_period: 30,
        days_worked: 10,
        paid_leave: 0,
        earned_leave: 0,
        absent_days: 0,
        unauthorized_absent_days: 0,
        overtime_hours: 0,
        basic: 15000,
        esi_basic: 0,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );
    approxEqual(inputs.esi_basic, 0);
  });

  it('absent cut uses company basic /30', () => {
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
        esi_basic: 14500,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );
    approxEqual(outputs.absent_deduction, (14500 / 30) * 13);
  });

  it('unauthorized absence at 1.5×', () => {
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
        esi_basic: 14500,
        incentive_paid: 0,
      },
      DEFAULT_FORMULAS
    );
    approxEqual(outputs.absent_deduction, (14500 / 30) * 13.5);
  });

  it('normalizeFormulas keeps paid leave, strips OT from Basic Earned', () => {
    const merged = normalizeFormulas({
      basic_earned: 'IF(wage_period > 0, esi_basic / wage_period * days_worked + overtime_pay, 0)',
      production_allowance: 'basic - basic_earned + allowance',
      total_earned: 'regular_earnings',
    });
    assert.equal(merged.basic_earned, DEFAULT_FORMULAS.basic_earned);
    assert.ok(merged.basic_earned.includes('paid_leave'));
    assert.ok(!merged.basic_earned.includes('overtime_pay'));
    assert.equal(merged.total_earned, DEFAULT_FORMULAS.total_earned);
  });

  it('overtimeHourlyRateFromBasic uses /170', () => {
    approxEqual(overtimeHourlyRateFromBasic(16000), 16000 / 170);
    approxEqual(overtimeHourlyRateFromBasic(17000), 100);
  });
});
