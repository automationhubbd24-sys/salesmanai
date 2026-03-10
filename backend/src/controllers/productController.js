const multer = require('multer');
const dbService = require('../services/dbService');
const woocommerceService = require('../services/woocommerceService');
const imageService = require('../services/imageService');

// Simple In-Memory Cache for Team Checks (5 minutes TTL)
const teamUserCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; 

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

exports.uploadMiddleware = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'images', maxCount: 10 }]);

async function getEffectiveUserIdFromRequest(req, baseUserId) {
    let userId = baseUserId || null;
    let viewerEmail = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET;
        try {
            const payload = jwt.verify(token, secret);
            userId = payload.sub || baseUserId || null;
            viewerEmail = payload.email || null;
        } catch (e) {
            console.error("JWT Verification failed:", e.message);
        }
    }

    console.log(`[AuthDebug] Base: ${baseUserId}, TokenUser: ${userId}, Email: ${viewerEmail}`);

    const pgClient = require('../services/pgClient');

    // Fallback: If no token email, try to find email from baseUserId or userId (from token)
    const lookupId = baseUserId || userId;
    if (!viewerEmail && lookupId) {
         try {
             const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1::uuid', [lookupId]);
             if (userRes.rows.length > 0) {
                 viewerEmail = userRes.rows[0].email;
                 console.log(`[AuthDebug] Resolved Email from ID (${lookupId}): ${viewerEmail}`);
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
        // Ensure email is lowercase and trimmed for matching
        const normalizedEmail = viewerEmail.trim().toLowerCase();

        const pgClient = require('../services/pgClient');

        // 0. CRITICAL PRIORITY: Check Page Ownership First!
        // If I am interacting with a page I OWN, I must stay in my Personal Context.
        // This overrides any cached Team Context or Explicit Team Request.
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
                        console.log(`[AuthDebug] Page ${pageId} is owned by ME (${viewerEmail}). Forcing Personal Context. EffectiveUser: ${userId}`);
                        return { effectiveUserId: userId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
                    } else {
                        console.log(`[AuthDebug] Page ${pageId} owned by ${pageOwnerId}, but I am ${userId}. Continuing to team check...`);
                    }
                }
            } catch (e) {
                console.error("[AuthDebug] Failed to check page ownership:", e);
            }
        } else {
             console.log(`[AuthDebug] No page_id provided. Using Global Context logic.`);
        }

        // 1. Check Cache (DISABLED to prevent stale context issues)
        // if (teamUserCache.has(normalizedEmail)) { ... }

        // 2. EXPLICIT TEAM CONTEXT (Professional Workspace)
        // Check if the request explicitly asks for a specific team context
        const requestedTeamOwner = req.query?.team_owner || req.headers['x-team-owner'] || req.body?.team_owner;
        
        if (requestedTeamOwner) {
             console.log(`[AuthDebug] Requested Team Owner: ${requestedTeamOwner}`);

             const teamResult = await pgClient.query(
                'SELECT owner_email FROM team_members WHERE LOWER(member_email) = LOWER($1) AND LOWER(owner_email) = LOWER($2) AND status = $3',
                [normalizedEmail, requestedTeamOwner, 'active']
            );

            if (teamResult.rows.length > 0) {
                const ownerEmail = teamResult.rows[0].owner_email;
                console.log(`[AuthDebug] Explicit Team Context: ${ownerEmail} for member ${normalizedEmail}`);
                
                const userResult = await pgClient.query(
                    'SELECT id FROM users WHERE email = $1',
                    [ownerEmail]
                );

                if (userResult.rows.length > 0) {
                    effectiveUserId = userResult.rows[0].id;
                    isTeamMember = true;
                    // Cache the result
                    teamUserCache.set(normalizedEmail, { userId: effectiveUserId, isTeamMember: true, teamOwnerEmail: ownerEmail, timestamp: Date.now() });
                    return { effectiveUserId, isTeamMember, viewerEmail: normalizedEmail, teamOwnerEmail: ownerEmail };
                }
            }
        }

        // 3. Fallback: Personal Workspace OR Auto-Detect via Page Context
        if (!requestedTeamOwner) {
             const pgClient = require('../services/pgClient');
             
             // DYNAMIC CONTEXT: Check Page Owner
             // If a specific page is requested, we check if that page belongs to a Team Owner
             // If so, we automatically switch to that Team Owner's context.
             const pageId = req.query?.page_id || req.body?.page_id;
             
             if (pageId) {
                 try {
                     // 1. Check Messenger Pages
                     let pageRes = await pgClient.query(
                        'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL',
                        [String(pageId)]
                     );
                     
                     // 2. Fallback to WhatsApp Sessions
                     if (pageRes.rows.length === 0) {
                         pageRes = await pgClient.query(
                            'SELECT user_id, email FROM whatsapp_message_database WHERE session_name = $1 AND user_id IS NOT NULL',
                            [String(pageId)]
                         );
                     }
                     
                     if (pageRes.rows.length > 0) {
                         const pageOwnerId = pageRes.rows[0].user_id;
                         const pageOwnerEmail = pageRes.rows[0].email;
                         
                         // CRITICAL FIX: If I am the Page Owner, I must stay in my OWN context!
                         if (pageOwnerId === userId) {
                             console.log(`[AuthDebug] Resource ${pageId} is owned by ME (${viewerEmail}). Staying in Personal Context.`);
                             return { effectiveUserId: userId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
                         }

                         // Check if I am a member of this Resource Owner's team
                         const teamCheck = await pgClient.query(
                             'SELECT 1 FROM team_members WHERE LOWER(member_email) = LOWER($1) AND LOWER(owner_email) = LOWER($2) AND status = $3',
                             [normalizedEmail, pageOwnerEmail, 'active']
                         );
                         
                         if (teamCheck.rows.length > 0) {
                             console.log(`[AuthDebug] Auto-detected Team Context via Resource ${pageId}: ${pageOwnerEmail}`);
                             effectiveUserId = pageOwnerId;
                             isTeamMember = true;
                             return { effectiveUserId, isTeamMember, viewerEmail: normalizedEmail, teamOwnerEmail: pageOwnerEmail };
                         }
                     }
                 } catch (e) {
                     console.error("[AuthDebug] Failed to resolve page/session context:", e);
                 }
             }
        }

        return { effectiveUserId: userId || baseUserId, isTeamMember: false, viewerEmail: normalizedEmail, teamOwnerEmail: null };
    }

    return { effectiveUserId, isTeamMember: false, viewerEmail, teamOwnerEmail: null };
}

