const SMART_INBOX_MANUAL_LABELS = new Set(["order", "human_transfer"]);

const SMART_INBOX_LABEL_TITLES = {
    agent: "Agent",
    human: "Human",
    reminder: "Reminder",
    order: "Order",
    human_transfer: "Human Transfer"
};

const PLATFORM_CONFIG = {
    whatsapp: {
        chatsTable: "whatsapp_chats",
        resourceColumn: "session_name",
        orderTable: "whatsapp_order_tracking",
        timestampExpression: "COALESCE(timestamp, EXTRACT(EPOCH FROM created_at) * 1000)",
        senderNameExpression: "CASE WHEN BTRIM(COALESCE(sender_name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(sender_name, ''))) NOT IN ('', 'unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined') THEN NULLIF(BTRIM(sender_name), '') END",
        conversationNameJoin: `
            LEFT JOIN LATERAL (
                SELECT CASE
                    WHEN wc.is_locked OR wc.name_source IN ('manual', 'custom')
                         OR (wc.name_source IS NULL
                             AND BTRIM(COALESCE(wc.name, '')) <> ''
                             AND BTRIM(COALESCE(wc.name, '')) !~ '^[0-9]+$'
                             AND LOWER(BTRIM(COALESCE(wc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN wc.name
                    ELSE COALESCE(wc.profile_name, wc.username, wc.name)
                END AS name
                FROM whatsapp_contacts wc
                WHERE wc.session_name = $1
                  AND (wc.phone_number = COALESCE(lp.conversation_id, lf.conversation_id, ls.conversation_id)
                       OR wc.lid = COALESCE(lp.conversation_id, lf.conversation_id, ls.conversation_id))
                  AND BTRIM(COALESCE(CASE WHEN wc.is_locked OR wc.name_source IN ('manual', 'custom') OR (wc.name_source IS NULL AND BTRIM(COALESCE(wc.name, '')) <> '' AND BTRIM(COALESCE(wc.name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(wc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN wc.name ELSE COALESCE(wc.profile_name, wc.name) END, '')) !~ '^[0-9]+$'
                  AND LOWER(BTRIM(COALESCE(CASE WHEN wc.is_locked OR wc.name_source IN ('manual', 'custom') OR (wc.name_source IS NULL AND BTRIM(COALESCE(wc.name, '')) <> '' AND BTRIM(COALESCE(wc.name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(wc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN wc.name ELSE COALESCE(wc.profile_name, wc.name) END, ''))) NOT IN ('', 'unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')
                ORDER BY wc.last_interaction DESC NULLS LAST
                LIMIT 1
            ) wc ON TRUE`,
        conversationNameExpression: "COALESCE(wc.name, lsn.sender_name)"
    },
    messenger: {
        chatsTable: "fb_chats",
        resourceColumn: "page_id",
        orderTable: "fb_order_tracking",
        timestampExpression: "COALESCE(timestamp, EXTRACT(EPOCH FROM created_at) * 1000)",
        senderNameExpression: "CASE WHEN BTRIM(COALESCE(sender_name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(sender_name, ''))) NOT IN ('', 'unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined') THEN NULLIF(BTRIM(sender_name), '') END",
        chatPlatformCondition: "platform = 'messenger'",
        conversationNameJoin: `
            LEFT JOIN LATERAL (
                SELECT CASE
                    WHEN fc.is_locked OR fc.name_source IN ('manual', 'custom')
                         OR (fc.name_source IS NULL
                             AND BTRIM(COALESCE(fc.name, '')) <> ''
                             AND BTRIM(COALESCE(fc.name, '')) !~ '^[0-9]+$'
                             AND LOWER(BTRIM(COALESCE(fc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN fc.name
                    ELSE COALESCE(fc.profile_name, fc.name)
                END AS name
                FROM fb_contacts fc
                WHERE fc.page_id = $1
                  AND fc.sender_id = COALESCE(lp.conversation_id, lf.conversation_id, ls.conversation_id)
                  AND BTRIM(COALESCE(CASE WHEN fc.is_locked OR fc.name_source IN ('manual', 'custom') OR (fc.name_source IS NULL AND BTRIM(COALESCE(fc.name, '')) <> '' AND BTRIM(COALESCE(fc.name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(fc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN fc.name ELSE COALESCE(fc.profile_name, fc.name) END, '')) !~ '^[0-9]+$'
                  AND LOWER(BTRIM(COALESCE(CASE WHEN fc.is_locked OR fc.name_source IN ('manual', 'custom') OR (fc.name_source IS NULL AND BTRIM(COALESCE(fc.name, '')) <> '' AND BTRIM(COALESCE(fc.name, '')) !~ '^[0-9]+$' AND LOWER(BTRIM(COALESCE(fc.name, ''))) NOT IN ('unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')) THEN fc.name ELSE COALESCE(fc.profile_name, fc.name) END, ''))) NOT IN ('', 'unknown', 'unknown user', 'customer', 'whatsapp user', 'messenger user', 'null', 'undefined')
                ORDER BY fc.last_interaction DESC NULLS LAST, fc.updated_at DESC NULLS LAST
                LIMIT 1
            ) fc ON TRUE`,
        conversationNameExpression: "COALESCE(fc.name, lsn.sender_name)"
    },
    instagram: {
        chatsTable: "instagram_chats",
        resourceColumn: "instagram_account_id",
        orderTable: "instagram_order_tracking",
        timestampExpression: "COALESCE(timestamp, EXTRACT(EPOCH FROM created_at) * 1000)",
        senderNameExpression: "CASE WHEN LOWER(BTRIM(COALESCE(sender_name, ''))) NOT IN ('unknown', 'customer', 'null', 'undefined') THEN NULLIF(BTRIM(sender_name), '') END",
        conversationNameExpression: "lsn.sender_name"
    }
};

