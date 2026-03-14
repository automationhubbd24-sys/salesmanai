const dbService = require('./dbService');

const dynamicLimits = new Map();

let keyCache = []; // Keeping for backward compatibility if needed in loops
let keyCacheMap = new Map(); // NEW: Key lookup Map (apiKey -> object) for O(1) access
let keysByProvider = new Map();
let keysByModel = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 1 * 60 * 1000; // Updated to 1 Minute as per User Request for high accuracy across deploys

const DAILY_USAGE_LIMIT = 18; // Strict limit: 18 requests per 24h
const STATUS_ACTIVE = 'active';
const STATUS_DISABLED = 'disabled';
const DISABLE_DURATION_MS = 24 * 60 * 60 * 1000;

const GEMINI_RPM_LIMIT = 4; // Strict limit: 4 requests per 60s
const GEMINI_RPD_LIMIT = 18; // Strict limit: 18 requests per 24h

const deadKeys = new Map();
const DEFAULT_COOLDOWN = 60 * 1000; // 1 Minute default for RPM/TPM
const KEY_MIN_GAP_MS = process.env.KEY_MIN_GAP_MS ? parseInt(process.env.KEY_MIN_GAP_MS, 10) : 900;
const KEY_MIN_GAP_JITTER_MS = process.env.KEY_MIN_GAP_JITTER_MS ? parseInt(process.env.KEY_MIN_GAP_JITTER_MS, 10) : 400;

const keyUsageMap = new Map(); 

const keyUsageTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 seconds
const keyUsageHourTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 minutes
const modelUsageTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 seconds
const modelUsageHourTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 minutes
const modelDailyUsage = new Map(); // Key: modelName, Value: { date: string, count: number }

const modelIndexMap = new Map();

const pendingUpdates = new Map(); // apiKey -> { usage_delta, token_delta, last_used_at, status, cooldown_until }

// --- 3. KEY CACHE MANAGEMENT ---
// Function declaration MUST be hoisted or defined before call
async function updateKeyCache(force = false) {
    const now = Date.now();
    // Refresh cache ONLY if not exists, forced, or TTL expired (1 min).
    if (!force && keyCache.length > 0 && (now - lastCacheUpdate < CACHE_TTL)) {
        return;
    }

    // --- CRITICAL: Always flush pending updates BEFORE fetching from DB ---
    // This ensures in-memory increments are not lost when we replace the cache object.
    if (pendingUpdates.size > 0) {
        await flushUsageStats();
    }

    try {
        const pgClient = require('./pgClient');
        const result = await pgClient.query(
            "SELECT * FROM api_list WHERE status = 'active' ORDER BY id ASC"
        );
        
        const rows = Array.isArray(result.rows) ? result.rows : [];
        keyCache = rows;
        
        // Re-build lookup maps for performance
        const newMap = new Map();
        const providerMap = new Map();
        const modelMap = new Map();

        rows.forEach(k => {
            newMap.set(k.api, k);
            
            // Provider Index
            const p = (k.provider || 'unknown').toLowerCase();
            if (!providerMap.has(p)) providerMap.set(p, []);
            providerMap.get(p).push(k);

            // Model Index (if set)
            if (k.model) {
                const m = k.model.toLowerCase();
                if (!modelMap.has(m)) modelMap.set(m, []);
                modelMap.get(m).push(k);
            }
        });

        // --- OPTIMIZATION: Sort once during cache update (O(N log N) once per min) ---
        // instead of sorting during every request (O(N log N) per request).
        // This ensures the "Oldest First" rotation is maintained efficiently.
        for (const list of providerMap.values()) {
            list.sort((a, b) => {
                const tA = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
                const tB = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
                if (tA !== tB) return tA - tB;
                return a.id - b.id;
            });
        }
        for (const list of modelMap.values()) {
            list.sort((a, b) => {
                const tA = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
                const tB = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
                if (tA !== tB) return tA - tB;
                return a.id - b.id;
            });
        }

        keyCacheMap = newMap;
        keysByProvider = providerMap;
        keysByModel = modelMap;
        lastCacheUpdate = now;

        // --- RESET ROTATION POINTERS ---
        // Since we re-sorted the keys (LRU style), we should restart scanning from index 0
        // to pick the absolute oldest/freshest keys first.
        globalKeyPointers.clear();
        
        // console.log(`[KeyService] Cache updated: ${rows.length} active keys. Rotation reset to Oldest First.`);
    } catch (err) {
        console.error(`[KeyService] Failed to update key cache:`, err.message);
    }
}

