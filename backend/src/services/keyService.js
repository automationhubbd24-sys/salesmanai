const dbService = require('./dbService');

const dynamicLimits = new Map();

let keyCache = []; 
let keyCacheMap = new Map(); 
let keysByProvider = new Map();
let keysByModel = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 60 * 1000; 

const STATUS_ACTIVE = 'active';
const STATUS_DISABLED = 'disabled';
const DISABLE_DURATION_MS = 24 * 60 * 60 * 1000;

const deadKeys = new Map();
const DEFAULT_COOLDOWN = 60 * 1000; 
const KEY_MIN_GAP_MS = process.env.KEY_MIN_GAP_MS ? parseInt(process.env.KEY_MIN_GAP_MS, 10) : 900;
const KEY_MIN_GAP_JITTER_MS = process.env.KEY_MIN_GAP_JITTER_MS ? parseInt(process.env.KEY_MIN_GAP_JITTER_MS, 10) : 400;

const pendingUpdates = new Set();
const keyUsageMap = new Map(); 

const keyUsageTimestamps = new Map(); 
const keyUsageHourTimestamps = new Map(); 
const modelUsageTimestamps = new Map(); 
const modelUsageHourTimestamps = new Map(); 
const modelDailyUsage = new Map(); 

const globalKeyPointers = new Map(); 

// 4. Rate Limit Verification (STRICT MODE - Per Key)
function isKeyWithinLimits(keyData, requestedModel = null) {
    const modelToCheck = requestedModel || keyData.model;
    if (isModelLocked(modelToCheck)) return false;

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // --- 1. RPD (Requests Per Day) ---
    const rpdLimit = parseInt(keyData.rpd_limit) || 0;
    if (rpdLimit > 0) {
        if (keyData.last_date_checked !== today) {
            keyData.usage_today = 0;
            keyData.last_date_checked = today;
            pendingUpdates.add(keyData.api);
        }
        
        // Safety Fallback: If usage is somehow higher than limit, but it's a new session, allow a few more
        if ((keyData.usage_today || 0) >= rpdLimit) {
            const lastHit = keyData.last_rpd_hit_at ? new Date(keyData.last_rpd_hit_at).getTime() : 0;
            if (now - lastHit < 24 * 60 * 60 * 1000) {
                return false;
            } else {
                // Time passed! Reset.
                keyData.usage_today = 0;
                keyData.last_date_checked = today;
            }
        }
    }

    // --- 2. RPM (Requests Per Minute) ---
    const rpmLimit = parseInt(keyData.rpm_limit) || 0;
    if (rpmLimit > 0) {
        const timestamps = keyUsageTimestamps.get(keyData.api) || [];
        const oneMinuteAgo = now - 60000;
        const validTimestamps = timestamps.filter(ts => ts > oneMinuteAgo);
        
        if (validTimestamps.length >= rpmLimit) return false;
        keyUsageTimestamps.set(keyData.api, validTimestamps);
    }

    // --- 3. RPH (Requests Per Hour) ---
    const rphLimit = parseInt(keyData.rph_limit) || 0;
    if (rphLimit > 0) {
        const hourTimestamps = keyUsageHourTimestamps.get(keyData.api) || [];
        const oneHourAgo = now - 3600000;
        const validHourTimestamps = hourTimestamps.filter(ts => ts > oneHourAgo);
        
        if (validHourTimestamps.length >= rphLimit) return false;
        keyUsageHourTimestamps.set(keyData.api, validHourTimestamps);
    }

    return true;
}

