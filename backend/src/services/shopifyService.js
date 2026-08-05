const crypto = require('crypto');
const axios = require('axios');
const pgClient = require('./pgClient');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';

function configurationError() {
    const error = new Error('Shopify integration is not configured. Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_ENCRYPTION_KEY, SHOPIFY_APP_URL, and SHOPIFY_REDIRECT_URI.');
    error.statusCode = 503;
    return error;
}

function requireConfig() {
    if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.SHOPIFY_APP_URL || !process.env.SHOPIFY_REDIRECT_URI || !process.env.SHOPIFY_ENCRYPTION_KEY) {
        throw configurationError();
    }
    const key = Buffer.from(process.env.SHOPIFY_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) {
        const error = new Error('SHOPIFY_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
        error.statusCode = 503;
        throw error;
    }
    return key;
}

function normalizeShopDomain(value) {
    const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) return null;
    return domain;
}

function encrypt(value) {
    const key = requireConfig();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(value) {
    const key = requireConfig();
    const [iv, tag, encrypted] = String(value).split('.').map(item => Buffer.from(item, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function signState(userId, shopDomain) {
    requireConfig();
    const payload = Buffer.from(JSON.stringify({ userId: String(userId), shop: shopDomain, nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyState(state, shopDomain) {
    requireConfig();
    const [payload, signature] = String(state || '').split('.');
    if (!payload || !signature) throw new Error('Invalid Shopify OAuth state');
    const expected = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(payload).digest('base64url');
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) throw new Error('Invalid Shopify OAuth state');
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('Invalid Shopify OAuth state'); }
    if (!data.userId || data.shop !== shopDomain || data.exp < Date.now()) throw new Error('Expired or mismatched Shopify OAuth state');
    return data.userId;
}

function oauthUrl(shopDomain, state) {
    const params = new URLSearchParams({ client_id: process.env.SHOPIFY_API_KEY, scope: 'read_products,read_inventory', redirect_uri: process.env.SHOPIFY_REDIRECT_URI, state });
    return `https://${shopDomain}/admin/oauth/authorize?${params}`;
}

async function exchangeCode(shopDomain, code) {
    const response = await axios.post(`https://${shopDomain}/admin/oauth/access_token`, { client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code }, { timeout: 15000 });
    return response.data;
}

async function saveIntegration(userId, shopDomain, token, scope) {
    const result = await pgClient.query(`INSERT INTO shopify_integrations (user_id, shop_domain, encrypted_access_token, scope) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, shop_domain) DO UPDATE SET encrypted_access_token=EXCLUDED.encrypted_access_token, scope=EXCLUDED.scope, connected_at=NOW() RETURNING id, shop_domain, connected_at, last_synced_at`, [userId, shopDomain, encrypt(token), scope || null]);
    return result.rows[0];
}

async function getIntegration(userId) {
    const result = await pgClient.query('SELECT id, shop_domain, encrypted_access_token, scope, connected_at, last_synced_at FROM shopify_integrations WHERE user_id=$1 ORDER BY connected_at DESC LIMIT 1', [userId]);
    return result.rows[0] || null;
}

async function graphql(integration, query, variables = {}) {
    const response = await axios.post(`https://${integration.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { query, variables }, { timeout: 20000, headers: { 'X-Shopify-Access-Token': decrypt(integration.encrypted_access_token), 'Content-Type': 'application/json' } });
    if (response.data.errors?.length) throw new Error(response.data.errors.map(error => error.message).join('; '));
    return response.data.data;
}

async function syncProducts(userId) {
    const integration = await getIntegration(userId);
    if (!integration) { const error = new Error('No Shopify store is connected.'); error.statusCode = 404; throw error; }
    const data = await graphql(integration, `query { products(first: 250) { nodes { id title handle status descriptionHtml featuredImage { url } variants(first: 100) { nodes { id title sku price inventoryQuantity inventoryItem { id } } } } } }`);
    const products = data.products.nodes;
    for (const product of products) {
        await pgClient.query(`INSERT INTO shopify_products (integration_id, shopify_product_id, title, handle, status, description, image_url, variants, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (integration_id, shopify_product_id) DO UPDATE SET title=EXCLUDED.title, handle=EXCLUDED.handle, status=EXCLUDED.status, description=EXCLUDED.description, image_url=EXCLUDED.image_url, variants=EXCLUDED.variants, synced_at=NOW()`, [integration.id, product.id, product.title, product.handle, product.status, product.descriptionHtml, product.featuredImage?.url || null, JSON.stringify(product.variants.nodes)]);
    }
    await pgClient.query('UPDATE shopify_integrations SET last_synced_at=NOW() WHERE id=$1 AND user_id=$2', [integration.id, userId]);
    return { count: products.length, products };
}

async function listProducts(userId) {
    const integration = await getIntegration(userId);
    if (!integration) return { connected: false, products: [] };
    const result = await pgClient.query('SELECT shopify_product_id, title, handle, status, description, image_url, variants, synced_at FROM shopify_products WHERE integration_id=$1 ORDER BY title', [integration.id]);
    return { connected: true, shopDomain: integration.shop_domain, connectedAt: integration.connected_at, lastSyncedAt: integration.last_synced_at, products: result.rows };
}

module.exports = { requireConfig, normalizeShopDomain, signState, verifyState, oauthUrl, exchangeCode, saveIntegration, getIntegration, syncProducts, listProducts };
