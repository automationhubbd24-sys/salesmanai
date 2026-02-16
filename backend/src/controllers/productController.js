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
    if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await dbService.supabase.auth.getUser(token);
        if (!error && user) {
            userId = user.id;
            viewerEmail = user.email;
        }
    }

    if (!userId) {
        return { effectiveUserId: null };
    }

    let effectiveUserId = userId;

    if (viewerEmail) {
        const { data: teamData } = await dbService.supabase
            .from('team_members')
            .select('owner_email')
            .eq('member_email', viewerEmail)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();

        if (teamData && teamData.owner_email) {
            const ownerEmail = teamData.owner_email;
            let ownerUserId = null;

            const { data: pageOwner } = await dbService.supabase
                .from('page_access_token_message')
                .select('user_id')
                .eq('email', ownerEmail)
                .not('user_id', 'is', null)
                .maybeSingle();

            if (pageOwner && pageOwner.user_id) {
                ownerUserId = pageOwner.user_id;
            }

            if (!ownerUserId) {
                const { data: waOwner } = await dbService.supabase
                    .from('whatsapp_message_database')
                    .select('user_id')
                    .eq('email', ownerEmail)
                    .not('user_id', 'is', null)
                    .maybeSingle();

                if (waOwner && waOwner.user_id) {
                    ownerUserId = waOwner.user_id;
                }
            }

            if (ownerUserId) {
                effectiveUserId = ownerUserId;
            }
        }
    }

    return { effectiveUserId };
}

exports.checkStatus = async (req, res) => {
    try {
        const baseUserId = req.query.user_id || null;
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);

        if (!effectiveUserId) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const hasAccess = await dbService.checkProductFeatureAccess(effectiveUserId);
        res.json({ locked: !hasAccess });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createProduct = async (req, res) => {
    try {
        const baseUserId = req.body.user_id || null;
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);
        if (!effectiveUserId) return res.status(400).json({ error: "user_id is required" });

        const userId = effectiveUserId;

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
                imageUrl = await imageService.uploadProductImage(req.file.buffer, req.file.mimetype, userId);
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
        const product = await dbService.createProduct({
            user_id: userId,
            name,
            description,
            image_url: imageUrl,
            variants,
            is_active: isActive,
            price,
            currency,
            stock,
            allowed_page_ids: allowedPages
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
            const { data: pageRow } = await dbService.supabase
                .from('page_access_token_message')
                .select('user_id')
                .eq('page_id', pageId)
                .not('user_id', 'is', null)
                .maybeSingle();

            if (pageRow && pageRow.user_id) {
                targetUserId = pageRow.user_id;
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
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);
        
        if (!effectiveUserId) return res.status(400).json({ error: "user_id is required for verification" });

        const userId = effectiveUserId;

        // 1. Handle Image Upload if present
        let imageUrl = undefined; // undefined means no change
        if (req.file) {
            try {
                imageUrl = await imageService.uploadProductImage(req.file.buffer, req.file.mimetype, userId);
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
        const baseUserId = (req.body && req.body.user_id) ? req.body.user_id : null;
        const { effectiveUserId } = await getEffectiveUserIdFromRequest(req, baseUserId);
        
        if (!effectiveUserId) return res.status(400).json({ error: "user_id is required for verification" });

        await dbService.deleteProduct(id, effectiveUserId);
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