// 5. Smart Key Selection (STRICT SEQUENTIAL ROTATION)
async function getSmartKey(provider, model = 'default') {
    if (typeof updateKeyCache === 'function') {
        await updateKeyCache();
    }
    
    if (isModelLocked(model)) return null;

    // --- NEW: ROBUST PROVIDER MATCHING ---
    const targetProvider = String(provider || '').trim().toLowerCase();
    const targetModel = String(model || 'default').trim().toLowerCase();

    let candidates = [];
    
    // 1. Try Model Specific Keys First
    if (targetModel !== 'default' && keysByModel.has(targetModel)) {
        candidates = keysByModel.get(targetModel);
    } 
    
    // 2. If no model-specific keys, try Provider keys
    if (candidates.length === 0) {
        const providerAliases = {
            'google': ['google', 'gemini'],
            'gemini': ['google', 'gemini'],
            'groq': ['groq'],
            'openrouter': ['openrouter', 'or']
        };

        const searchTerms = providerAliases[targetProvider] || [targetProvider];
        for (const term of searchTerms) {
            if (keysByProvider.has(term)) {
                candidates = [...candidates, ...keysByProvider.get(term)];
            }
        }
    }
    
    // 3. Last resort: If still no candidates, use ALL active keys (Safety Fallback)
    if (candidates.length === 0 && keyCache.length > 0) {
        // Filter keys by provider if possible, otherwise use all
        candidates = keyCache.filter(k => {
            const p = String(k.provider || '').trim().toLowerCase();
            return p === 'google' || p === 'gemini' || targetProvider === 'google' || targetProvider === 'gemini';
        });
        
        // If still empty, use all active keys
        if (candidates.length === 0) candidates = keyCache;
    }

    const validKeys = candidates.filter(k => k.status === 'active' && isKeyAlive(k.api));
    
    if (validKeys.length === 0) {
        console.warn(`[KeyService] ❌ No active/alive keys found. Candidates: ${candidates.length}, Global Cache: ${keyCache.length}`);
        return null;
    }

    // Sort keys by ID to ensure consistent order (1, 2, 3...)
    validKeys.sort((a, b) => a.id - b.id);

    const mapKey = `${provider}:${model}`;
    let currentIndex = globalKeyPointers.get(mapKey) || 0;
    if (currentIndex >= validKeys.length) currentIndex = 0;

    const now = Date.now();

    for (let i = 0; i < validKeys.length; i++) {
        const actualIndex = (currentIndex + i) % validKeys.length;
        const candidateKey = validKeys[actualIndex];

        if (isKeyWithinLimits(candidateKey, model)) {
            globalKeyPointers.set(mapKey, (actualIndex + 1) % validKeys.length);

            const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
            tsList.push(now);
            keyUsageTimestamps.set(candidateKey.api, tsList);

            const hourList = keyUsageHourTimestamps.get(candidateKey.api) || [];
            hourList.push(now);
            keyUsageHourTimestamps.set(candidateKey.api, hourList);

            const today = new Date().toISOString().split('T')[0];
            if (candidateKey.last_date_checked === today) {
                candidateKey.usage_today = (candidateKey.usage_today || 0) + 1;
            } else {
                candidateKey.last_date_checked = today;
                candidateKey.usage_today = 1;
            }
            candidateKey.last_used_at = new Date().toISOString();

            pendingUpdates.add(candidateKey.api);
            
            return {
                key: candidateKey.api,
                provider: candidateKey.provider,
                model: candidateKey.model || model
            };
        }
    }

    console.warn(`[KeyService] ⚠️ All ${validKeys.length} keys exhausted (Rate Limited) for ${provider}/${model}`);
    return null;
}