// Flush Interval (Increased to 30 Seconds to save CPU)
setInterval(flushUsageStats, 30 * 1000);

// Background Cache Refresh (Every 1 Minute for cross-process accuracy)
setInterval(() => {
    updateKeyCache(true).catch(err => console.error(`[KeyService] Background cache refresh failed:`, err.message));
}, 60 * 1000);

// Final Flush on Exit (Best effort)
process.on('SIGTERM', async () => {
    console.log('[KeyService] SIGTERM received. Flushing usage stats...');
    await flushUsageStats();
});
process.on('SIGINT', async () => {
    console.log('[KeyService] SIGINT received. Flushing usage stats...');
    await flushUsageStats();
});

// --- Default Limits Map (Fallback if DB values are null) ---
// Based on typical Free Tier limits as of early 2025
const DEFAULT_LIMITS = {
    // Gemini Limits (Based on User Info)
    'gemini-2.5-flash': { rpm: 5, rpd: 20 }, 
    'gemini-2.5-flash-lite': { rpm: 5, rpd: 20 }, 

    
    // Groq Limits (Based on Official Docs)
    'llama-3.3-70b-versatile': { rpm: 30, rpd: 1000 }, 
    'llama-3.1-8b-instant': { rpm: 30, rpd: 14400 },   
    'groq/compound-mini': { rpm: 30, rpd: 1000 }, // User Request: Support this alias
    'meta-llama/llama-4-scout-17b-16e-instruct': { rpm: 25, rpd: 500 }, // User Request: Support this alias
    
    // OpenRouter Free Limits (Safe Defaults)
    'arcee-ai/trinity-large-preview:free': { rpm: 9999, rpd: 9999 }, 
    'upstage/solar-pro-3:free': { rpm: 20, rpd: 50 }, 
    'liquid/lfm-2.5-1.2b-instruct:free': { rpm: 20, rpd: 50 }, 
    'nvidia/nemotron-nano-12b-v2-vl:free': { rpm: 20, rpd: 50 }, 
    'nousresearch/hermes-3-llama-3.1-405b:free': { rpm: 20, rpd: 50 }, 
    'openrouter/default': { rpm: 1000, rpd: 10000 },
    
    // DYNAMIC MODEL FALLBACK:
    'dynamic': { rpm: 100, rpd: 10000 }, // Generous default for whatever the optimizer picks
    'default': { rpm: 100, rpd: 10000 }
};

// --- Model Lock Mechanism (User Request: 2m -> 24h) ---
const modelLockMap = new Map(); // Key: modelName, Value: { expiry: number, strikes: number }
const keyLockState = new Map(); // Key: apiKey, Value: { strikes: number, last_429: number }

