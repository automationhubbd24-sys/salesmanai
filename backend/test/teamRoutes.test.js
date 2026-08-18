const test = require('node:test');
const assert = require('node:assert/strict');
const teamRoutes = require('../src/routes/teamRoutes');

test('normalizes authenticated and member email addresses', () => {
    assert.equal(teamRoutes.normalizeEmail(' User@Example.COM '), 'user@example.com');
    assert.equal(teamRoutes.normalizeEmail('not-an-email'), null);
});

test('accepts only the declared permission schema and preserves legacy permissions', () => {
    const result = teamRoutes.validatePermissions({
        fb_pages: [' Page A ', 'Page A'],
        wa_sessions: ['main'],
        smart_inbox: { view: true, reply: true },
        orders: { view_assigned: true }
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.value.fb_pages, ['Page A']);
    assert.equal(result.value.smart_inbox.analytics, false);
    assert.equal(result.value.orders.view_assigned, true);
    assert.equal(result.value.orders.assign, false);
    assert.equal(teamRoutes.validatePermissions({ admin: true }).valid, false);
    assert.equal(teamRoutes.validatePermissions({ smart_inbox: { delete: true } }).valid, false);
    assert.equal(teamRoutes.validatePermissions({ fb_pages: [7] }).valid, false);
});

test('merges duplicate-member module and legacy permissions without dropping keys', () => {
    const merged = teamRoutes.mergePermissions([
        { fb_pages: ['a'], smart_inbox: { view: true } },
        { fb_pages: ['b', 'a'], wa_sessions: ['session'], smart_inbox: { reply: true }, team: { analytics: true } }
    ]);
    assert.deepEqual(merged.fb_pages, ['a', 'b']);
    assert.deepEqual(merged.wa_sessions, ['session']);
    assert.equal(merged.smart_inbox.view, true);
    assert.equal(merged.smart_inbox.reply, true);
    assert.equal(merged.team.analytics, true);
    assert.equal(merged.orders.assign, false);
});

test('owner-only context rejects a different owner supplied in a header or query', () => {
    assert.deepEqual(teamRoutes.ownerContext({ user: { email: 'Owner@Example.com' }, query: {}, headers: {} }), { ownerEmail: 'owner@example.com' });
    assert.equal(teamRoutes.ownerContext({ user: { email: 'owner@example.com' }, query: { team_owner: 'other@example.com' }, headers: {} }).status, 403);
    assert.equal(teamRoutes.ownerContext({ user: { email: 'owner@example.com' }, query: {}, headers: { 'x-team-owner': 'other@example.com' } }).status, 403);
});

test('distributes total team capacity equally among five active members', () => {
    assert.deepEqual(teamRoutes.distributeOrderQuotas(50, ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com']), [
        { member_email: 'a@example.com', quota: 10 },
        { member_email: 'b@example.com', quota: 10 },
        { member_email: 'c@example.com', quota: 10 },
        { member_email: 'd@example.com', quota: 10 },
        { member_email: 'e@example.com', quota: 10 }
    ]);
});

test('assigns equal-share remainders deterministically to the first active members', () => {
    assert.deepEqual(teamRoutes.distributeOrderQuotas(10, ['a@example.com', 'b@example.com', 'c@example.com']), [
        { member_email: 'a@example.com', quota: 4 },
        { member_email: 'b@example.com', quota: 3 },
        { member_email: 'c@example.com', quota: 3 }
    ]);
});
