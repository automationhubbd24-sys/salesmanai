const test = require('node:test');
const assert = require('node:assert/strict');
const teamRoutes = require('../src/routes/teamRoutes');
const teamAuthorization = require('../src/services/teamAuthorizationService');

const activeMembership = {
    owner_email: 'owner@example.com',
    member_email: 'member@example.com',
    status: 'active',
    permissions: {
        fb_pages: ['page-1'],
        wa_sessions: ['session-1'],
        smart_inbox: { view: true, reply: true },
        orders: { view_assigned: true }
    }
};

test('normalizes authenticated and member email addresses', () => {
    assert.equal(teamAuthorization.normalizeEmail(' User@Example.COM '), 'user@example.com');
    assert.equal(teamAuthorization.normalizeEmail('not-an-email'), null);
    assert.equal(teamRoutes.normalizeEmail, teamAuthorization.normalizeEmail);
});

test('accepts only the declared granular permission schema and preserves legacy resources', () => {
    const result = teamAuthorization.validatePermissions({
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
    assert.equal(teamAuthorization.validatePermissions({ admin: true }).valid, false);
    assert.equal(teamAuthorization.validatePermissions({ smart_inbox: { delete: true } }).valid, false);
    assert.equal(teamAuthorization.validatePermissions({ fb_pages: [7] }).valid, false);
});

test('merges duplicate-member module and legacy permissions without dropping keys', () => {
    const merged = teamAuthorization.mergePermissions([
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

test('owner has full action and resource access', () => {
    assert.equal(teamAuthorization.hasFullTeamAccess({ actorEmail: 'OWNER@example.com', ownerEmail: 'owner@example.com' }), true);
    assert.equal(teamAuthorization.canAuthorizeTeamAction({
        actorEmail: 'owner@example.com', ownerEmail: 'owner@example.com', module: 'team', action: 'manage'
    }), true);
    assert.equal(teamAuthorization.canAuthorizeTeamResource({
        actorEmail: 'owner@example.com', ownerEmail: 'owner@example.com', resourceType: 'fb_pages', resourceId: 'any-page'
    }), true);
});

test('only active matching members receive their granted action and legacy resource access', () => {
    assert.equal(teamAuthorization.canAuthorizeTeamAction({
        actorEmail: 'member@example.com', ownerEmail: 'owner@example.com', membership: activeMembership,
        module: 'smart_inbox', action: 'reply'
    }), true);
    assert.equal(teamAuthorization.canAuthorizeTeamAction({
        actorEmail: 'member@example.com', ownerEmail: 'owner@example.com', membership: activeMembership,
        module: 'orders', action: 'assign'
    }), false);
    assert.equal(teamAuthorization.canAuthorizeTeamResource({
        actorEmail: 'member@example.com', ownerEmail: 'owner@example.com', membership: activeMembership,
        resourceType: 'fb_pages', resourceId: 'page-1', module: 'smart_inbox', action: 'view'
    }), true);
    assert.equal(teamAuthorization.canAuthorizeTeamResource({
        actorEmail: 'member@example.com', ownerEmail: 'owner@example.com', membership: activeMembership,
        resourceType: 'wa_sessions', resourceId: 'session-2'
    }), false);
    assert.equal(teamAuthorization.canAuthorizeTeamAction({
        actorEmail: 'member@example.com', ownerEmail: 'owner@example.com', membership: { ...activeMembership, status: 'inactive' },
        module: 'smart_inbox', action: 'view'
    }), false);
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