async function resolveProductOwnerUserId(req, baseUserId, pageId) {
    // 1. Resolve Effective User (Handles Team Context)
    // We prioritize Team Context: If user is acting as Team Member, products belong to Team Owner.
    const { effectiveUserId, isTeamMember, viewerEmail } = await getEffectiveUserIdFromRequest(req, baseUserId);
    
    // EXTRA SAFETY FIX: If I am the Page Owner, I MUST OWN my own products.
    // Even if getEffectiveUserIdFromRequest decided I'm a "Team Member" (e.g. because of active_team_owner or automatic team detection),
    // we override it here for product creation to ensure I own what I create on MY page.
    if (pageId && viewerEmail) {
         try {
             const pgClient = require('../services/pgClient');
             const pageRes = await pgClient.query(
                'SELECT email, user_id FROM page_access_token_message WHERE page_id = $1 AND email IS NOT NULL',
                [String(pageId)]
             );
             if (pageRes.rows.length > 0) {
                 const pageOwnerEmail = pageRes.rows[0].email;
                 if (pageOwnerEmail.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
                     console.log(`[ProductCreate] Page ${pageId} is owned by ME (${viewerEmail}). Forcing Personal Context for Creation.`);
                     // Return the ID associated with my email (Personal ID)
                     const userRes = await pgClient.query('SELECT id FROM users WHERE email = $1', [viewerEmail]);
                     if (userRes.rows.length > 0) {
                         return userRes.rows[0].id;
                     }
                 }
             }
         } catch (e) {
             console.error("[ProductCreate] Page Owner Check Failed:", e);
         }
    }

    // If we are in a Team Context, return the Team Owner's ID immediately.
    // This prevents products from being attached to the "Page Owner" (which might be the member)
    // when they should belong to the Team Owner.
    if (isTeamMember) {
        console.log(`[ProductOwner] Team Context Active. Assigning to Team Owner: ${effectiveUserId}`);
        return effectiveUserId;
    }

    // 2. Fallback: Check Page Owner (Legacy / Personal Context)
    // If NOT in a Team Context, and a page is selected, we assign to that Page's Owner.
    if (pageId) {
        const pid = String(pageId);
        const pgClient = require('../services/pgClient');

        const pageRes = await pgClient.query(
            'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL LIMIT 1',
            [pid]
        );

        if (pageRes.rows.length > 0 && pageRes.rows[0].user_id) {
            const pageOwnerId = pageRes.rows[0].user_id;
            const pageOwnerEmail = pageRes.rows[0].email;

            // FIX: If Page Owner is a MEMBER of the current effective user (who is the Team Owner),
            // then we should still assign the product to the Team Owner (Me).
            // This handles the case where an Owner creates a product for a page connected by a Member.
            if (pageOwnerId !== effectiveUserId) {
                try {
                    // Get Current User Email
                    const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1::uuid', [effectiveUserId]);
                    if (userRes.rows.length > 0) {
                        const currentUserEmail = userRes.rows[0].email;
                        
                        // Check 1: Is Current User a MEMBER of Page Owner's Team? (Member adding to Owner's Page)
                        // Here currentUserEmail is the "Me" (the one making the request)
                        // If "Me" is a member, and Page Owner is the "Owner", then we check:
                        // owner_email = pageOwnerEmail (Owner)
                        // member_email = currentUserEmail (Me)
                        const teamCheck = await pgClient.query(
                            'SELECT 1 FROM team_members WHERE LOWER(owner_email) = LOWER($1) AND LOWER(member_email) = LOWER($2) AND status = $3',
                            [pageOwnerEmail, currentUserEmail, 'active']
                        );
                        if (teamCheck.rows.length > 0) {
                            console.log(`[ProductOwner] Page ${pid} belongs to My Team Owner ${pageOwnerEmail}. Assigning to Page Owner: ${pageOwnerId}`);
                            return pageOwnerId;
                        }

                        // Check 2: Is Page Owner a MEMBER of Current User's Team? (Owner adding to Member's Page)
                        // Here "Me" is the Owner. Page Owner is the Member.
                        // owner_email = currentUserEmail (Me)
                        // member_email = pageOwnerEmail (Member)
                        const reverseTeamCheck = await pgClient.query(
                            'SELECT 1 FROM team_members WHERE LOWER(owner_email) = LOWER($1) AND LOWER(member_email) = LOWER($2) AND status = $3',
                            [currentUserEmail, pageOwnerEmail, 'active']
                        );
                        if (reverseTeamCheck.rows.length > 0) {
                            console.log(`[ProductOwner] Page ${pid} is owned by my Team Member ${pageOwnerEmail}. Assigning to Me (Team Owner): ${effectiveUserId}`);
                            return effectiveUserId;
                        }
                    }
                } catch (err) {
                    console.error("[ProductOwner] Team check failed:", err);
                }
            }

            return pageOwnerId;
        }

        const waRes = await pgClient.query(
            'SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 AND user_id IS NOT NULL LIMIT 1',
            [pid]
        );

        if (waRes.rows.length > 0 && waRes.rows[0].user_id) {
            // Same check for WhatsApp? Assuming WhatsApp session ownership follows similar rules.
            // For now, let's just return user_id, but ideally we should apply the same logic.
            // But since WA sessions are less likely to be "personal" in this context, we'll stick to basic return for now
            // or apply the same fix if needed. Let's apply it for consistency.
            const waOwnerId = waRes.rows[0].user_id;
             if (waOwnerId !== effectiveUserId) {
                try {
                     const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1::uuid', [effectiveUserId]);
                     if (userRes.rows.length > 0) {
                         const currentUserEmail = userRes.rows[0].email;
                         // Need email for WA owner. whatsapp_message_database has 'email' column? Yes.
                         // But we didn't select it.
                         const waFullRes = await pgClient.query('SELECT email FROM whatsapp_message_database WHERE session_name = $1', [pid]);
                         if (waFullRes.rows.length > 0) {
                             const waOwnerEmail = waFullRes.rows[0].email;
                             const teamCheck = await pgClient.query(
                                 'SELECT 1 FROM team_members WHERE LOWER(owner_email) = LOWER($1) AND LOWER(member_email) = LOWER($2)',
                                 [currentUserEmail, waOwnerEmail]
                             );
                             if (teamCheck.rows.length > 0) {
                                  console.log(`[ProductOwner] WA Session ${pid} belongs to team member. Assigning to Team Owner (Me): ${effectiveUserId}`);
                                 return effectiveUserId;
                             }
                         }
                     }
                } catch (err) { console.error(err); }
             }
            return waOwnerId;
        }
    }

    // 3. Fallback to Effective User (Personal)
    return effectiveUserId;
}

