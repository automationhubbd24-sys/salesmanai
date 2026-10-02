const shopifyService = require('../services/shopifyService');

function handleError(res, error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Shopify request failed' });
}

exports.connect = (req, res) => {
    try {
        const shop = shopifyService.normalizeShopDomain(req.query.shop || req.body?.shop);
        if (!shop) return res.status(400).json({ error: 'Enter a valid shop domain such as your-store.myshopify.com.' });
        const state = shopifyService.signState(req.user.id, shop);
        res.json({ url: shopifyService.oauthUrl(shop, state) });
    } catch (error) { handleError(res, error); }
};

exports.callback = async (req, res) => {
    try {
        const shop = shopifyService.normalizeShopDomain(req.query.shop);
        if (!shop || !req.query.code) return res.status(400).send('Invalid Shopify callback.');
        const userId = shopifyService.verifyState(req.query.state, shop);
        const token = await shopifyService.exchangeCode(shop, req.query.code);
        await shopifyService.saveIntegration(userId, shop, token.access_token, token.scope);
        res.redirect(`${(process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '')}/dashboard/shopify?connected=1`);
    } catch (error) { res.status(error.statusCode || 400).send(error.message || 'Shopify authorization failed'); }
};

exports.status = async (req, res) => { try { res.json(await shopifyService.listProducts(req.user.id)); } catch (error) { handleError(res, error); } };
exports.sync = async (req, res) => { try { res.json(await shopifyService.syncProducts(req.user.id)); } catch (error) { handleError(res, error); } };
exports.disconnect = async (req, res) => { try { await require('../services/pgClient').query('DELETE FROM shopify_integrations WHERE user_id=$1', [req.user.id]); res.json({ success: true }); } catch (error) { handleError(res, error); } };