async function report429(modelName, apiKey = null) {
    const now = Date.now();

    // 1. If API Key is provided, lock ONLY that key (Targeted Lock)
    if (apiKey) {
        const state = keyLockState.get(apiKey) || { strikes: 0, last_429: 0 };
        
        // Reset strikes if last 429 was > 1 hour ago (Cool-off period)
        if (now - state.last_429 > 60 * 60 * 1000) {
            state.strikes = 0;
        }

        if (state.strikes === 0) {
            // First offense -> 2 Minutes
            state.strikes = 1;
            const duration = 2 * 60 * 1000;
            await markKeyAsDead(apiKey, duration, '429_rate_limit_1st');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 2 mins (First 429)`);
        } else {
            // Second offense -> 24 Hours
            state.strikes = 2;
            const duration = 24 * 60 * 60 * 1000;
            await markKeyAsDead(apiKey, duration, '429_rate_limit_2nd');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 24 HOURS (Repeated 429)`);
        }
        
        state.last_429 = now;
        keyLockState.set(apiKey, state);
        return; // DONE. Do not lock the whole model.
    }

    // 2. Fallback: If no API Key provided, lock the WHOLE Model (Legacy/Emergency)
    if (!modelName) return;
    const state = modelLockMap.get(modelName) || { expiry: 0, strikes: 0 };
    
    if (state.strikes === 0) {
        state.strikes = 1;
        state.expiry = now + 2 * 60 * 1000; 
        console.warn(`[KeyService] 🔒 Locking MODEL ${modelName} for 2 minutes (First 429 - No Key Info)`);
    } else {
        state.strikes = 2; 
        state.expiry = now + 24 * 60 * 60 * 1000; 
        console.warn(`[KeyService] 🔒 Locking MODEL ${modelName} for 24 HOURS (Repeated 429 - No Key Info)`);
    }
    modelLockMap.set(modelName, state);
}

// Check if a model is globally locked
function isModelLocked(modelName) {
    if (!modelName) return false;
    const state = modelLockMap.get(modelName);
    if (!state) return false;
    
    // Check if lock expired
    if (Date.now() > state.expiry) {
        modelLockMap.delete(modelName); // Auto-cleanup
        return false;
    }
    return true;
}

// Helper to mark key dead directly using object or string
async function markKeyAsDead(keyOrObj, duration = DEFAULT_COOLDOWN, reason = 'unknown') {
    const key = typeof keyOrObj === 'object' ? keyOrObj.api : keyOrObj;
    if (!key) return;
    const expiry = Date.now() + duration;
    const expiryDate = new Date(expiry);
    console.warn(`[KeyService] Blocking key ${key.substring(0, 8)}... for ${(duration/1000).toFixed(1)}s. Reason: ${reason} (Until: ${expiryDate.toISOString()})`);
    
    // Update In-Memory Map for legacy check
    deadKeys.set(key, { expiry, reason });

    // Update Cache Object for Persistence
    const cachedKey = keyCacheMap.get(key);
    if (cachedKey) {
        cachedKey.cooldown_until = expiryDate.toISOString();
        
        const current = pendingUpdates.get(key) || { usage_delta: 0, token_delta: 0 };
        current.cooldown_until = expiryDate.toISOString();
        pendingUpdates.set(key, current);
    }

    // --- IMMEDIATE DB UPDATE for status/cooldown ---
    try {
        const pgClient = require('./pgClient');
        await pgClient.query(
            "UPDATE api_list SET cooldown_until = $1, last_used_at = NOW() WHERE api = $2",
            [expiryDate.toISOString(), key]
        );
    } catch (err) {
        console.error(`[KeyService] Failed to immediately persist dead key status:`, err.message);
    }
}


async function markKeyAsSuspended(key, reason = 'suspended') {
    if (!key) return;
    const cachedKey = keyCacheMap.get(key);
    if (cachedKey) {
        cachedKey.status = 'suspended';
        cachedKey.last_used_at = new Date().toISOString();
        
        const current = pendingUpdates.get(key) || { usage_delta: 0, token_delta: 0 };
        current.status = 'suspended';
        current.last_used_at = cachedKey.last_used_at;
        pendingUpdates.set(key, current);
    }
    console.warn(`[KeyService] Marked key ${key.substring(0, 8)}... as suspended. Reason: ${reason}`);

    // --- IMMEDIATE DB UPDATE ---
    try {
        const pgClient = require('./pgClient');
        await pgClient.query(
            "UPDATE api_list SET status = 'suspended', last_used_at = NOW() WHERE api = $1",
            [key]
        );
    } catch (err) {
        console.error(`[KeyService] Failed to immediately persist suspended key status:`, err.message);
    }
}

