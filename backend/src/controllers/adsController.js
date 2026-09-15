const dbService = require('../services/dbService');
const jwt = require('jsonwebtoken');

// Simple In-Memory Cache for Team Checks (5 minutes TTL)
const teamUserCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getEffectiveUserIdFromRequest(req, baseUserId) {
    let userId = baseUserId || null;
    let viewerEmail = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const secret = process.env.JWT_SECRET;
        try {
            const payload = jwt.verify(token, secret);
            userId = payload.sub || baseUserId || null;
            viewerEmail = payload.email || null;
        } catch (e) {
            console.error("JWT Verification failed:", e.message);
        }
    }

    const pgClient = require('../services/pgClient');

    const lookupId = baseUserId || userId;
    if (!viewerEmail && lookupId) {
         try {
             const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1::uuid', [lookupId]);
             if (userRes.rows.length > 0) {
                 viewerEmail = userRes.rows[0].email;
             }
         } catch (e) {
             console.error("[AuthDebug] Failed to resolve email from ID:", e);
         }
    }

    if (!userId && !baseUserId) {
        return { effectiveUserId: null, isTeamMember: false, viewerEmail, teamOwnerEmail: null };
    }

    let effectiveUserId = userId || baseUserId;
    let isTeamMember = false;

    if (viewerEmail) {
        const normalizedEmail = viewerEmail.trim().toLowerCase();
        const pgClient = require('../services/pgClient');

        const pageId = req.query?.page_id || req.body?.page_id;
        if (pageId) {
            try {
                const pageRes = await pgClient.query(
                   'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL',
                   [String(pageId)]
                );
                
                if (pageRes.rows.length > 0) {
                    const pageOwnerId = pageRes.rows[0].user_id;
                    if (pageOwnerId === userId) {
                        return { effectiveUserId: userId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
                    }
                }
            } catch (e) {
                console.error("[AuthDebug] Failed to check page ownership:", e);
            }
        }

        const requestedTeamOwner = req.query?.team_owner || req.headers['x-team-owner'] || req.body?.team_owner;
        if (requestedTeamOwner) {
             const teamResult = await pgClient.query(
                'SELECT owner_email FROM team_members WHERE LOWER(member_email) = LOWER($1) AND LOWER(owner_email) = LOWER($2) AND status = $3',
                [normalizedEmail, requestedTeamOwner, 'active']
            );

            if (teamResult.rows.length > 0) {
                const ownerEmail = teamResult.rows[0].owner_email;
                const userResult = await pgClient.query(
                    'SELECT id FROM users WHERE email = $1',
                    [ownerEmail]
                );

                if (userResult.rows.length > 0) {
                    effectiveUserId = userResult.rows[0].id;
                    isTeamMember = true;
                    return { effectiveUserId, isTeamMember, viewerEmail: normalizedEmail, teamOwnerEmail: ownerEmail };
                }
            }
        }

        if (!requestedTeamOwner && pageId) {
             try {
                 let pageRes = await pgClient.query(
                    'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL',
                    [String(pageId)]
                 );
                 
                 if (pageRes.rows.length === 0) {
                     pageRes = await pgClient.query(
                        'SELECT user_id, email FROM whatsapp_message_database WHERE session_name = $1 AND user_id IS NOT NULL',
                        [String(pageId)]
                     );
                 }
                 
                 if (pageRes.rows.length > 0) {
                     const pageOwnerId = pageRes.rows[0].user_id;
                     const pageOwnerEmail = pageRes.rows[0].email;
                     
                     if (pageOwnerId === userId) {
                         return { effectiveUserId: userId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
                     }

                     const teamCheck = await pgClient.query(
                         'SELECT 1 FROM team_members WHERE LOWER(member_email) = LOWER($1) AND LOWER(owner_email) = LOWER($2) AND status = $3',
                         [normalizedEmail, pageOwnerEmail, 'active']
                     );
                     
                     if (teamCheck.rows.length > 0) {
                         effectiveUserId = pageOwnerId;
                         isTeamMember = true;
                         return { effectiveUserId, isTeamMember, viewerEmail: normalizedEmail, teamOwnerEmail: pageOwnerEmail };
                     }
                 }
             } catch (e) {
                 console.error("[AuthDebug] Failed to resolve page/session context:", e);
             }
        }

        return { effectiveUserId: userId || baseUserId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
    }

    return { effectiveUserId, isTeamMember: false, viewerEmail, teamOwnerEmail: null };
}

exports.getAds = async (req, res) => {
    try {
        const baseUserId = req.query.user_id || null;
        const { effectiveUserId, isTeamMember, viewerEmail, teamOwnerEmail } = await getEffectiveUserIdFromRequest(req, baseUserId);

        if (!effectiveUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        let allowedPageIds = null;
        if (isTeamMember && viewerEmail) {
            const requestedTeamOwner = req.query?.team_owner || req.headers['x-team-owner'] || teamOwnerEmail;
            if (requestedTeamOwner) {
                const pgClient = require('../services/pgClient');
                const teamRes = await pgClient.query(
                    'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                    [viewerEmail, requestedTeamOwner, 'active']
                );

                let teamPages = [];
                if (teamRes.rows.length > 0) {
                    teamRes.rows.forEach(row => {
                        const perms = row.permissions || {};
                        if (Array.isArray(perms.fb_pages)) teamPages.push(...perms.fb_pages);
                        if (Array.isArray(perms.wa_sessions)) teamPages.push(...perms.wa_sessions);
                    });
                }
                allowedPageIds = [...new Set(teamPages)].map(String);
            }
        }

        const ads = await dbService.getAdsByUserId(effectiveUserId, allowedPageIds);
        res.json(ads);
    } catch (error) {
        console.error("Get Ads Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.saveAd = async (req, res) => {
    try {
        const { ad_id, page_id, description, linked_product_ids, user_id: baseUserId } = req.body;
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);

        if (!effectiveUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const ad = await dbService.saveAdContext({
            ad_id,
            page_id,
            user_id: effectiveUserId,
            description,
            linked_product_ids
        });

        res.status(201).json(ad);
    } catch (error) {
        console.error("Save Ad Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.deleteAd = async (req, res) => {
    try {
        const { ad_id, page_id } = req.query;
        if (!ad_id || !page_id) {
            return res.status(400).json({ error: "ad_id and page_id are required" });
        }

        await dbService.deleteAdContext(ad_id, page_id);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete Ad Error:", error);
        res.status(500).json({ error: error.message });
    }
};
