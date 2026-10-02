const test = require('node:test');
const assert = require('node:assert/strict');
const {
    distributeQuotas,
    selectEligibleMember
} = require('../src/services/teamOrderAllocationService');

test('equal-share quotas split owner-wide capacity deterministically', () => {
    assert.deepEqual(distributeQuotas(10, ['c@example.com', 'a@example.com', 'b@example.com']), [
        { member_email: 'a@example.com', quota: 4 },
        { member_email: 'b@example.com', quota: 3 },
        { member_email: 'c@example.com', quota: 3 }
    ]);
});

test('selects the eligible member with the lowest active workload, then email', () => {
    const selected = selectEligibleMember({
        batchSize: 6,
        memberEmails: ['b@example.com', 'a@example.com', 'c@example.com'],
        workloads: { 'a@example.com': 1, 'b@example.com': 0, 'c@example.com': 0 }
    });
    assert.deepEqual(selected, { member_email: 'b@example.com', quota: 2, workload: 0 });
});

test('returns no member when every equal-share active quota is full', () => {
    assert.equal(selectEligibleMember({
        batchSize: 3,
        memberEmails: ['a@example.com', 'b@example.com'],
        workloads: { 'a@example.com': 2, 'b@example.com': 1 }
    }), null);
});