async function markKeyAsQuotaExceeded(key) {
    if (!key) return;
    // Calculate time until next midnight (UTC)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0); // Next UTC Midnight
    const duration = tomorrow.getTime() - now.getTime();
    
    // Add 1 hour buffer to be safe
    const safeDuration = duration + (60 * 60 * 1000);
    
    await markKeyAsDead(key, safeDuration, 'quota_exceeded');
}

function isKeyAlive(key) {
    // 1. Check Legacy In-Memory Map
    if (deadKeys.has(key)) {
        const entry = deadKeys.get(key);
        if (Date.now() > entry.expiry) {
            deadKeys.delete(key); 
            // Also clear from cache object if exists
            const cached = keyCacheMap.get(key);
            if (cached) cached.cooldown_until = null;
            return true;
        }
        return false;
    }

    // 2. Check Persisted Cooldown (from DB/Cache)
    const cachedKey = keyCacheMap.get(key);
    if (cachedKey && cachedKey.cooldown_until) {
        const cooldownExpiry = new Date(cachedKey.cooldown_until).getTime();
        if (Date.now() > cooldownExpiry) {
            cachedKey.cooldown_until = null;
            return true;
        }
        return false;
    }

    return true;
}

// 4. Rate Limit Verification (STRICT MODE)
function isKeyWithinLimits(keyData, requestedModel = null) {
    // Check if the entire model is locked (due to repeated 429s)
    const modelToCheck = requestedModel || keyData.model;
    if (isModelLocked(modelToCheck)) {
        return false;
    }

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // --- 1. KEY-LEVEL LIMITS (STRICT & UNIFIED) ---
    // User Requirement: "agula to fronted e select korbo defualt e kono limit takbe na"
    // Solution: REMOVE DEFAULT LIMITS.
    // Only enforce limits if explicitly set in DB (keyData.rpd_limit / rpm_limit).
    // If not set (null/0), check for Dynamic Model Overrides (from Frontend).
    
    const manual = requestedModel ? dynamicLimits.get(String(requestedModel)) : null;

    // RPD (Requests Per Day) - Unified
    let rpdLimit = parseInt(keyData.rpd_limit); 
    if (!(rpdLimit > 0) && manual && manual.rpd) {
        rpdLimit = parseInt(manual.rpd);
    }
    
    // We use the key's total daily usage (regardless of model)
    // Only check if rpdLimit is a valid positive number
    if (rpdLimit > 0 && keyData.last_date_checked === today && (keyData.usage_today || 0) >= rpdLimit) {
        return false;
    }

    // RPM (Requests Per Minute) - Unified
    let rpmLimit = parseInt(keyData.rpm_limit);
    if (!(rpmLimit > 0) && manual && manual.rpm) {
        rpmLimit = parseInt(manual.rpm);
    }
    
    // Check global timestamps for this KEY
    const timestamps = keyUsageTimestamps.get(keyData.api) || [];
    const oneMinuteAgo = now - 60000;
    
    // Filter valid timestamps (clean up old ones)
    const validTimestamps = timestamps.filter(ts => ts > oneMinuteAgo);
    
    // Update cache if needed
    if (validTimestamps.length !== timestamps.length) {
        keyUsageTimestamps.set(keyData.api, validTimestamps);
    }

    // STRICT CHECK: If total requests in last minute >= Limit
    // Only check if rpmLimit is a valid positive number
    if (rpmLimit > 0 && validTimestamps.length >= rpmLimit) {
        return false;
    }

    let rphLimit = parseInt(keyData.rph_limit);
    if (!(rphLimit > 0) && manual && manual.rph) {
        rphLimit = parseInt(manual.rph);
    }
    const hourTimestamps = keyUsageHourTimestamps.get(keyData.api) || [];
    const oneHourAgo = now - 60 * 60 * 1000;
    const validHourTimestamps = hourTimestamps.filter(ts => ts > oneHourAgo);

    if (validHourTimestamps.length !== hourTimestamps.length) {
        keyUsageHourTimestamps.set(keyData.api, validHourTimestamps);
    }

    if (rphLimit > 0 && validHourTimestamps.length >= rphLimit) {
        return false;
    }

    // --- 2. MODEL-LEVEL GLOBAL LIMITS (OPTIONAL/SECONDARY) ---
    // User request: "jeno rate limit hardcode hoi mane doro ami ja select korbo fronted e setai mane colbe"
    // If 'manual' has a source 'global_engine', we treat it as a GLOBAL limit for the WHOLE model usage across all keys.
    // NOTE: We only enforce this if the limit is > 100, assuming small numbers are per-key defaults.
    // If you want a strict small global limit, use a different source or explicit flag.
    if (manual && manual.source === 'global_engine' && (manual.rpm > 100 || manual.rpd > 1000)) {
        // Strict Model RPD
        if (manual.rpd) {
            const daily = modelDailyUsage.get(requestedModel) || { date: today, count: 0 };
            if (daily.date === today && daily.count >= manual.rpd) {
                console.warn(`[KeyService] ⛔ Global Engine ${requestedModel} hit RPD limit (${manual.rpd})`);
                return false;
            }
        }
        // Strict Model RPM
        if (manual.rpm) {
            const mTimestamps = modelUsageTimestamps.get(requestedModel) || [];
            const mValid = mTimestamps.filter(ts => ts > oneMinuteAgo);
            if (mValid.length >= manual.rpm) {
                console.warn(`[KeyService] ⛔ Global Engine ${requestedModel} hit RPM limit (${manual.rpm})`);
                return false;
            }
        }
    }

    return true;
}

