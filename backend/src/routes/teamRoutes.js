const express = require('express');
const router = express.Router();
const pgClient = require('../services/pgClient');
const authMiddleware = require('../middleware/authMiddleware');
const runtimeMonitor = require('../services/runtimeMonitor');
const {
    normalizeEmail,
    validatePermissions,
    mergePermissions
} = require('../services/teamAuthorizationService');

function requestedOwner(req) {
    return req.query?.team_owner || req.headers['x-team-owner'];
}

function ownerContext(req) {
    const ownerEmail = normalizeEmail(req.user?.email);
    if (!ownerEmail) return { error: 'Authenticated user has no valid email', status: 401 };
    const suppliedOwner = requestedOwner(req);
    if (suppliedOwner && normalizeEmail(suppliedOwner) !== ownerEmail) {
        return { error: 'A different team owner cannot be supplied for owner-only operations', status: 403 };
    }
    return { ownerEmail };
}

function requireOwner(req, res) {
    const context = ownerContext(req);
    if (context.error) {
        res.status(context.status).json({ error: context.error });
        return null;
    }
    return context.ownerEmail;
}

function noStore(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
}

/** Distribute a team's total order capacity deterministically among active members. */
function distributeOrderQuotas(batchSize, memberEmails) {
    const capacity = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 0;
    const members = Array.isArray(memberEmails) ? memberEmails : [];
    const baseQuota = members.length ? Math.floor(capacity / members.length) : 0;
    const remainder = members.length ? capacity % members.length : 0;
    return members.map((memberEmail, index) => ({
        member_email: memberEmail,
        quota: baseQuota + (index < remainder ? 1 : 0)
    }));
}

function dbError(res, error, message, meta = {}) {
    runtimeMonitor.recordError('team_routes', error, { stage: meta.stage || message, platform: 'team_management' });
    console.error(message, error);
    return res.status(500).json({ error: message });
}

async function ensureTeamOrderTables() {
    await pgClient.query(`CREATE TABLE IF NOT EXISTS public.team_order_settings (
        owner_email TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'equal_share')),
        batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size > 0),
        overflow BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pgClient.query(`CREATE TABLE IF NOT EXISTS public.team_order_assignments (
        owner_email TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('fb', 'whatsapp')),
        resource_id TEXT NOT NULL,
        order_identity TEXT NOT NULL,
        member_email TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_email, source, resource_id, order_identity)
    )`);
    await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_team_order_assignments_owner_member
        ON public.team_order_assignments (owner_email, member_email, assigned_at DESC)`);
}

/** Ensure every canonical resource grant belongs to the team owner. */
function validatePermissionResourceGrants(permissions, ownedResources) {
    for (const resourceType of ['fb_pages', 'wa_sessions']) {
        const owned = new Set((ownedResources?.[resourceType] || []).map(resource => String(resource).trim()));
        for (const resourceId of permissions[resourceType]) {
            if (!owned.has(resourceId)) {
                return { valid: false, error: `Invalid or unauthorized ${resourceType} resource: ${resourceId}` };
            }
        }
    }
    return { valid: true, value: permissions };
}

/** Fetch and validate the owner's submitted canonical resource grants. */
async function validateOwnerPermissionResourceGrants({ pgClient: client, ownerEmail, permissions }) {
    const resourceQueries = {
        fb_pages: `SELECT CAST(page_id AS TEXT) AS resource_id
                   FROM page_access_token_message
                   WHERE LOWER(email) = $1 AND CAST(page_id AS TEXT) = ANY($2::text[])`,
        wa_sessions: `SELECT session_name AS resource_id
                      FROM whatsapp_message_database
                      WHERE LOWER(email) = $1 AND session_name = ANY($2::text[])`
    };
    const ownedResources = { fb_pages: [], wa_sessions: [] };
    await Promise.all(Object.keys(ownedResources).map(async resourceType => {
        const resourceIds = permissions[resourceType];
        if (!resourceIds.length) return;
        const result = await client.query(resourceQueries[resourceType], [ownerEmail, resourceIds]);
        ownedResources[resourceType] = result.rows.map(row => row.resource_id);
    }));
    return validatePermissionResourceGrants(permissions, ownedResources);
}