exports.checkStatus = async (req, res) => {
    try {
        const baseUserId = req.query.user_id || null;
        let effectiveUserId = null;
        
        try {
            const result = await getEffectiveUserIdFromRequest(req, baseUserId);
            effectiveUserId = result.effectiveUserId;
        } catch (authError) {
            console.error("Auth Error in checkStatus:", authError.message);
            // Don't fail hard, just treat as no user
            effectiveUserId = null;
        }

        if (!effectiveUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const hasAccess = await dbService.checkProductFeatureAccess(effectiveUserId);
        res.json({ locked: !hasAccess });
    } catch (error) {
        console.error("Check Status Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.createProduct = async (req, res) => {
    try {
        console.log("[ProductCreate] Request received. Body keys:", Object.keys(req.body));
        if (req.body.metadata) console.log("[ProductCreate] Raw Metadata Length:", req.body.metadata.length);
        
        // --- RESILIENT PARSING: Check Metadata and Individual Fields ---
        let rawMetadata = {};
        if (req.body.metadata) {
            try {
                rawMetadata = JSON.parse(req.body.metadata);
                console.log("[ProductCreate] Metadata parsed successfully.");
            } catch (e) {
                console.error("[ProductCreate] Metadata JSON parse failed:", e.message);
            }
        }

        // Merge metadata into req.body but prioritize metadata for key fields
        const body = { ...req.body, ...rawMetadata };
        
        const legacyIds = body.allowed_page_ids ? (Array.isArray(body.allowed_page_ids) ? body.allowed_page_ids : (() => { try { return JSON.parse(body.allowed_page_ids); } catch { return [body.allowed_page_ids]; } })()) : [];
        
        const baseUserId = body.user_id || null;
        const pageId = body.page_id || null;
        
        console.log(`[ProductCreate] Resolved baseUserId: ${baseUserId}, pageId: ${pageId}`);

        // Use resolveProductOwnerUserId to ensure products are always attached to the OWNER
        const userId = await resolveProductOwnerUserId(req, baseUserId, pageId);
        console.log(`[ProductCreate] Resolved Owner ID: ${userId}`);
        
        if (!userId) return res.status(400).json({ error: "user_id is required" });

        const hasAccess = await dbService.checkProductFeatureAccess(userId);
        if (!hasAccess) {
            return res.status(403).json({ 
                error: "Feature Locked. Please purchase Cloud API credit or a WhatsApp Session to unlock Product Entry." 
            });
        }

        // 1. Handle Image Upload
        let imageUrl = null;
        let additionalImages = [];
        
        const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const reqBaseUrl = `${protocol}://${host}`;
        const baseUrl = envBaseUrl || reqBaseUrl;

        if (req.files && req.files.image && req.files.image[0]) {
            try {
                imageUrl = await imageService.uploadProductImage(req.files.image[0].buffer, req.files.image[0].mimetype, userId, baseUrl);
            } catch (imgError) {
                console.error("[ProductCreate] Image upload failed:", imgError);
            }
        }

        if (req.files && req.files.images) {
            const uploadPromises = req.files.images.map(file => 
                imageService.uploadProductImage(file.buffer, file.mimetype, userId, baseUrl)
            );
            try {
                additionalImages = await Promise.all(uploadPromises);
            } catch (imgError) {
                console.error("[ProductCreate] Additional images upload failed:", imgError);
            }
        }

        // 2. Parse Data (Resilient)
        const name = body.name;
        const description = body.description || '';
        const price = body.price ? parseFloat(body.price) : 0;
        const currency = body.currency || 'USD';
        const stock = body.stock ? parseInt(body.stock) : 0;
        const keywords = body.keywords || '';

        let variants = [];
        if (body.variants) {
            if (Array.isArray(body.variants)) {
                variants = body.variants;
            } else {
                try {
                    variants = JSON.parse(body.variants);
                } catch (e) {
                    console.error("[ProductCreate] Variants parse failed:", e.message);
                }
            }
        }
        
        const isActive = body.is_active === 'true' || body.is_active === true;

        // 3. ID Parsing
        const parseIds = (val) => {
            if (!val) return [];
            let arr = [];
            if (Array.isArray(val)) {
                arr = val;
            } else if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (Array.isArray(parsed)) arr = parsed;
                    else arr = [val];
                } catch (e) {
                    if (val.includes(',')) arr = val.split(',');
                    else arr = [val];
                }
            } else {
                arr = [val];
            }

            return arr
                .map(id => {
                    if (!id) return null;
                    if (typeof id === 'object') return String(id.id || id.page_id || id.name || "").trim();
                    return String(id).trim();
                })
                .filter(id => id && id !== 'null' && id !== 'undefined' && id !== '[object Object]');
        };

        let allowedMessengerIds = parseIds(body.allowed_messenger_ids);
        let allowedWASessions = parseIds(body.allowed_wa_sessions);
        const legacyParsed = parseIds(legacyIds);
        if (legacyParsed.length > 0) {
            const numericIds = legacyParsed.filter(id => /^\d+$/.test(String(id)));
            const waIds = legacyParsed.filter(id => !/^\d+$/.test(String(id)));
            allowedMessengerIds = Array.from(new Set([...allowedMessengerIds, ...numericIds]));
            allowedWASessions = Array.from(new Set([...allowedWASessions, ...waIds]));
        }

        const platform = (allowedMessengerIds.length === 0 && allowedWASessions.length === 0) ? 'global' : 'restricted';
        console.log("[ProductCreate] Final Assignments:", { messenger: allowedMessengerIds, wa: allowedWASessions, platform });

        if (!name) return res.status(400).json({ error: "Product name is required" });

        // 4. Save to DB
        const product = await dbService.createProduct({
            user_id: userId,
            name,
            description,
            image_url: imageUrl,
            additional_images: additionalImages,
            variants: variants,
            is_active: isActive,
            price,
            currency,
            stock,
            allowed_messenger_ids: allowedMessengerIds,
            allowed_wa_sessions: allowedWASessions,
            platform,
            keywords,
            is_combo: body.is_combo === 'true' || body.is_combo === true,
            combo_items: Array.isArray(body.combo_items) ? body.combo_items : (body.combo_items ? JSON.parse(body.combo_items) : []),
            allow_description: body.allow_description === 'true' || body.allow_description === true
        });

        res.status(201).json(product);

    } catch (error) {
        console.error("Create Product Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getProducts = async (req, res) => {
    try {
        const pageId = req.query?.page_id || null;
        const baseUserId = req.query.user_id || null;
        
        console.log(`[ProductGet] Incoming Request: Page=${pageId}, User=${baseUserId}, TeamOwner=${req.query?.team_owner}`);
        
        // 1. Resolve Effective User (Handles Team Context)
        // Moved UP to ensure we know who is asking before determining target
        let { effectiveUserId, isTeamMember, viewerEmail, teamOwnerEmail } = await getEffectiveUserIdFromRequest(req, baseUserId);

        // EXTRA SAFETY FIX: If I am the Page Owner (Messenger) or Session Owner (WhatsApp), I MUST see my own products.
        if (pageId && viewerEmail) {
             try {
                 const pgClient = require('../services/pgClient');
                 
                 // 1. Check Messenger
                 const pageRes = await pgClient.query(
                    'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1',
                    [String(pageId)]
                 );
                 
                 let isOwner = false;
                 let ownerId = null;

                 if (pageRes.rows.length > 0) {
                     const pageOwnerEmail = pageRes.rows[0].email;
                     ownerId = pageRes.rows[0].user_id;
                     if (pageOwnerEmail && viewerEmail && pageOwnerEmail.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
                         isOwner = true;
                     }
                 } else {
                     // 2. Check WhatsApp
                     const waRes = await pgClient.query(
                        'SELECT user_id, email FROM whatsapp_message_database WHERE session_name = $1',
                        [String(pageId)]
                     );
                     if (waRes.rows.length > 0) {
                         const waOwnerEmail = waRes.rows[0].email;
                         ownerId = waRes.rows[0].user_id;
                         if (waOwnerEmail && viewerEmail && waOwnerEmail.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
                             isOwner = true;
                         }
                     }
                 }
                 
                 if (isOwner && ownerId) {
                     console.log(`[ProductGet] Resource ${pageId} is owned by ME (${viewerEmail}). Forcing Personal Context.`);
                     effectiveUserId = ownerId;
                     isTeamMember = false;
                 }
             } catch (e) {
                 console.error("[ProductGet] Resource Owner Check Failed:", e);
             }
        }
        
        let targetUserId = effectiveUserId;
        console.log(`[ProductFetch] Initial EffectiveUser: ${effectiveUserId}, IsTeam: ${isTeamMember}, Email: ${viewerEmail}`);

        // 2. Determine Target User (Owner vs Page Owner)
        // Logic: 
        // - If Team Member, always use Team Owner (effectiveUserId).
        // - If Page is owned by Team Owner, use Team Owner.
        // - If Page is owned by a Member of the Team Owner, use Team Owner (Single Owner Policy).
        // - Only switch to Page Owner if it's a legacy shared page unrelated to the team.
        
        // BUG FIX: If we already forced Personal Context (isTeamMember=false) because I am Owner,
        // we should NOT switch context again even if pageOwnerId logic triggers below.
        // However, if pageId is present, the logic below checks pageOwnerId !== effectiveUserId.
        // If I am Owner, pageOwnerId == effectiveUserId. So it skips.
        // BUT if pageOwnerId is NULL in DB (legacy), it might trigger?
        // Let's add explicit check.
        
        if (pageId && !isTeamMember) {
            const pgClient = require('../services/pgClient');
            
            // 1. Check Messenger Pages
            let pageRes = await pgClient.query(
                'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL LIMIT 1',
                [pageId]
            );

            if (pageRes.rows.length > 0) {
                const pageOwnerId = pageRes.rows[0].user_id;
                const pageOwnerEmail = pageRes.rows[0].email;

                // If Page Owner is DIFFERENT from Current User
                if (pageOwnerId !== effectiveUserId) {
                    // Safety: If I am the Page Owner (by email match), force stay on my ID
                    if (pageOwnerEmail && viewerEmail && pageOwnerEmail.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
                         console.log(`[ProductFetch] Email match override for Page Owner. Keeping context.`);
                         targetUserId = effectiveUserId;
                    } else {
                        // Check if Page Owner is a MEMBER of Current User (Team Owner)
                        let isMyMember = false;

                        try {
                            // Get Current User Email
                            const userRes = await pgClient.query('SELECT email FROM users WHERE id = $1', [effectiveUserId]);
                            if (userRes.rows.length > 0) {
                                const currentUserEmail = userRes.rows[0].email;
                                const teamCheck = await pgClient.query(
                                    'SELECT 1 FROM team_members WHERE LOWER(owner_email) = LOWER($1) AND LOWER(member_email) = LOWER($2)',
                                    [currentUserEmail, pageOwnerEmail]
                                );
                                if (teamCheck.rows.length > 0) {
                                    isMyMember = true;
                                }
                            }
                        } catch (err) {
                            console.error("[ProductFetch] Team check failed:", err);
                        }

                        if (isMyMember) {
                            console.log(`[ProductFetch] Page ${pageId} belongs to team member ${pageOwnerEmail}. Keeping Owner Context: ${effectiveUserId}`);
                            targetUserId = effectiveUserId;
                        } else {
                            console.log(`[ProductFetch] Page ${pageId} belongs to external user ${pageOwnerEmail}. Switching context.`);
                            targetUserId = pageOwnerId;
                        }
                    }
                }
            } else {
                // 2. Check WhatsApp Sessions (Fallback if not found in Messenger)
                const waRes = await pgClient.query(
                    'SELECT user_id, email FROM whatsapp_message_database WHERE session_name = $1 AND user_id IS NOT NULL LIMIT 1',
                    [pageId]
                );
                if (waRes.rows.length > 0) {
                    const waOwnerId = waRes.rows[0].user_id;
                    const waOwnerEmail = waRes.rows[0].email;

                    if (waOwnerId !== effectiveUserId) {
                        // Safety: Email match override
                        if (waOwnerEmail && viewerEmail && waOwnerEmail.trim().toLowerCase() === viewerEmail.trim().toLowerCase()) {
                             console.log(`[ProductFetch] Email match override for WhatsApp Owner. Keeping context.`);
                             targetUserId = effectiveUserId;
                        } else {
                             console.log(`[ProductFetch] WhatsApp session match for targetUserId: ${waOwnerId}`);
                             targetUserId = waOwnerId;
                        }
                    }
                }
            }
        }

        if (!targetUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || null;

        // 2. Permission Check for Team Members
        let allowedPageIds = null; // null means "all pages" (for Owner)
        
        if (isTeamMember && viewerEmail) {
            const requestedTeamOwner = req.query?.team_owner || req.headers['x-team-owner'] || teamOwnerEmail;
            
            if (requestedTeamOwner) {
                const pgClient = require('../services/pgClient');
                // Fetch permissions for this member SPECIFIC to the requested team
                const teamRes = await pgClient.query(
                    'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                    [viewerEmail, requestedTeamOwner, 'active']
                );

                let teamPages = [];
                if (teamRes.rows.length > 0) {
                    teamRes.rows.forEach(row => {
                        const perms = row.permissions || {};
                        if (Array.isArray(perms.fb_pages)) {
                            teamPages.push(...perms.fb_pages);
                        }
                        if (Array.isArray(perms.wa_sessions)) {
                            teamPages.push(...perms.wa_sessions);
                        }
                    });
                }
                
                // ALSO Fetch Personal Pages owned by the member themselves
                let personalPages = [];
                try {
                     const userRes = await pgClient.query('SELECT id FROM users WHERE email = $1', [viewerEmail]);
                     if (userRes.rows.length > 0) {
                         const viewerUserId = userRes.rows[0].id;
                         const personalPagesRes = await pgClient.query('SELECT page_id FROM page_access_token_message WHERE user_id = $1::uuid', [viewerUserId]);
                         personalPages = personalPagesRes.rows.map(r => r.page_id);
                     }
                } catch (err) {
                    console.error("[ProductFetch] Failed to fetch personal pages:", err);
                }

                // Combine all allowed resource IDs
                allowedPageIds = [...new Set([...teamPages, ...personalPages])];
                allowedPageIds = allowedPageIds.map(String);
                
                console.log(`[ProductFetch] Allowed Pages for ${viewerEmail}: ${allowedPageIds.length}`);
            }
        }

        // 3. Fetch Products (Pass allowedPageIds to filter)
        console.log(`[ProductFetch] Final Call: User=${targetUserId}, Page=${pageId}, AllowedCount=${allowedPageIds ? allowedPageIds.length : 'null'}`);
        const result = await dbService.getProducts(targetUserId, page, limit, search, pageId, allowedPageIds);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;

        // --- NEW METHOD SUPPORT: Parse Metadata JSON if present ---
        if (req.body.metadata) {
            try {
                const metadata = JSON.parse(req.body.metadata);
                // Merge metadata into req.body to maintain compatibility with existing code
                Object.assign(req.body, metadata);
            } catch (e) {
                console.error("[ProductUpdate] Failed to parse metadata JSON:", e.message);
            }
        }

        const baseUserId = req.body.user_id || null;
        const pageId = req.body?.page_id || null;
        const userId = await resolveProductOwnerUserId(req, baseUserId, pageId);
        if (!userId) return res.status(400).json({ error: "user_id is required for verification" });
        console.log(`[ProductUpdate] ID: ${id}, Owner: ${userId}, Page: ${pageId}`);

        // 1. Handle Image Upload if present
        let imageUrl = undefined; // undefined means no change
        if (req.file) {
            try {
                // VPS FIX: Prefer PUBLIC_BASE_URL from env, then BACKEND_URL, then construct from request
                const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL;
                
                // Construct reliable request-based URL (handling proxies)
                const protocol = req.headers['x-forwarded-proto'] || req.protocol;
                const host = req.get('host');
                const reqBaseUrl = `${protocol}://${host}`;
                
                const baseUrl = envBaseUrl || reqBaseUrl;
                
                console.log(`[ProductUpdate] Uploading for Effective User (Owner): ${userId}`);
                imageUrl = await imageService.uploadProductImage(req.file.buffer, req.file.mimetype, userId, baseUrl);
            } catch (imgError) {
                return res.status(500).json({ error: "Image upload failed: " + imgError.message });
            }
        }

        // 2. Parse Body
        const updates = {};
        if (req.body.name) updates.name = req.body.name;
        if (req.body.description !== undefined) updates.description = req.body.description;
        if (req.body.price) updates.price = parseFloat(req.body.price);
        if (req.body.currency) updates.currency = req.body.currency;
        if (req.body.stock) updates.stock = parseInt(req.body.stock);
        if (req.body.keywords !== undefined) updates.keywords = req.body.keywords;
        if (req.body.is_active) updates.is_active = req.body.is_active === 'true' || req.body.is_active === true;
        if (imageUrl) updates.image_url = imageUrl;
        if (req.body.is_combo !== undefined) updates.is_combo = req.body.is_combo === 'true' || req.body.is_combo === true;
        if (req.body.allow_description !== undefined) updates.allow_description = req.body.allow_description === 'true' || req.body.allow_description === true;
        if (req.body.combo_items !== undefined) updates.combo_items = req.body.combo_items;

        if (req.body.variants !== undefined) {
            if (Array.isArray(req.body.variants)) {
                updates.variants = req.body.variants;
            } else {
                try {
                    updates.variants = JSON.parse(req.body.variants);
                } catch (e) {
                    return res.status(400).json({ error: "Invalid variants JSON format" });
                }
            }
        }

        const parseIds = (val) => {
            if (!val) return [];
            let arr = [];
            if (Array.isArray(val)) {
                arr = val;
            } else if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (Array.isArray(parsed)) arr = parsed;
                    else arr = [val];
                } catch (e) {
                    if (val.includes(',')) arr = val.split(',');
                    else arr = [val];
                }
            } else {
                arr = [val];
            }
            return arr
                .map(id => {
                    if (!id) return null;
                    if (typeof id === 'object') return String(id.id || id.page_id || id.name || "");
                    return String(id);
                })
                .filter(id => id && id !== 'null' && id !== 'undefined' && id !== '[object Object]');
        };

        let allowedMessengerIds = parseIds(req.body.allowed_messenger_ids);
        let allowedWASessions = parseIds(req.body.allowed_wa_sessions);
        const legacyIds = parseIds(req.body.allowed_page_ids);
        if (legacyIds.length > 0) {
            const numericIds = legacyIds.filter(id => /^\d+$/.test(String(id)));
            const waIds = legacyIds.filter(id => !/^\d+$/.test(String(id)));
            allowedMessengerIds = Array.from(new Set([...allowedMessengerIds, ...numericIds]));
            allowedWASessions = Array.from(new Set([...allowedWASessions, ...waIds]));
        }

        const platform = (allowedMessengerIds.length === 0 && allowedWASessions.length === 0) ? 'global' : 'restricted';
        console.log("[ProductUpdateDebug] Parsed IDs:", { allowedMessengerIds, allowedWASessions, platform });

        if (allowedMessengerIds.length > 0) {
            updates.allowed_messenger_ids = allowedMessengerIds;
        } else if (req.body.allowed_messenger_ids !== undefined) {
            updates.allowed_messenger_ids = [];
        }

        if (allowedWASessions.length > 0) {
            updates.allowed_wa_sessions = allowedWASessions;
        } else if (req.body.allowed_wa_sessions !== undefined) {
            updates.allowed_wa_sessions = [];
        }
        updates.platform = platform;

        const existing = await dbService.getProductById(id);
        if (existing && updates.allowed_messenger_ids === undefined && updates.allowed_wa_sessions === undefined && updates.platform === 'global') {
            updates.platform = existing.platform || 'restricted';
        }

        const updated = await dbService.updateProduct(id, userId, updates);
        res.json(updated);

    } catch (error) {
        console.error("Update Product Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const baseUserId = (req.body && req.body.user_id)
            ? req.body.user_id
            : (req.query && req.query.user_id ? req.query.user_id : null);
        const pageId = (req.body && req.body.page_id)
            ? req.body.page_id
            : (req.query && req.query.page_id ? req.query.page_id : null);
        const userId = await resolveProductOwnerUserId(req, baseUserId, pageId);
        if (!userId) return res.status(400).json({ error: "user_id is required for verification" });

        if (pageId) {
            const existing = await dbService.getProductById(id);
            if (!existing) return res.status(404).json({ error: "Product not found" });
            const isMessenger = /^\d+$/.test(String(pageId));
            const messengerIds = Array.isArray(existing.allowed_messenger_ids) ? existing.allowed_messenger_ids : (() => { try { return JSON.parse(existing.allowed_messenger_ids || '[]'); } catch { return []; } })();
            const waSessions = Array.isArray(existing.allowed_wa_sessions) ? existing.allowed_wa_sessions : (() => { try { return JSON.parse(existing.allowed_wa_sessions || '[]'); } catch { return []; } })();
            const newMessenger = isMessenger ? messengerIds.filter(x => String(x) !== String(pageId)) : messengerIds;
            const newWA = !isMessenger ? waSessions.filter(x => String(x) !== String(pageId)) : waSessions;
            if (newMessenger.length === 0 && newWA.length === 0) {
                await dbService.deleteProduct(id, userId);
                return res.json({ success: true, message: "Product deleted" });
            } else {
                const platform = 'restricted';
                const updated = await dbService.updateProduct(id, userId, {
                    allowed_messenger_ids: newMessenger,
                    allowed_wa_sessions: newWA,
                    platform
                });
                return res.json({ success: true, message: "Unassigned from current page/session", data: updated });
            }
        } else {
            await dbService.deleteProduct(id, userId);
            return res.json({ success: true, message: "Product deleted" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.importWooCommerce = async (req, res) => {
    const { userId, url, consumerKey, consumerSecret } = req.body;

    if (!url || !consumerKey || !consumerSecret) {
        return res.status(400).json({ error: "Missing credentials" });
    }

    try {
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, userId || null);
        if (!effectiveUserId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const result = await woocommerceService.importProducts(effectiveUserId, url, consumerKey, consumerSecret);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
