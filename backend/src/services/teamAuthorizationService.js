const MODULE_PERMISSION_SCHEMA = Object.freeze({
    smart_inbox: Object.freeze(['view', 'reply', 'analytics']),
    orders: Object.freeze(['view_assigned', 'view_all', 'assign', 'analytics']),
    conversion: Object.freeze(['view', 'manage']),
    ai_settings: Object.freeze(['view', 'manage']),
    control_panel: Object.freeze(['view', 'manage']),
    team: Object.freeze(['view', 'manage', 'analytics'])
});

const LEGACY_RESOURCE_KEYS = Object.freeze({
    fb_pages: 'fb_pages',
    wa_sessions: 'wa_sessions'
});
const LEGACY_PERMISSION_KEYS = new Set(Object.keys(LEGACY_RESOURCE_KEYS));

function normalizeEmail(email) {
    if (typeof email !== 'string') return null;
    const normalized = email.trim().toLowerCase();
    return normalized && normalized.includes('@') ? normalized : null;
}

function emptyPermissions() {
    const permissions = { fb_pages: [], wa_sessions: [] };
    for (const [moduleName, actions] of Object.entries(MODULE_PERMISSION_SCHEMA)) {
        permissions[moduleName] = Object.fromEntries(actions.map(action => [action, false]));
    }
    return permissions;
}

/** Strictly validate and canonicalize a persisted team permission document. */
function validatePermissions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, error: 'permissions must be an object' };
    }

    const permissions = emptyPermissions();
    for (const [key, entry] of Object.entries(value)) {
        if (LEGACY_PERMISSION_KEYS.has(key)) {
            if (!Array.isArray(entry) || entry.some(item => typeof item !== 'string')) {
                return { valid: false, error: `${key} must be an array of strings` };
            }
            permissions[key] = [...new Set(entry.map(item => item.trim()).filter(Boolean))];
            continue;
        }

        const actions = MODULE_PERMISSION_SCHEMA[key];
        if (!actions || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { valid: false, error: `Unknown or invalid permission key: ${key}` };
        }
        for (const [action, allowed] of Object.entries(entry)) {
            if (!actions.includes(action) || typeof allowed !== 'boolean') {
                return { valid: false, error: `Unknown or invalid permission: ${key}.${action}` };
            }
            permissions[key][action] = allowed;
        }
    }
    return { valid: true, value: permissions };
}

/** Merge duplicate historical membership permission documents without losing granted access. */
function mergePermissions(permissionDocuments) {
    const merged = emptyPermissions();
    for (const document of permissionDocuments || []) {
        const validated = validatePermissions(document || {});
        if (!validated.valid) continue;
        const permissions = validated.value;
        for (const legacyKey of LEGACY_PERMISSION_KEYS) {
            merged[legacyKey] = [...new Set([...merged[legacyKey], ...permissions[legacyKey]])];
        }
        for (const [moduleName, actions] of Object.entries(MODULE_PERMISSION_SCHEMA)) {
            for (const action of actions) merged[moduleName][action] ||= permissions[moduleName][action];
        }
    }
    return merged;
}

function isTeamOwner(actorEmail, ownerEmail) {
    const actor = normalizeEmail(actorEmail);
    const owner = normalizeEmail(ownerEmail);
    return Boolean(actor && owner && actor === owner);
}

function hasFullTeamAccess({ actorEmail, ownerEmail }) {
    return isTeamOwner(actorEmail, ownerEmail);
}

function isActiveTeamMember({ membership, actorEmail, ownerEmail }) {
    return Boolean(
        membership
        && membership.status === 'active'
        && normalizeEmail(membership.member_email) === normalizeEmail(actorEmail)
        && normalizeEmail(membership.owner_email) === normalizeEmail(ownerEmail)
    );
}

function canAuthorizeTeamAction({ actorEmail, ownerEmail, membership, module, action }) {
    if (hasFullTeamAccess({ actorEmail, ownerEmail })) return true;
    if (!MODULE_PERMISSION_SCHEMA[module] || !MODULE_PERMISSION_SCHEMA[module].includes(action)) return false;
    if (!isActiveTeamMember({ membership, actorEmail, ownerEmail })) return false;

    const validated = validatePermissions(membership.permissions || {});
    return Boolean(validated.valid && validated.value[module][action]);
}

function canAuthorizeTeamResource({ actorEmail, ownerEmail, membership, resourceType, resourceId, module, action }) {
    if (hasFullTeamAccess({ actorEmail, ownerEmail })) return true;
    if (!isActiveTeamMember({ membership, actorEmail, ownerEmail })) return false;
    if (module || action) {
        if (!canAuthorizeTeamAction({ actorEmail, ownerEmail, membership, module, action })) return false;
    }

    const resourceKey = LEGACY_RESOURCE_KEYS[resourceType];
    if (!resourceKey || typeof resourceId !== 'string' || !resourceId.trim()) return false;
    const validated = validatePermissions(membership.permissions || {});
    return Boolean(validated.valid && validated.value[resourceKey].includes(resourceId.trim()));
}

const RESOURCE_QUERIES = Object.freeze({
    fb_pages: `SELECT page_id AS resource_id, email AS owner_email
               FROM page_access_token_message
               WHERE page_id = $1
               LIMIT 1`,
    wa_sessions: `SELECT session_name AS resource_id, email AS owner_email
                  FROM whatsapp_message_database
                  WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1
                  LIMIT 1`
});

/** Resolve a resource and authorize the authenticated owner or a permitted active team member. */
async function resolveAuthorizedTeamResource({ pgClient, actorEmail, resourceType, resourceId, module, action }) {
    const normalizedActor = normalizeEmail(actorEmail);
    const query = RESOURCE_QUERIES[resourceType];
    if (!pgClient || !query || !normalizedActor || typeof resourceId !== 'string' || !resourceId.trim()) return null;

    const resourceResult = await pgClient.query(query, [resourceId.trim()]);
    const resource = resourceResult.rows[0];
    const ownerEmail = normalizeEmail(resource?.owner_email);
    const canonicalResourceId = String(resource?.resource_id || '').trim();
    if (!resource || !ownerEmail || !canonicalResourceId) return null;

    if (hasFullTeamAccess({ actorEmail: normalizedActor, ownerEmail })) {
        return { authorized: true, isOwner: true, ownerEmail, resourceId: canonicalResourceId, membership: null };
    }

    const memberships = await pgClient.query(
        `SELECT owner_email, member_email, status, permissions
         FROM team_members
         WHERE LOWER(owner_email) = $1 AND LOWER(member_email) = $2 AND status = 'active'`,
        [ownerEmail, normalizedActor]
    );
    if (!memberships.rowCount) return null;

    const membership = {
        owner_email: ownerEmail,
        member_email: normalizedActor,
        status: 'active',
        permissions: mergePermissions(memberships.rows.map(row => row.permissions))
    };
    const authorized = canAuthorizeTeamResource({
        actorEmail: normalizedActor,
        ownerEmail,
        membership,
        resourceType,
        resourceId: canonicalResourceId,
        module,
        action
    });
    return { authorized, isOwner: false, ownerEmail, resourceId: canonicalResourceId, membership };
}

module.exports = {
    MODULE_PERMISSION_SCHEMA,
    LEGACY_RESOURCE_KEYS,
    normalizeEmail,
    emptyPermissions,
    validatePermissions,
    mergePermissions,
    isTeamOwner,
    hasFullTeamAccess,
    isActiveTeamMember,
    canAuthorizeTeamAction,
    canAuthorizeTeamResource,
    resolveAuthorizedTeamResource
};