function normalizeSmartInboxLabelKey(labelKey) {
    const normalized = String(labelKey || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");

    if (normalized === "humantransfer") {
        return "human_transfer";
    }

    return normalized;
}

async function ensureSmartInboxLabelsTable(pgClient) {
    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS smart_inbox_labels (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            platform TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            label_key TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(platform, resource_id, sender_id, label_key)
        );

        CREATE INDEX IF NOT EXISTS idx_smart_inbox_labels_lookup
            ON smart_inbox_labels(platform, resource_id, sender_id);
    `);
}

function buildConversationPayload(row) {
    const primaryLabel = row.primary_label || null;
    const activeLabels = [];

    if (primaryLabel === "agent" || primaryLabel === "human") {
        activeLabels.push(primaryLabel);
    }

    if (row.has_reminder) {
        activeLabels.push("reminder");
    }

    if (row.order_selected) {
        activeLabels.push("order");
    }

    if (row.human_transfer_selected) {
        activeLabels.push("human_transfer");
    }

    return {
        id: row.id,
        from: row.id,
        display_name: row.name || null,
        contact: row.name || null,
        name: row.name || null,
        body: row.body || "",
        timestamp: row.timestamp ? Number(row.timestamp) : null,
        reply_by: row.last_reply_state || null,
        status: row.last_status || null,
        primary_label: primaryLabel,
        primary_label_title: primaryLabel ? SMART_INBOX_LABEL_TITLES[primaryLabel] : null,
        active_labels: activeLabels,
        active_label_titles: activeLabels.map((key) => SMART_INBOX_LABEL_TITLES[key]),
        has_reminder: Boolean(row.has_reminder),
        has_order: Boolean(row.has_order),
        order_status: row.order_status || null,
        order_selected: Boolean(row.order_selected),
        human_transfer_selected: Boolean(row.human_transfer_selected),
        manual_label_overrides: {
            order: row.order_override,
            human_transfer: row.human_transfer_override
        }
    };
}

async function getSmartInboxConversations(pgClient, platform, resourceId) {
    const config = PLATFORM_CONFIG[platform];
    if (!config) {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    await ensureSmartInboxLabelsTable(pgClient);

    const buildQuery = (includeContactName) => {
        const conversationIdExpression = "COALESCE(lp.conversation_id, lf.conversation_id, ls.conversation_id)";
        const conversationNameJoin = includeContactName ? (config.conversationNameJoin || "") : "";
        const conversationNameExpression = includeContactName
            ? (config.conversationNameExpression || "lsn.sender_name")
            : "lsn.sender_name";

        return `
        WITH base_messages AS (
            SELECT
                CASE
                    WHEN sender_id = $1 THEN recipient_id
                    ELSE sender_id
                END AS conversation_id,
                text,
                reply_by,
                status,
                ${config.senderNameExpression || 'NULL::text'} AS sender_name,
                ${config.timestampExpression} AS event_at
            FROM ${config.chatsTable}
            WHERE ${config.resourceColumn} = $1
              AND ${config.chatPlatformCondition || 'TRUE'}
        ),
        usable_messages AS (
            SELECT *
            FROM base_messages
            WHERE COALESCE(conversation_id, '') <> ''
        ),
        latest_preview AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                text AS body,
                event_at
            FROM usable_messages
            WHERE COALESCE(NULLIF(BTRIM(text), ''), '') <> ''
              AND reply_by <> 'system'
            ORDER BY conversation_id, event_at DESC
        ),
        latest_fallback AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                text AS body,
                event_at
            FROM usable_messages
            ORDER BY conversation_id, event_at DESC
        ),
        latest_signal AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                reply_by,
                status,
                event_at
            FROM usable_messages
            WHERE reply_by IN ('user', 'bot', 'admin', 'system')
            ORDER BY conversation_id, event_at DESC
        ),
        reminder_flags AS (
            SELECT
                conversation_id,
                BOOL_OR(status = 'reminder' OR reply_by = 'system') AS has_reminder
            FROM usable_messages
            GROUP BY conversation_id
        ),
        latest_sender_name AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                sender_name
            FROM usable_messages
            WHERE reply_by = 'user'
              AND sender_name IS NOT NULL
            ORDER BY conversation_id, event_at DESC
        ),
        manual_labels AS (
            SELECT
                sender_id,
                BOOL_OR(is_active) FILTER (WHERE label_key = 'order') AS order_override,
                BOOL_OR(is_active) FILTER (WHERE label_key = 'human_transfer') AS human_transfer_override
            FROM smart_inbox_labels
            WHERE platform = $2
              AND resource_id = $1
            GROUP BY sender_id
        ),
        latest_orders AS (
            SELECT DISTINCT ON (sender_id)
                sender_id,
                status
            FROM ${config.orderTable}
            WHERE ${config.resourceColumn} = $1
            ORDER BY sender_id, id DESC
        )
        SELECT
            COALESCE(lp.conversation_id, lf.conversation_id, ls.conversation_id) AS id,
            COALESCE(lp.body, lf.body, '') AS body,
            COALESCE(lp.event_at, lf.event_at, ls.event_at) AS timestamp,
            ls.reply_by AS last_reply_state,
            ls.status AS last_status,
            COALESCE(rf.has_reminder, FALSE) AS has_reminder,
            CASE
                WHEN ls.reply_by = 'bot' THEN 'agent'
                WHEN ls.reply_by = 'admin' THEN 'human'
                ELSE NULL
            END AS primary_label,
            COALESCE(lo.sender_id IS NOT NULL, FALSE) AS has_order,
            lo.status AS order_status,
            CASE
                WHEN ml.order_override IS NULL THEN COALESCE(lo.sender_id IS NOT NULL, FALSE)
                ELSE ml.order_override
            END AS order_selected,
            CASE
                WHEN ml.human_transfer_override IS NULL THEN COALESCE(ls.reply_by = 'user', FALSE)
                ELSE ml.human_transfer_override
            END AS human_transfer_selected,
            ml.order_override,
            ml.human_transfer_override,
            ${conversationNameExpression} AS name
        FROM latest_signal ls
        FULL OUTER JOIN latest_preview lp
            ON lp.conversation_id = ls.conversation_id
        FULL OUTER JOIN latest_fallback lf
            ON lf.conversation_id = COALESCE(ls.conversation_id, lp.conversation_id)
        LEFT JOIN manual_labels ml
            ON ml.sender_id = ${conversationIdExpression}
        LEFT JOIN latest_orders lo
            ON lo.sender_id = ${conversationIdExpression}
        LEFT JOIN latest_sender_name lsn
            ON lsn.conversation_id = ${conversationIdExpression}
        LEFT JOIN reminder_flags rf
            ON rf.conversation_id = ${conversationIdExpression}
        ${conversationNameJoin}
        WHERE ${conversationIdExpression} IS NOT NULL
        ORDER BY COALESCE(lp.event_at, lf.event_at, ls.event_at) DESC
    `;
    };

    let result;
    try {
        result = await pgClient.query(buildQuery(true), [resourceId, platform]);
    } catch (error) {
        if (!config.conversationNameJoin || (error?.code !== '42P01' && error?.code !== '42703')) {
            throw error;
        }
        result = await pgClient.query(buildQuery(false), [resourceId, platform]);
    }

    return result.rows.map(buildConversationPayload);
}

async function upsertSmartInboxLabel(pgClient, {
    platform,
    resourceId,
    senderId,
    labelKey,
    isActive
}) {
    const normalizedKey = normalizeSmartInboxLabelKey(labelKey);

    if (!SMART_INBOX_MANUAL_LABELS.has(normalizedKey)) {
        throw new Error("Unsupported smart inbox label");
    }

    await ensureSmartInboxLabelsTable(pgClient);

    await pgClient.query(
        `INSERT INTO smart_inbox_labels (platform, resource_id, sender_id, label_key, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (platform, resource_id, sender_id, label_key)
         DO UPDATE SET
            is_active = EXCLUDED.is_active,
            updated_at = NOW()`,
        [platform, resourceId, senderId, normalizedKey, Boolean(isActive)]
    );

    const conversations = await getSmartInboxConversations(pgClient, platform, resourceId);
    return conversations.find((item) => String(item.id) === String(senderId)) || null;
}

module.exports = {
    SMART_INBOX_LABEL_TITLES,
    ensureSmartInboxLabelsTable,
    getSmartInboxConversations,
    normalizeSmartInboxLabelKey,
    upsertSmartInboxLabel
};