// Record Usage (Call this AFTER successful AI response to track tokens)
async function recordKeyUsage(apiKey, tokenUsage = 0) {
    if (!apiKey) return;

    const cachedKey = keyCacheMap.get(apiKey);

    if (cachedKey) {
        const usageKey = `${apiKey}:${String(cachedKey.model || 'default')}`;
        keyUsageMap.set(usageKey, Date.now());

        // Update token usage ONLY (Request count is now in getSmartKey)
        cachedKey.usage_tokens_today = (cachedKey.usage_tokens_today || 0) + tokenUsage;
        
        // Mark for batch update to DB (Delta approach)
        const current = pendingUpdates.get(apiKey) || { usage_delta: 0, token_delta: 0 };
        current.token_delta = (current.token_delta || 0) + tokenUsage;
        pendingUpdates.set(apiKey, current);
    }
}

// Flush Usage Stats to Database (Called periodically)
async function flushUsageStats() {
    if (pendingUpdates.size === 0) return;

    const keysToUpdate = Array.from(pendingUpdates.keys());
    const deltas = Array.from(pendingUpdates.values());
    pendingUpdates.clear();

    const today = new Date().toISOString().split('T')[0];

    // OPTIMIZATION: Bulk Upsert to prevent Server Overload
    const updates = keysToUpdate.map((apiKey, idx) => {
        const cachedKey = keyCacheMap.get(apiKey);
        if (!cachedKey) return null;
        const delta = deltas[idx];
        
        return {
            api: apiKey,
            usage_delta: delta.usage_delta || 0,
            token_delta: delta.token_delta || 0,
            last_date_checked: today,
            last_used_at: delta.last_used_at || cachedKey.last_used_at,
            status: delta.status || cachedKey.status,
            cooldown_until: delta.cooldown_until || cachedKey.cooldown_until || null
        };
    }).filter(k => k !== null);

    if (updates.length === 0) return;

    try {
        const pgClient = require('./pgClient');

        const values = [];
        const valuePlaceholders = [];

        updates.forEach((u, index) => {
            const baseIndex = index * 7;
            valuePlaceholders.push(
                `($${baseIndex + 1}, $${baseIndex + 2}::bigint, $${baseIndex + 3}::bigint, $${baseIndex + 4}::date, $${baseIndex + 5}::timestamp, $${baseIndex + 6}, $${baseIndex + 7}::timestamp)`
            );
            values.push(
                u.api,
                u.usage_delta,
                u.token_delta,
                u.last_date_checked,
                u.last_used_at,
                u.status,
                u.cooldown_until
            );
        });

        const queryText = `
            UPDATE api_list AS a SET
                usage_today = CASE 
                    WHEN a.last_date_checked = v.last_date_checked THEN a.usage_today + v.usage_delta 
                    ELSE v.usage_delta 
                END,
                usage_tokens_today = CASE 
                    WHEN a.last_date_checked = v.last_date_checked THEN a.usage_tokens_today + v.token_delta 
                    ELSE v.token_delta 
                END,
                last_date_checked = v.last_date_checked,
                last_used_at = v.last_used_at,
                status = COALESCE(v.status, a.status),
                cooldown_until = COALESCE(v.cooldown_until, a.cooldown_until)
            FROM (VALUES ${valuePlaceholders.join(', ')}) AS v(api, usage_delta, token_delta, last_date_checked, last_used_at, status, cooldown_until)
            WHERE a.api = v.api
        `;

        await pgClient.query(queryText, values);
    } catch (err) {
        console.error(`[KeyService] Failed to flush stats:`, err.message);
    }
}