// --- 3. KEY CACHE MANAGEMENT ---
async function updateKeyCache(force = false) {
    const now = Date.now();
    // Refresh cache ONLY if forced or empty. CACHE_TTL should be respected.
    if (!force && keyCache.length > 0 && (now - lastCacheUpdate < CACHE_TTL)) {
        return;
    }

    try {
        const pgClient = require('./pgClient');
        const result = await pgClient.query("SELECT * FROM api_list WHERE status = 'active' ORDER BY id ASC");
        const rows = result.rows || [];
        keyCache = rows;
        
        console.log(`[KeyService] 🔄 Cache updated from DB. Total keys: ${rows.length}`);
        
        const newMap = new Map();
        const providerMap = new Map();
        const modelMap = new Map();

        rows.forEach(k => {
            newMap.set(k.api, k);
            
            // Normalize Provider (Trim spaces and lowercase)
            const p = String(k.provider || 'unknown').trim().toLowerCase();
            if (!providerMap.has(p)) providerMap.set(p, []);
            providerMap.get(p).push(k);
            
            // Map common aliases
            if (p === 'google' || p === 'gemini') {
                if (!providerMap.has('google')) providerMap.set('google', []);
                if (!providerMap.has('gemini')) providerMap.set('gemini', []);
                providerMap.get('google').push(k);
                providerMap.get('gemini').push(k);
            }

            if (k.model) {
                const m = String(k.model).trim().toLowerCase();
                if (!modelMap.has(m)) modelMap.set(m, []);
                modelMap.get(m).push(k);
            }
        });

        keyCacheMap = newMap;
        keysByProvider = providerMap;
        keysByModel = modelMap;
        lastCacheUpdate = now;
        
        // Debug: Log providers found
        console.log(`[KeyService] Providers in cache: ${Array.from(providerMap.keys()).join(', ')}`);
    } catch (err) {
        console.error(`[KeyService] Failed to update key cache:`, err.message);
    }
}

setInterval(flushUsageStats, 30 * 1000);

const DEFAULT_LIMITS = {
    'gemini-2.5-flash': { rpm: 5, rpd: 20 }, 
    'gemini-2.5-flash-lite': { rpm: 5, rpd: 20 }, 
    'llama-3.3-70b-versatile': { rpm: 30, rpd: 1000 }, 
    'openrouter/default': { rpm: 1000, rpd: 10000 },
    'default': { rpm: 100, rpd: 10000 }
};

const modelLockMap = new Map(); 
const keyLockState = new Map(); 

function report429(modelName, apiKey = null) {
    const now = Date.now();
    if (apiKey) {
        const state = keyLockState.get(apiKey) || { strikes: 0, last_429: 0 };
        if (now - state.last_429 > 3600000) state.strikes = 0;
        state.strikes = (state.strikes || 0) + 1;
        const duration = state.strikes === 1 ? 120000 : 86400000;
        markKeyAsDead(apiKey, duration, `429_hit_${state.strikes}`);
        state.last_429 = now;
        keyLockState.set(apiKey, state);
        return;
    }
    if (!modelName) return;
    const state = modelLockMap.get(modelName) || { expiry: 0, strikes: 0 };
    state.strikes = (state.strikes || 0) + 1;
    state.expiry = now + (state.strikes === 1 ? 120000 : 86400000);
    modelLockMap.set(modelName, state);
}

function isModelLocked(modelName) {
    if (!modelName) return false;
    const state = modelLockMap.get(modelName);
    if (!state) return false;
    if (Date.now() > state.expiry) {
        modelLockMap.delete(modelName);
        return false;
    }
    return true;
}

function markKeyAsDead(keyOrObj, duration = 60000, reason = 'unknown') {
    const key = typeof keyOrObj === 'object' ? keyOrObj.api : keyOrObj;
    if (!key) return;
    deadKeys.set(key, { expiry: Date.now() + duration, reason });
}

function markKeyAsSuspended(key, reason = 'suspended') {
    if (!key) return;
    const cachedKey = keyCacheMap.get(key);
    if (cachedKey) {
        cachedKey.status = 'suspended';
        cachedKey.last_used_at = new Date().toISOString();
        pendingUpdates.add(key);
    }
}

function markKeyAsQuotaExceeded(key) {
    if (!key) return;
    markKeyAsDead(key, 86400000 + 3600000, 'quota_exceeded');
}

function isKeyAlive(key) {
    if (!deadKeys.has(key)) return true;
    const entry = deadKeys.get(key);
    if (Date.now() > entry.expiry) {
        deadKeys.delete(key);
        return true;
    }
    return false;
}

async function recordKeyUsage(apiKey, tokenUsage = 0) {
    if (!apiKey) return;
    const cachedKey = keyCacheMap.get(apiKey);
    if (cachedKey) {
        cachedKey.usage_tokens_today = (cachedKey.usage_tokens_today || 0) + tokenUsage;
        pendingUpdates.add(apiKey);
    }
}

