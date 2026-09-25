const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  computeLeaveAndAbsent,
  countDaysWorked,
} = require('./payrollEngine');

describe('computeLeaveAndAbsent — paid leave from leave_requests', () => {
  const monthStart = '2026-09-01';
  const monthEnd = '2026-09-30';

  it('puts approved paid leave into paid_leave without counting as days worked', () => {
    const records = [
      { shift_date: '2026-09-01', status: 'PRESENT' },
      { shift_date: '2026-09-02', status: 'PRESENT' },
      { shift_date: '2026-09-03', status: 'LEAVE' },
    ];
    const leaveRows = [
      {
        status: 'approved',
        pay_type: 'paid',
        start_date: '2026-09-03',
        end_date: '2026-09-03',
      },
    ];

    const worked = countDaysWorked(records);
    assert.equal(worked, 2);

    const stats = computeLeaveAndAbsent(records, leaveRows, monthStart, monthEnd, {
      daysWorked: worked,
      wagePeriod: 30,
    });
    assert.equal(stats.paid_leave, 1);
    assert.equal(worked + stats.paid_leave, 3);
  });

  it('does not stack paid leave on a day already attended', () => {
    const records = [{ shift_date: '2026-09-05', status: 'LATE' }];
    const leaveRows = [
      {
        status: 'approved',
        pay_type: 'paid',
        start_date: '2026-09-05',
        end_date: '2026-09-05',
      },
    ];

    const worked = countDaysWorked(records);
    const stats = computeLeaveAndAbsent(records, leaveRows, monthStart, monthEnd, {
      daysWorked: worked,
      wagePeriod: 30,
    });
    assert.equal(worked, 1);
    assert.equal(stats.paid_leave, 0);
  });

  it('treats null pay_type as paid (same as leave approve)', () => {
    const leaveRows = [
      {
        status: 'approved',
        pay_type: null,
        start_date: '2026-09-10',
        end_date: '2026-09-11',
      },
    ];
    const stats = computeLeaveAndAbsent([], leaveRows, monthStart, monthEnd, {
      daysWorked: 0,
      wagePeriod: 30,
    });
    assert.equal(stats.paid_leave, 2);
  });

  it('ignores unpaid and non-approved leave for paid_leave column', () => {
    const leaveRows = [
      {
        status: 'approved',
        pay_type: 'unpaid',
        start_date: '2026-09-12',
        end_date: '2026-09-12',
      },
      {
        status: 'pending',
        pay_type: 'paid',
        start_date: '2026-09-13',
        end_date: '2026-09-13',
      },
    ];
    const stats = computeLeaveAndAbsent([], leaveRows, monthStart, monthEnd, {
      daysWorked: 20,
      wagePeriod: 30,
    });
    assert.equal(stats.paid_leave, 0);
  });
});