// Update Key Status based on Response Headers
async function updateKeyStatusFromHeaders(apiKey, headers) {
    if (!apiKey || !headers) return;

    // 1. Check for Rate Limit Headers (Remaining)
    const remaining = headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
    const resetTime = headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset'] || headers['ratelimit-reset'];

    // 2. Check for Rate Limit Headers (Limit Capacity) - LEARN THE LIMIT IN REAL-TIME
    const limitCap = headers['x-ratelimit-limit-requests'] || headers['x-ratelimit-limit'] || headers['ratelimit-limit'];
    
    if (limitCap) {
        const keyInfo = keyCache.find(k => k.api === apiKey);
        if (keyInfo && keyInfo.model) {
            const modelName = String(keyInfo.model);
            const current = dynamicLimits.get(modelName) || {};
            // Only update if it's different to avoid spamming
            if (current.rpm !== parseInt(limitCap)) {
                console.log(`[KeyService] 🧠 Learned Real-Time Limit for ${modelName}: ${limitCap} RPM (Config was ${DEFAULT_LIMITS[modelName]?.rpm || 'unknown'})`);
                dynamicLimits.set(modelName, { ...current, rpm: parseInt(limitCap) });
            }
        }
    }

    if (remaining !== undefined && parseInt(remaining) === 0) {
        console.warn(`[KeyService] Key ${apiKey.substring(0,8)}... exhausted (Headers).`);
        
        let timeoutMs = 60 * 1000; // Default 1 min
        if (resetTime) {
            const val = parseInt(resetTime);
            if (val > 1000000000) { // Timestamp
                timeoutMs = val - Date.now();
            } else { // Seconds
                timeoutMs = val * 1000;
            }
        }
        
        if (timeoutMs > 0) {
            await markKeyAsDead(apiKey, timeoutMs, 'header_limit');
        }
    }
}

// 5. Smart Key Selection (Sequential Round-Robin)
// User Requirement: "total api jodi 1 - 100 ta take tahole 100 cross kore then 1 e asbe"
// Solution: O(1) Sequential Rotation. 
// At 50,000 RPM / 10,000 Keys, we MUST avoid O(N log N) sorting during requests.
// Keys are pre-sorted by updateKeyCache() once per minute.

const globalKeyPointers = new Map(); // Stores current index for each "provider:model"