async function flushUsageStats() {
    if (pendingUpdates.size === 0) return;
    const keysToUpdate = Array.from(pendingUpdates);
    pendingUpdates.clear();

    const updates = keysToUpdate.map(apiKey => {
        const cachedKey = keyCacheMap.get(apiKey);
        if (!cachedKey) return null;
        return {
            api: apiKey,
            usage_today: cachedKey.usage_today,
            usage_tokens_today: cachedKey.usage_tokens_today,
            last_date_checked: cachedKey.last_date_checked,
            last_used_at: cachedKey.last_used_at,
            last_rpd_hit_at: cachedKey.last_rpd_hit_at,
            status: cachedKey.status,
            provider: cachedKey.provider
        };
    }).filter(k => k !== null);

    if (updates.length === 0) return;

    try {
        const pgClient = require('./pgClient');
        for (const u of updates) {
            await pgClient.query(`
                INSERT INTO api_list (api, usage_today, usage_tokens_today, last_date_checked, last_used_at, last_rpd_hit_at, status, provider)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (api) DO UPDATE SET
                    usage_today = EXCLUDED.usage_today,
                    usage_tokens_today = EXCLUDED.usage_tokens_today,
                    last_date_checked = EXCLUDED.last_date_checked,
                    last_used_at = EXCLUDED.last_used_at,
                    last_rpd_hit_at = EXCLUDED.last_rpd_hit_at,
                    status = EXCLUDED.status
            `, [u.api, u.usage_today, u.usage_tokens_today, u.last_date_checked, u.last_used_at, u.last_rpd_hit_at, u.status, u.provider]);
        }
    } catch (err) {
        console.error(`[KeyService] Failed to flush stats`, err.message);
    }
}

function updateKeyStatusFromHeaders(apiKey, headers) {
    if (!apiKey || !headers) return;
    const remaining = headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
    const resetTime = headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset'] || headers['ratelimit-reset'];
    if (remaining !== undefined && parseInt(remaining) === 0) {
        let timeoutMs = 60000;
        if (resetTime) {
            const val = parseInt(resetTime);
            timeoutMs = val > 1000000000 ? val - Date.now() : val * 1000;
        }
        if (timeoutMs > 0) markKeyAsDead(apiKey, timeoutMs, 'header_limit');
    }
}

setTimeout(() => {
    updateKeyCache(true).catch(err => console.error("Initial key cache update failed:", err));
}, 2000);

module.exports = {
    getSmartKey, 
    markKeyAsDead,
    markKeyAsSuspended,
    markKeyAsQuotaExceeded,
    recordKeyUsage,
    updateKeyStatusFromHeaders,
    updateKeyCache,
    forceUpdateKeyCache: async () => updateKeyCache(true),
    flushUsageStats,
    report429, 
    isModelLocked,
    setManualLimit(modelId, limits) {
        if (!modelId || !limits) return;
        const rpm = parseInt(limits.rpm) || 0;
        const rpd = parseInt(limits.rpd) || 0;
        const rph = parseInt(limits.rph) || 0;
        console.log(`[KeyService] ⚙️ Setting Limits for ${modelId}: RPM=${rpm}, RPD=${rpd}, RPH=${rph}`);
        dynamicLimits.set(String(modelId), { rpm, rpd, rph });
    },
    getActiveRotationPool: (providerFilter = null, page = 1, limit = 10, searchQuery = '') => {
        let keys = (providerFilter && providerFilter !== 'all') ? (keysByProvider.get(providerFilter.toLowerCase()) || []) : keyCache;
        const query = String(searchQuery || '').trim().toLowerCase();
        if (query) keys = keys.filter(k => (k.provider || '').toLowerCase().includes(query) || (k.api || '').toLowerCase().includes(query));
        const total = keys.length;
        const paginated = keys.slice((page - 1) * limit, page * limit);
        return {
            total, page, limit,
            keys: paginated.map(k => ({
                id: k.id, provider: k.provider, api: k.api.substring(0, 12) + '***',
                status: k.status, usage_today: k.usage_today, last_used_at: k.last_used_at
            }))
        };
    }
};