router.get('/members', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    try {
        noStore(res);
        const result = await pgClient.query(
            'SELECT id, member_email, status, permissions, created_at FROM team_members WHERE LOWER(owner_email) = $1 ORDER BY created_at DESC',
            [ownerEmail]
        );
        const members = new Map();
        for (const row of result.rows) {
            const email = normalizeEmail(row.member_email);
            if (!email) continue;
            const existing = members.get(email);
            if (existing) existing.permissions = mergePermissions([existing.permissions, row.permissions]);
            else members.set(email, { ...row, member_email: email, permissions: mergePermissions([row.permissions]) });
        }
        return res.json([...members.values()]);
    } catch (error) { return dbError(res, error, 'Failed to fetch team members', { stage: 'members-get' }); }
});

router.get('/members/:id', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    try {
        const result = await pgClient.query(
            'SELECT id, member_email, status, permissions, created_at FROM team_members WHERE id = $1 AND LOWER(owner_email) = $2',
            [req.params.id, ownerEmail]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'Member not found' });
        const row = result.rows[0];
        return res.json({ ...row, member_email: normalizeEmail(row.member_email), permissions: mergePermissions([row.permissions]) });
    } catch (error) { return dbError(res, error, 'Failed to fetch member permissions'); }
});

router.get('/me', authMiddleware, async (req, res) => {
    const userEmail = normalizeEmail(req.user?.email);
    if (!userEmail) return res.status(401).json({ error: 'Authenticated user has no valid email' });
    try {
        noStore(res);
        const result = await pgClient.query(
            'SELECT DISTINCT ON (LOWER(owner_email)) id, owner_email, status, permissions, created_at FROM team_members WHERE LOWER(member_email) = $1 AND status = $2 AND LOWER(owner_email) != $1 ORDER BY LOWER(owner_email), created_at DESC',
            [userEmail, 'active']
        );
        return res.json(result.rows);
    } catch (error) { return dbError(res, error, 'Failed to fetch teams', { stage: 'me-get' }); }
});

router.post('/members', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    const memberEmail = normalizeEmail(req.body?.member_email);
    const validated = validatePermissions(req.body?.permissions || {});
    if (!memberEmail) return res.status(400).json({ error: 'member_email must be a valid email address' });
    if (memberEmail === ownerEmail) return res.status(400).json({ error: 'Cannot add the owner as a member' });
    if (!validated.valid) return res.status(400).json({ error: validated.error });
    try {
        const resourceValidation = await validateOwnerPermissionResourceGrants({ pgClient, ownerEmail, permissions: validated.value });
        if (!resourceValidation.valid) return res.status(400).json({ error: resourceValidation.error });
        // Update every legacy duplicate so future reads cannot retain stale permissions.
        const existing = await pgClient.query('SELECT id FROM team_members WHERE LOWER(owner_email) = $1 AND LOWER(member_email) = $2 LIMIT 1', [ownerEmail, memberEmail]);
        const result = existing.rowCount
            ? await pgClient.query(`UPDATE team_members SET permissions = $1, status = 'active' WHERE LOWER(owner_email) = $2 AND LOWER(member_email) = $3 RETURNING id, member_email, status, permissions, created_at`, [validated.value, ownerEmail, memberEmail])
            : await pgClient.query(`INSERT INTO team_members (owner_email, member_email, status, permissions) VALUES ($1, $2, 'active', $3) RETURNING id, member_email, status, permissions, created_at`, [ownerEmail, memberEmail, validated.value]);
        return res.status(existing.rowCount ? 200 : 201).json({ ...result.rows[0], permissions: validated.value });
    } catch (error) { return dbError(res, error, 'Failed to save team member'); }
});

router.put('/members/:id', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    const validated = validatePermissions(req.body?.permissions || {});
    if (!validated.valid) return res.status(400).json({ error: validated.error });
    try {
        const resourceValidation = await validateOwnerPermissionResourceGrants({ pgClient, ownerEmail, permissions: validated.value });
        if (!resourceValidation.valid) return res.status(400).json({ error: resourceValidation.error });
        const member = await pgClient.query('SELECT member_email FROM team_members WHERE id = $1 AND LOWER(owner_email) = $2', [req.params.id, ownerEmail]);
        if (!member.rowCount) return res.status(404).json({ error: 'Member not found' });
        const result = await pgClient.query(`UPDATE team_members SET permissions = $1 WHERE LOWER(owner_email) = $2 AND LOWER(member_email) = $3 RETURNING id, member_email, status, permissions, created_at`, [validated.value, ownerEmail, normalizeEmail(member.rows[0].member_email)]);
        return res.json({ ...result.rows[0], permissions: validated.value });
    } catch (error) { return dbError(res, error, 'Failed to update team member'); }
});

