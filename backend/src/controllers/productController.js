const multer = require('multer');
const dbService = require('../services/dbService');
const woocommerceService = require('../services/woocommerceService');
const imageService = require('../services/imageService');

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

exports.uploadMiddleware = upload.single('image');

async function getEffectiveUserIdFromRequest(req, baseUserId) {
    let userId = baseUserId || null;
    let viewerEmail = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET;
        const payload = jwt.verify(token, secret);
        userId = payload.sub || baseUserId || null;
        viewerEmail = payload.email || null;
    }

    if (!userId) {
        return { effectiveUserId: null };
    }

    let effectiveUserId = userId;

    if (viewerEmail) {
        const pgClient = require('../services/pgClient');

        const teamResult = await pgClient.query(
            'SELECT owner_email FROM team_members WHERE member_email = $1 AND status = $2',
            [viewerEmail, 'active']
        );

        if (teamResult.rows.length === 1 && teamResult.rows[0].owner_email) {
            const ownerEmail = teamResult.rows[0].owner_email;
            let ownerUserId = null;

            const pageOwnerResult = await pgClient.query(
                'SELECT user_id FROM page_access_token_message WHERE email = $1 AND user_id IS NOT NULL LIMIT 1',
                [ownerEmail]
            );

            if (pageOwnerResult.rows.length > 0 && pageOwnerResult.rows[0].user_id) {
                ownerUserId = pageOwnerResult.rows[0].user_id;
            }

            if (!ownerUserId) {
                const waOwnerResult = await pgClient.query(
                    'SELECT user_id FROM whatsapp_message_database WHERE email = $1 AND user_id IS NOT NULL LIMIT 1',
                    [ownerEmail]
                );

                if (waOwnerResult.rows.length > 0 && waOwnerResult.rows[0].user_id) {
                    ownerUserId = waOwnerResult.rows[0].user_id;
                }
            }

            if (ownerUserId) {
                effectiveUserId = ownerUserId;
            }
        }
    }

    return { effectiveUserId };
}

async function resolveProductOwnerUserId(req, baseUserId, pageId) {
    if (pageId) {
        const pid = String(pageId);
        const pgClient = require('../services/pgClient');

        const pageRes = await pgClient.query(
            'SELECT user_id FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL LIMIT 1',
            [pid]
        );

        if (pageRes.rows.length > 0 && pageRes.rows[0].user_id) {
            return pageRes.rows[0].user_id;
        }

        const waRes = await pgClient.query(
            'SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 AND user_id IS NOT NULL LIMIT 1',
            [pid]
        );

        if (waRes.rows.length > 0 && waRes.rows[0].user_id) {
            return waRes.rows[0].user_id;
        }
    }

    const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);
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
        const baseUserId = req.body.user_id || null;
        const pageId = req.body.page_id || null;
        const userId = await resolveProductOwnerUserId(req, baseUserId, pageId);
        if (!userId) return res.status(400).json({ error: "user_id is required" });

        const hasAccess = await dbService.checkProductFeatureAccess(userId);
        if (!hasAccess) {
            return res.status(403).json({ 
                error: "Feature Locked. Please purchase Cloud API credit or a WhatsApp Session to unlock Product Entry." 
            });
        }

        // 1. Handle Image Upload
        let imageUrl = null;
        if (req.file) {
            try {
                // VPS FIX: Prefer PUBLIC_BASE_URL from env, then BACKEND_URL, then construct from request
                // We pass 'undefined' to let imageService use its robust fallback logic which includes PUBLIC_BASE_URL
                const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL;
                const reqBaseUrl = `${req.protocol}://${req.get('host')}`;
                const baseUrl = envBaseUrl || reqBaseUrl;
                
                imageUrl = await imageService.uploadProductImage(req.file.buffer, req.file.mimetype, userId, baseUrl);
            } catch (imgError) {
                return res.status(500).json({ error: "Image upload failed: " + imgError.message });
            }
        }

        // 2. Parse Body
        const name = req.body.name;
        const description = req.body.description || '';
        const price = req.body.price ? parseFloat(req.body.price) : 0;
        const currency = req.body.currency || 'USD';
        const stock = req.body.stock ? parseInt(req.body.stock) : 0;
        const keywords = req.body.keywords || '';

        let variants = [];
        try {
            variants = req.body.variants ? JSON.parse(req.body.variants) : [];
        } catch (e) {
            return res.status(400).json({ error: "Invalid variants JSON format" });
        }
        
        const isActive = req.body.is_active === 'true' || req.body.is_active === true;

        let allowedPages = null;
        if (req.body.allowed_page_ids) {
            try {
                allowedPages = JSON.parse(req.body.allowed_page_ids);
            } catch (e) {
                console.error("Invalid allowed_page_ids format", e);
            }
        }

        if (!name) return res.status(400).json({ error: "Product name is required" });

        // 3. Save to DB
        // Stringify JSON fields to ensure compatibility with Postgres JSONB columns
        const product = await dbService.createProduct({
            user_id: userId,
            name,
            description,
            image_url: imageUrl,
            variants: JSON.stringify(variants),
            is_active: isActive,
            price,
            currency,
            stock,
            allowed_page_ids: allowedPages ? JSON.stringify(allowedPages) : null,
            keywords
        });

        res.status(201).json(product);

    } catch (error) {
        console.error("Create Product Error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getProducts = async (req, res) => {
    try {
        const pageId = req.query.page_id || null;
        let targetUserId = null;

        if (pageId) {
            const pgClient = require('../services/pgClient');
            const pageRes = await pgClient.query(
                'SELECT user_id FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL LIMIT 1',
                [pageId]
            );

            if (pageRes.rows.length > 0 && pageRes.rows[0].user_id) {
                targetUserId = pageRes.rows[0].user_id;
            }
        }

        if (!targetUserId) {
            const baseUserId = req.query.user_id || null;
            const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);
            targetUserId = effectiveUserId;
        }

        if (!targetUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || null;

        const result = await dbService.getProducts(targetUserId, page, limit, search, pageId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const baseUserId = req.body.user_id || null;
        const pageId = req.body.page_id || null;
        const userId = await resolveProductOwnerUserId(req, baseUserId, pageId);
        if (!userId) return res.status(400).json({ error: "user_id is required for verification" });

        // 1. Handle Image Upload if present
        let imageUrl = undefined; // undefined means no change
        if (req.file) {
            try {
                // VPS FIX: Prefer PUBLIC_BASE_URL from env
                const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL;
                const reqBaseUrl = `${req.protocol}://${req.get('host')}`;
                const baseUrl = envBaseUrl || reqBaseUrl;
                
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

        if (req.body.variants) {
            try {
                updates.variants = JSON.parse(req.body.variants);
            } catch (e) {
                return res.status(400).json({ error: "Invalid variants JSON format" });
            }
        }

        if (req.body.allowed_page_ids) {
            try {
                updates.allowed_page_ids = JSON.parse(req.body.allowed_page_ids);
            } catch (e) {
                return res.status(400).json({ error: "Invalid allowed_page_ids JSON format" });
            }
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

        await dbService.deleteProduct(id, userId);
        res.json({ success: true, message: "Product deleted" });
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