async function getSmartKey(provider, model = 'default') {
    if (typeof updateKeyCache === 'function') {
        await updateKeyCache();
    }
    
    // Check Global Model Lock
    if (isModelLocked(model)) {
        console.warn(`[KeyService] Model ${model} is globally LOCKED due to repeated failures.`);
        return null;
    }

    // 1. Get Candidate Keys
    let candidates = [];
    if (model !== 'default' && keysByModel.has(model)) {
        candidates = keysByModel.get(model);
    } else if (keysByProvider.has(provider)) {
        candidates = keysByProvider.get(provider);
    }
    
    if (!candidates || candidates.length === 0) {
        if (keysByProvider.has(provider)) candidates = keysByProvider.get(provider);
        if (!candidates || candidates.length === 0) return null;
    }

    // Filter dead keys (In-Memory Check is O(N) but small for small dead pools)
    // For 10,000 keys, we filter efficiently.
    const validKeys = candidates.filter(k => isKeyAlive(k.api));
    if (validKeys.length === 0) return null;

    // 2. SEQUENTIAL ROTATION LOGIC (Persistent & High-Performance)
    const mapKey = `${provider}:${model}`;
    let currentIndex = globalKeyPointers.get(mapKey) || 0;
    
    // If index out of bounds, reset to 0
    if (currentIndex >= validKeys.length) currentIndex = 0;

    const minGapMs = KEY_MIN_GAP_MS > 0 ? (KEY_MIN_GAP_MS + Math.floor(Math.random() * (KEY_MIN_GAP_JITTER_MS + 1))) : 0;
    const now = Date.now();

    // Iterate through pre-sorted keys (O(N) check in worst case, but O(1) normally)
    for (let i = 0; i < validKeys.length; i++) {
        const actualIndex = (currentIndex + i) % validKeys.length;
        const candidateKey = validKeys[actualIndex];

        if (minGapMs > 0 && candidateKey.last_used_at) {
            const lastUsedMs = new Date(candidateKey.last_used_at).getTime();
            if (!Number.isNaN(lastUsedMs) && now - lastUsedMs < minGapMs) continue;
        }

        // Check usable (RPM/RPD)
        if (isKeyWithinLimits(candidateKey, model)) {
            // Update Pointer (O(1))
            globalKeyPointers.set(mapKey, (actualIndex + 1) % validKeys.length);
            
            // --- ATOMIC TIMESTAMP RECORDING ---
            const today = new Date().toISOString().split('T')[0];
            
            const modelName = String(model || candidateKey.model || 'default');

            // Per Key RPM
            const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
            tsList.push(now);
            keyUsageTimestamps.set(candidateKey.api, tsList);

            const hourList = keyUsageHourTimestamps.get(candidateKey.api) || [];
            hourList.push(now);
            keyUsageHourTimestamps.set(candidateKey.api, hourList);

            const modelTs = modelUsageTimestamps.get(modelName) || [];
            modelTs.push(now);
            modelUsageTimestamps.set(modelName, modelTs);

            const modelHourTs = modelUsageHourTimestamps.get(modelName) || [];
            modelHourTs.push(now);
            modelUsageHourTimestamps.set(modelName, modelHourTs);

            const modelDaily = modelDailyUsage.get(modelName) || { date: today, count: 0 };
            if (modelDaily.date === today) {
                modelDaily.count += 1;
            } else {
                modelDaily.date = today;
                modelDaily.count = 1;
            }
            modelDailyUsage.set(modelName, modelDaily);

            // Usage Counting
            candidateKey.usage_count = (candidateKey.usage_count || 0) + 1;
            if (candidateKey.last_date_checked === today) {
                candidateKey.usage_today = (candidateKey.usage_today || 0) + 1;
            } else {
                candidateKey.last_date_checked = today;
                candidateKey.usage_today = 1;
            }
            candidateKey.last_used_at = new Date().toISOString();

            // Track Delta for Persistence
            const current = pendingUpdates.get(candidateKey.api) || { usage_delta: 0, token_delta: 0 };
            current.usage_delta = (current.usage_delta || 0) + 1;
            current.last_used_at = candidateKey.last_used_at;
            pendingUpdates.set(candidateKey.api, current);
            
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

// --- 24. Initialization ---
// Populate the cache immediately on server start
// Let's ensure it's called safely with a small delay to avoid race conditions with other modules.

setTimeout(() => {
    if (typeof updateKeyCache === 'function') {
        console.log(`[KeyService] Initializing Key Cache at ${new Date().toISOString()}...`);
        updateKeyCache(true).catch(err => console.error("Initial key cache update failed:", err));
    } else {
        console.error("CRITICAL: updateKeyCache function is missing at runtime!");
    }
}, 2000); // 2 seconds delay for safe initialization

module.exports = {
    // NEW: Adaptive Rate Limit Reporter
    reportRateLimit(modelId) {
        console.warn(`[KeyService] ⚠️ Adaptive Limit Triggered for ${modelId}`);
        
        // 1. Get current usage count for this minute
        const usageKey = `${modelId}:${new Date().getMinutes()}`;
        const currentUsage = keyUsageMap.get(usageKey) || 0;

        // 2. Set new limit slightly below crash point (e.g., 90% or -1)
        const newLimit = Math.max(1, currentUsage - 1);
        
        console.log(`[KeyService] 📉 Adjusting RPM limit for ${modelId} from UNKNOWN to ${newLimit}`);

        // 3. Store in Memory
        dynamicLimits.set(modelId, { rpm: newLimit, rpd: 10000, rph: 0 }); // Keep RPD high, focus on RPM

        // 4. (Optional) Persist to DB? 
        // For now, in-memory is safer to avoid thrashing DB on every 429. 
        // It will reset on restart, which is good for recovering from temporary outages.
    },

    getManagedKey: () => null, 
    getAllManagedKeys: () => [], 
    getSmartKey, 
    markKeyAsDead,
    markKeyAsSuspended,
    markKeyAsQuotaExceeded,
    recordKeyUsage,
    updateKeyStatusFromHeaders,
    updateKeyCache, // Export this!
    forceUpdateKeyCache: async () => {
        console.log("[KeyService] Manual cache refresh requested.");
        return updateKeyCache(true);
    },
    flushUsageStats, // Export this!
    report429, 
    isModelLocked,
    setManualLimit(modelId, limits) {
        if (!modelId || !limits) return;
        const rpm = parseInt(limits.rpm) || 0;
        const rpd = parseInt(limits.rpd) || 0;
        const rph = parseInt(limits.rph) || 0;
        const source = limits.source || 'manual';
        console.log(`[KeyService] ⚙️ Manually Setting Limits for ${modelId}: RPM=${rpm}, RPD=${rpd}, RPH=${rph}, Source=${source}`);
        dynamicLimits.set(modelId, { rpm, rpd, rph, source });
    },
    getLimitForModel: (modelId) => {
        const dyn = dynamicLimits.get(modelId);
        const def = DEFAULT_LIMITS[modelId] || DEFAULT_LIMITS['default'];
        if (dyn) return { ...def, ...dyn, source: 'realtime' };
        return { ...def, source: 'static' };
    },
    
    // NEW: Get filtered keys for Active Rotation Pool display with pagination
    getActiveRotationPool: (providerFilter = null, page = 1, limit = 10, searchQuery = '') => {
        let keys = [];
        
        if (providerFilter && providerFilter !== 'all') {
            // Filter by Provider
            if (providerFilter === 'google' || providerFilter === 'gemini') {
                keys = keysByProvider.get('google') || [];
            } else {
                keys = keysByProvider.get(providerFilter) || [];
            }
        } else {
            // No filter, use all keys
            keys = keyCache;
        }

        const query = String(searchQuery || '').trim().toLowerCase();
        const filteredKeys = query
            ? keys.filter(k => {
                const provider = (k.provider || '').toLowerCase();
                const api = (k.api || '').toLowerCase();
                return provider.includes(query) || api.includes(query);
            })
            : keys;

        const total = filteredKeys.length;
        const offset = (page - 1) * limit;
        const paginatedKeys = filteredKeys.slice(offset, offset + limit);

        return {
            total,
            page,
            limit,
            keys: paginatedKeys.map(k => ({
                id: k.id,
                provider: k.provider,
                api: k.api.substring(0, 12) + '***', // Mask key for safety
                status: k.status,
                usage_today: k.usage_today,
                last_used_at: k.last_used_at,
                rph_limit: k.rph_limit
            }))
        };
    }
};
