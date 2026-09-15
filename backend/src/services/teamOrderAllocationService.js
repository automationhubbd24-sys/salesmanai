const {
    canAuthorizeTeamResource,
    mergePermissions,
    normalizeEmail
} = require('./teamAuthorizationService');

const ACTIVE_STATUSES = new Set(['ongoing', 'pending']);

function distributeQuotas(totalCapacity, memberEmails) {
    const members = [...new Set((memberEmails || [])
        .map(normalizeEmail)
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    const capacity = Number.isInteger(totalCapacity) && totalCapacity > 0 ? totalCapacity : 0;
    const base = members.length ? Math.floor(capacity / members.length) : 0;
    const remainder = members.length ? capacity % members.length : 0;
    return members.map((member_email, index) => ({
        member_email,
        quota: base + (index < remainder ? 1 : 0)
    }));
}

/** Pure deterministic choice: lowest active workload, then email, while respecting equal quotas. */
function selectEligibleMember({ batchSize, memberEmails, workloads }) {
    const workloadByEmail = workloads instanceof Map
        ? workloads
        : new Map(Object.entries(workloads || {}).map(([email, count]) => [normalizeEmail(email), Number(count) || 0]));

    return distributeQuotas(batchSize, memberEmails)
        .map(({ member_email, quota }) => ({
            member_email,
            quota,
            workload: Number(workloadByEmail.get(member_email)) || 0
        }))
        .filter(candidate => candidate.workload < candidate.quota)
        .sort((a, b) => a.workload - b.workload || a.member_email.localeCompare(b.member_email))[0] || null;
}

async function resolveOwnerEmail(client, source, resourceId) {
    const table = source === 'fb' ? 'page_access_token_message' : 'whatsapp_message_database';
    const resourceColumn = source === 'fb' ? 'page_id' : 'session_name';
    const result = await client.query(
        `SELECT LOWER(email) AS owner_email FROM ${table} WHERE ${resourceColumn} = $1 AND email IS NOT NULL LIMIT 1`,
        [resourceId]
    );
    return normalizeEmail(result.rows[0]?.owner_email);
}

async function getEligibleMembers(client, ownerEmail, source, resourceId) {
    const result = await client.query(
        `SELECT owner_email, member_email, status, permissions
         FROM team_members
         WHERE LOWER(owner_email) = $1 AND status = 'active'`,
        [ownerEmail]
    );

    const members = new Map();
    for (const membership of result.rows) {
        const memberEmail = normalizeEmail(membership.member_email);
        if (!memberEmail) continue;
        const previous = members.get(memberEmail);
        const combined = previous
            ? { ...membership, permissions: mergePermissions([previous.permissions, membership.permissions]) }
            : { ...membership, permissions: mergePermissions([membership.permissions]) };
        if (canAuthorizeTeamResource({
            actorEmail: memberEmail,
            ownerEmail,
            membership: combined,
            resourceType: source === 'fb' ? 'fb_pages' : 'wa_sessions',
            resourceId,
            module: 'orders',
            action: 'view_assigned'
        })) {
            members.set(memberEmail, combined);
        }
    }
    return [...members.keys()].sort((a, b) => a.localeCompare(b));
}

async function getActiveWorkloads(client, ownerEmail, memberEmails) {
    if (!memberEmails.length) return new Map();
    const result = await client.query(
        `SELECT LOWER(assignment.member_email) AS member_email, COUNT(*)::int AS workload
         FROM team_order_assignments assignment
         LEFT JOIN fb_order_tracking fb
           ON assignment.source = 'fb' AND fb.id::text = assignment.order_identity
         LEFT JOIN whatsapp_order_tracking wa
           ON assignment.source = 'whatsapp' AND wa.id::text = assignment.order_identity
         WHERE LOWER(assignment.owner_email) = $1
           AND LOWER(assignment.member_email) = ANY($2::text[])
           AND (
                (assignment.source = 'fb' AND COALESCE(LOWER(fb.status), 'ongoing') = ANY($3::text[]) AND COALESCE(fb.is_locked, FALSE) = FALSE)
             OR (assignment.source = 'whatsapp' AND COALESCE(LOWER(wa.status), 'ongoing') = ANY($3::text[]))
           )
         GROUP BY LOWER(assignment.member_email)`,
        [ownerEmail, memberEmails, [...ACTIVE_STATUSES]]
    );
    return new Map(result.rows.map(row => [normalizeEmail(row.member_email), Number(row.workload) || 0]));
}

async function allocateNewOrder({ client, source, resourceId, orderIdentity }) {
    if (!client || !['fb', 'whatsapp'].includes(source) || !resourceId || orderIdentity === undefined || orderIdentity === null) {
        return null;
    }

    const ownerEmail = await resolveOwnerEmail(client, source, String(resourceId));
    if (!ownerEmail) return null;

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`team-order-allocation:${ownerEmail}:${source}:${resourceId}`]);

    const existing = await client.query(
        `SELECT member_email FROM team_order_assignments
         WHERE owner_email = $1 AND source = $2 AND resource_id = $3 AND order_identity = $4`,
        [ownerEmail, source, String(resourceId), String(orderIdentity)]
    );
    if (existing.rowCount) return { owner_email: ownerEmail, member_email: existing.rows[0].member_email, existing: true };

    const settingsResult = await client.query(
        `SELECT batch_size FROM team_order_settings
         WHERE owner_email = $1 AND mode = 'equal_share' LIMIT 1`,
        [ownerEmail]
    );
    if (!settingsResult.rowCount) return null;

    const memberEmails = await getEligibleMembers(client, ownerEmail, source, String(resourceId));
    const workloads = await getActiveWorkloads(client, ownerEmail, memberEmails);
    const selected = selectEligibleMember({
        batchSize: Number(settingsResult.rows[0].batch_size),
        memberEmails,
        workloads
    });

    await client.query(
        `INSERT INTO team_order_assignments (owner_email, source, resource_id, order_identity, member_email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_email, source, resource_id, order_identity) DO NOTHING`,
        [ownerEmail, source, String(resourceId), String(orderIdentity), selected?.member_email || null]
    );
    return { owner_email: ownerEmail, member_email: selected?.member_email || null, existing: false };
}

module.exports = {
    ACTIVE_STATUSES,
    distributeQuotas,
    selectEligibleMember,
    allocateNewOrder
};