router.delete('/members/:id', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    try {
        const member = await pgClient.query('SELECT member_email FROM team_members WHERE id = $1 AND LOWER(owner_email) = $2', [req.params.id, ownerEmail]);
        if (!member.rowCount) return res.status(404).json({ error: 'Member not found' });
        const result = await pgClient.query('DELETE FROM team_members WHERE LOWER(owner_email) = $1 AND LOWER(member_email) = $2', [ownerEmail, normalizeEmail(member.rows[0].member_email)]);
        return res.json({ success: true, deletedCount: result.rowCount });
    } catch (error) { return dbError(res, error, 'Failed to delete team member'); }
});

router.get('/analytics', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    const period = req.query.period || 'today';
    if (!['today', '7d', '30d'].includes(period)) return res.status(400).json({ error: 'period must be today, 7d, or 30d' });

    const days = period === 'today' ? 1 : Number.parseInt(period, 10);
    const startAt = new Date();
    startAt.setHours(0, 0, 0, 0);
    startAt.setDate(startAt.getDate() - (days - 1));

    try {
        noStore(res);
        // Deployments that have not yet run the additive attribution migration must still be able
        // to load the team page without exposing fabricated analytics.
        const columns = await pgClient.query(
            `SELECT table_name, column_name
             FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name IN ('fb_chats', 'whatsapp_chats')
               AND column_name IN ('admin_user_id', 'admin_email')`
        );
        const found = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
        const attributionAvailable = ['fb_chats.admin_user_id', 'fb_chats.admin_email', 'whatsapp_chats.admin_user_id', 'whatsapp_chats.admin_email']
            .every(column => found.has(column));
        if (!attributionAvailable) {
            return res.json({
                period,
                kpis: { human_replies: 0, member_replies: 0, owner_replies: 0, unattributed_replies: 0 },
                members: [], activity: [], owner_replies: 0, unattributed_replies: 0,
                attribution_available: false
            });
        }

        const replies = await pgClient.query(
            `WITH scoped_replies AS (
                SELECT LOWER(NULLIF(BTRIM(f.admin_email), '')) AS admin_email, f.created_at
                FROM fb_chats f
                INNER JOIN page_access_token_message p ON p.page_id = f.page_id
                WHERE LOWER(p.email) = $1 AND f.reply_by = 'admin' AND f.created_at >= $2
                UNION ALL
                SELECT LOWER(NULLIF(BTRIM(w.admin_email), '')) AS admin_email, w.created_at
                FROM whatsapp_chats w
                INNER JOIN whatsapp_message_database d ON d.session_name = w.session_name
                WHERE LOWER(d.email) = $1 AND w.reply_by = 'admin' AND w.created_at >= $2
            ), active_members AS (
                SELECT DISTINCT LOWER(member_email) AS member_email
                FROM team_members
                WHERE LOWER(owner_email) = $1 AND status = 'active'
            )
            SELECT admin_email, created_at::date AS activity_date,
                   CASE WHEN admin_email = $1 THEN 'owner'
                        WHEN admin_email IS NULL THEN 'unattributed'
                        WHEN admin_email IN (SELECT member_email FROM active_members) THEN 'member'
                        ELSE 'other' END AS attribution
            FROM scoped_replies`,
            [ownerEmail, startAt]
        );

        const memberCounts = new Map();
        const activity = new Map();
        let ownerReplies = 0;
        let unattributedReplies = 0;
        for (const row of replies.rows) {
            const date = new Date(row.activity_date).toISOString().slice(0, 10);
            const daily = activity.get(date) || { date, human_replies: 0, member_replies: 0, owner_replies: 0, unattributed_replies: 0 };
            daily.human_replies += 1;
            if (row.attribution === 'owner') { ownerReplies += 1; daily.owner_replies += 1; }
            else if (row.attribution === 'unattributed') { unattributedReplies += 1; daily.unattributed_replies += 1; }
            else if (row.attribution === 'member') {
                memberCounts.set(row.admin_email, (memberCounts.get(row.admin_email) || 0) + 1);
                daily.member_replies += 1;
            }
            activity.set(date, daily);
        }
        const members = [...memberCounts.entries()]
            .map(([member_email, human_replies]) => ({ member_email, human_replies }))
            .sort((a, b) => b.human_replies - a.human_replies || a.member_email.localeCompare(b.member_email));
        const memberReplies = members.reduce((total, member) => total + member.human_replies, 0);
        return res.json({
            period,
            kpis: { human_replies: replies.rowCount, member_replies: memberReplies, owner_replies: ownerReplies, unattributed_replies: unattributedReplies },
            members,
            activity: [...activity.values()].sort((a, b) => a.date.localeCompare(b.date)),
            owner_replies: ownerReplies,
            unattributed_replies: unattributedReplies,
            attribution_available: true
        });
    } catch (error) { return dbError(res, error, 'Failed to fetch team analytics', { stage: 'analytics-get' }); }
});

router.get('/order-allocation', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    try {
        await ensureTeamOrderTables();
        const result = await pgClient.query('SELECT mode, batch_size, overflow, updated_at FROM team_order_settings WHERE owner_email = $1', [ownerEmail]);
        return res.json(result.rows[0] || { mode: 'manual', batch_size: 1, overflow: false, persisted: false });
    } catch (error) { return dbError(res, error, 'Failed to fetch order allocation settings', { stage: 'order-allocation-get' }); }
});

router.put('/order-allocation', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    const { mode, batch_size: batchSize, overflow } = req.body || {};
    if (!['manual', 'equal_share'].includes(mode) || !Number.isInteger(batchSize) || batchSize < 1 || typeof overflow !== 'boolean') {
        return res.status(400).json({ error: 'mode (manual|equal_share), positive integer batch_size, and boolean overflow are required' });
    }
    try {
        await ensureTeamOrderTables();
        const result = await pgClient.query(`INSERT INTO team_order_settings (owner_email, mode, batch_size, overflow) VALUES ($1, $2, $3, $4) ON CONFLICT (owner_email) DO UPDATE SET mode = EXCLUDED.mode, batch_size = EXCLUDED.batch_size, overflow = EXCLUDED.overflow, updated_at = NOW() RETURNING mode, batch_size, overflow, updated_at`, [ownerEmail, mode, batchSize, overflow]);
        return res.json(result.rows[0]);
    } catch (error) { return dbError(res, error, 'Failed to save order allocation settings', { stage: 'order-allocation-put' }); }
});

router.get('/order-quota', authMiddleware, async (req, res) => {
    const ownerEmail = requireOwner(req, res);
    if (!ownerEmail) return;
    try {
        await ensureTeamOrderTables();
        const [settingResult, memberResult, assignmentResult] = await Promise.all([
            pgClient.query('SELECT mode, batch_size FROM team_order_settings WHERE owner_email = $1', [ownerEmail]),
            pgClient.query("SELECT DISTINCT LOWER(member_email) AS member_email FROM team_members WHERE LOWER(owner_email) = $1 AND status = 'active' ORDER BY member_email", [ownerEmail]),
            pgClient.query('SELECT LOWER(member_email) AS member_email, COUNT(*)::int AS allocated FROM team_order_assignments WHERE LOWER(owner_email) = $1 AND member_email IS NOT NULL GROUP BY LOWER(member_email)', [ownerEmail])
        ]);
        const setting = settingResult.rows[0] || { mode: 'manual', batch_size: 1 };
        const mode = setting.mode === 'equal_share' ? 'equal_share' : 'manual';
        const batchSize = Number(setting.batch_size) || 1;
        const allocations = new Map(assignmentResult.rows.map(row => [row.member_email, Number(row.allocated) || 0]));
        const memberEmails = memberResult.rows.map(row => row.member_email);
        const quotaByMember = new Map(mode === 'equal_share'
            ? distributeOrderQuotas(batchSize, memberEmails).map(row => [row.member_email, row.quota])
            : []);
        const quotas = memberEmails.map(memberEmail => {
            const allocated = allocations.get(memberEmail) || 0;
            const quota = mode === 'equal_share' ? quotaByMember.get(memberEmail) : null;
            const remaining = quota === null ? null : Math.max(quota - allocated, 0);
            return {
                member_email: memberEmail,
                quota,
                allocated,
                remaining,
                status: mode === 'manual' ? 'manual' : (remaining === 0 ? 'full' : 'available')
            };
        });
        return res.json({ mode, batch_size: batchSize, quotas });
    } catch (error) { return dbError(res, error, 'Failed to calculate order quotas', { stage: 'order-quota-get' }); }
});

router.normalizeEmail = normalizeEmail;
router.distributeOrderQuotas = distributeOrderQuotas;
router.validatePermissions = validatePermissions;
router.mergePermissions = mergePermissions;
router.ownerContext = ownerContext;
router.validatePermissionResourceGrants = validatePermissionResourceGrants;
router.validateOwnerPermissionResourceGrants = validateOwnerPermissionResourceGrants;
module.exports = router;
