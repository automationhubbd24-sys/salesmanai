const dbService = require('./dbService');
const pgClient = require('./pgClient');

// --- TIME HELPERS (Reset at 2 PM BD Time / 08:00 AM UTC) ---
function getPacificDate() {
    // Returns a date string (YYYY-MM-DD) that represents the current reset cycle.
    // Cycle starts at 2 PM BD Time (08:00 AM UTC).
    const now = new Date();
    const resetToday = new Date(now);
    resetToday.setUTCHours(8, 0, 0, 0);

    let cycleDate = new Date(now);
    if (now < resetToday) {
        // Still in the cycle that started yesterday at 2 PM BD
        cycleDate.setUTCDate(cycleDate.getUTCDate() - 1);
    }
    
    const year = cycleDate.getUTCFullYear();
    const month = String(cycleDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(cycleDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMsUntilPacificMidnight() {
    // Calculates MS until the next 2 PM BD Time (08:00 AM UTC)
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setUTCHours(8, 0, 0, 0);
    
    if (now >= nextReset) {
        // Already passed 2 PM BD today, next reset is tomorrow at 2 PM BD
        nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    }
    
    // Add 1 minute buffer
    return (nextReset.getTime() - now.getTime()) + (60 * 1000);
}

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
const DEFAULT_COOLDOWN = 24 * 60 * 60 * 1000; // 24 Hours default for all locks as per User Request
const KEY_MIN_GAP_MS = process.env.KEY_MIN_GAP_MS ? parseInt(process.env.KEY_MIN_GAP_MS, 10) : 900;
const KEY_MIN_GAP_JITTER_MS = process.env.KEY_MIN_GAP_JITTER_MS ? parseInt(process.env.KEY_MIN_GAP_JITTER_MS, 10) : 400;

// --- CUSTOM RESET WINDOWS (User Request) ---
const RPM_WINDOW_MS = 70 * 1000; // 70 Seconds
const RPH_WINDOW_MS = 70 * 60 * 1000; // 1 Hour 10 Minutes
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 Hours

const keyUsageMap = new Map(); 

const keyUsageTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 seconds
const keyUsageHourTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 minutes
const modelUsageTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 seconds
const modelUsageHourTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 minutes
const modelDailyUsage = new Map(); // Key: modelName, Value: { date: string, count: number }

const modelIndexMap = new Map();

const shuffledPools = new Map(); // Stores shuffled arrays per provider:model
const pendingUpdates = new Map(); // apiKey -> { usage_delta, token_delta, last_used_at, status, cooldown_until }
let flushPromise = null;

// --- 3. KEY CACHE MANAGEMENT ---
// Function declaration MUST be hoisted or defined before call
async function updateKeyCache(force = false) {
    const now = Date.now();
    if (!force && keyCache.length > 0 && (now - lastCacheUpdate < CACHE_TTL)) {
        return;
    }

    if (pendingUpdates.size > 0) {
        await flushUsageStats();
    }

    try {
        const today = getPacificDate();
        
        // --- SMART AUTO-RESET: Clear expired locks and reset usage for new Pacific Day ---
        const resetResult = await pgClient.query(
            `UPDATE api_list 
             SET 
                status = 'active', 
                cooldown_until = NULL,
                usage_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_today END,
                usage_tokens_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_tokens_today END,
                last_date_checked = CASE WHEN last_date_checked != $1 THEN $1 ELSE last_date_checked END
             WHERE (
                (cooldown_until IS NOT NULL AND cooldown_until < NOW()) 
                OR (last_date_checked != $1 AND status != 'locked')
                OR (status = 'locked' AND cooldown_until IS NULL AND last_used_at < (NOW() - interval '24 hours'))
             )
             AND status != 'disabled'`,
            [today]
        );
        if (resetResult.rowCount > 0) {
            console.log(`[KeyService] ♻️ Auto-reset ${resetResult.rowCount} keys whose 24h lock/cooldown expired.`);
        }

        const result = await pgClient.query(
            "SELECT * FROM api_list ORDER BY id ASC"
        );
        
        const rows = Array.isArray(result.rows) ? result.rows : [];
        
        // --- RE-BUILD MAPS WITH ALL KEYS (Including those in Cooldown/Dead) ---
        // This ensures the UI always sees the latest state for ALL keys in the database
        const newMap = new Map();
        const providerMap = new Map();
        const modelMap = new Map();
        const nowMs = Date.now();

        rows.forEach(k => {
            // Normalize Date to YYYY-MM-DD string for comparison
            if (k.last_date_checked) {
                const d = new Date(k.last_date_checked);
                k.last_date_checked = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
            
            newMap.set(k.api, k);
            
            // Only index for rotation if status is 'active' or 'locked' (locked might be released later)
            if (k.status === 'active' || k.status === 'locked') {
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
            }
        });

        // --- FILTER FOR ENGINE (Rotation Pool) ---
        // Only keep keys that are 'active' AND NOT currently in cooldown
        const activeRows = rows.filter(k => {
            if (k.status !== 'active') return false;
            if (!k.cooldown_until) return true;
            const cooldownExpiry = new Date(k.cooldown_until).getTime();
            return nowMs > cooldownExpiry;
        });

        keyCache = activeRows;
        keyCacheMap = newMap;
        keysByProvider = providerMap;
        keysByModel = modelMap;
        lastCacheUpdate = now;

        // --- OPTIMIZED ROTATION POINTERS ---
        // Instead of clearing pointers on every update, we let them persist.
        // This ensures strict sequential rotation (1 to 300) even when the cache refreshes.
        // Only reset if the list of keys changed significantly? (For now, just persist).
        
        // console.log(`[KeyService] Cache updated: ${rows.length} active keys. Rotation persisted.`);
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
    // Gemini Limits (Based on Official Docs)
    'gemini-1.5-flash': { rpm: 15, rpd: 1500 }, 
    'gemini-1.5-flash-8b': { rpm: 15, rpd: 1500 }, 
    'gemini-2.0-flash-exp': { rpm: 10, rpd: 1500 },
    'gemini-2.0-flash-lite-preview-02-05': { rpm: 10, rpd: 1500 },
    'gemini-2.0-flash': { rpm: 10, rpd: 1500 }, 

    
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
            // First offense -> 2 Minutes (Smart Skip)
            state.strikes = 1;
            const duration = 2 * 60 * 1000;
            await markKeyAsDead(apiKey, duration, '429_rate_limit_1st_2m');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 2 minutes (First 429)`);
        } else {
            // Second offense -> 10 Minutes (Increased Cool-off)
            state.strikes = 2;
            const duration = 10 * 60 * 1000;
            await markKeyAsDead(apiKey, duration, '429_rate_limit_2nd_10m');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 10 minutes (Repeated 429)`);
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
        // Update both cooldown_until AND status to 'locked' for visual clarity in Admin Panel
        const res = await pgClient.query(
            "UPDATE api_list SET cooldown_until = $1, status = 'locked', last_used_at = NOW() WHERE api = $2",
            [expiryDate.toISOString(), key]
        );
        console.log(`[KeyService] 💾 Persisted lock for ${key.substring(0,8)}... until ${expiryDate.toISOString()}. Status set to 'locked'. Rows affected: ${res.rowCount}`);
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
    // --- PACIFIC MIDNIGHT LOCK (Smart Reset) ---
    // Instead of a flat 24h, we lock until the exact moment Google resets (Midnight PT)
    const msToMidnight = getMsUntilPacificMidnight();
    console.log(`[KeyService] 🔒 Quota exceeded for ${key.substring(0,8)}... Locking until Pacific Midnight (${(msToMidnight/1000/60).toFixed(1)} mins).`);
    await markKeyAsDead(key, msToMidnight, 'quota_exceeded_until_pacific_midnight');
}

// Helper to lock a model globally for a specific duration
function lockModelTemporarily(modelName, durationMs) {
    if (!modelName) return;
    const expiry = Date.now() + durationMs;
    modelLockMap.set(modelName, { expiry, strikes: 3 }); // Set strikes high to indicate serious lock
    console.warn(`[KeyService] 🔒 Model ${modelName} locked for ${durationMs/1000}s`);
}

// 13. Check Conversation Lock Status (Failure Lock)
async function checkLockStatus(pageId, senderId) {
    // ... logic remains ...
}

// REMOVED lockModelTemporarily to avoid global model restrictions

async function handleApiKeyError(key, error, modelName = null) {
    if (!key) return;
    const errorStr = String(error).toLowerCase();
    
    // --- SMART 429 DETECTION (FOR ALL PROVIDERS) ---
    // Added '429 status code (no body)' and other common variants
    if (errorStr.includes('429') || 
        errorStr.includes('too many requests') || 
        errorStr.includes('rate limit') ||
        errorStr.includes('status code 429')) {
        
        const isDailyQuota = errorStr.includes('perday') || 
                             errorStr.includes('quota exceeded') || 
                             errorStr.includes('quotavalue') ||
                             errorStr.includes('daily limit');

        if (isDailyQuota) {
            console.warn(`[KeyService] 🚨 Daily Quota Exceeded for ${key}... Locking for 24h.`);
            await markKeyAsQuotaExceeded(key);
        } else {
            console.warn(`[KeyService] ⏳ Rate Limit (429 - RPM/TPM) hit for ${key}... Locking for 2 MINUTES (Smart Skip).`);
            // Lock for 2 minutes for RPM hits to allow recovery without losing the key for a whole day
            const twoMinutes = 2 * 60 * 1000;
            await markKeyAsDead(key, twoMinutes, 'rate_limit_rpm_2m_lock');
        }
        
        // --- FORCE CACHE REFRESH AFTER LOCK ---
        // This ensures the local memory cache and DB are in sync immediately
        await updateKeyCache(true);
        return;
    }

    if (errorStr.includes('401') || errorStr.includes('invalid api key') || errorStr.includes('expired')) {
        console.error(`[KeyService] 💀 Key ${key.substring(0,8)}... is DEAD (401/Invalid). Locking for 24h.`);
        // User Request: All Dead/Locked keys should reset after 24h
        const twentyFourHours = 24 * 60 * 60 * 1000;
        await markKeyAsDead(key, twentyFourHours, 'invalid_key_24h_reset'); 
        return;
    }
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

    const today = getPacificDate();
    const now = Date.now();

    // --- 1. KEY-LEVEL LIMITS (STRICT & UNIFIED) ---
    // Use effective usage (Cache + Pending Delta) to prevent over-usage during cache refresh windows
    const pending = pendingUpdates.get(keyData.api) || { usage_delta: 0 };
    const effectiveUsageToday = (keyData.usage_today || 0) + (keyData.last_date_checked === today ? pending.usage_delta : 0);

    // Only enforce limits if explicitly set in DB (keyData.rpd_limit / rpm_limit).
    // If not set (null/0), check for Dynamic Model Overrides (from Frontend).
    const manual = requestedModel ? dynamicLimits.get(String(requestedModel)) : null;

    // RPD (Requests Per Day) - Unified
    let rpdLimit = parseInt(keyData.rpd_limit); 
    if (!(rpdLimit > 0) && manual && manual.rpd && manual.source !== 'global_engine') {
        rpdLimit = parseInt(manual.rpd);
    }
    
    // Check if rpdLimit is hit
    if (rpdLimit > 0 && keyData.last_date_checked === today && effectiveUsageToday >= rpdLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api} hit RPD limit (${rpdLimit}). Usage: ${effectiveUsageToday}. Marking as Locked.`);
        // Proactively lock it for 24h if it hit the limit in isKeyWithinLimits
        markKeyAsDead(keyData.api, 24 * 60 * 60 * 1000, 'rpd_limit_reached_strict').catch(e => {});
        return false;
    }

    // RPM (Requests Per Minute) - Unified
    let rpmLimit = parseInt(keyData.rpm_limit);
    if (!(rpmLimit > 0) && manual && manual.rpm) {
        rpmLimit = parseInt(manual.rpm);
    }
    
    // Check global timestamps for this KEY
    const timestamps = keyUsageTimestamps.get(keyData.api) || [];
    const rpmThreshold = now - RPM_WINDOW_MS;
    
    // Filter valid timestamps (clean up old ones)
    const validTimestamps = timestamps.filter(ts => ts > rpmThreshold);
    
    // Update cache if needed
    if (validTimestamps.length !== timestamps.length) {
        keyUsageTimestamps.set(keyData.api, validTimestamps);
    }

    // STRICT CHECK: If total requests in last minute >= Limit
    // Only check if rpmLimit is a valid positive number
    if (rpmLimit > 0 && validTimestamps.length >= rpmLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api} hit RPM limit (${rpmLimit}) in last 70s`);
        return false;
    }

    // RPH (Requests Per Hour) - Unified
    let rphLimit = parseInt(keyData.rph_limit);
    if (!(rphLimit > 0) && manual && manual.rph) {
        rphLimit = parseInt(manual.rph);
    }
    const hourTimestamps = keyUsageHourTimestamps.get(keyData.api) || [];
    const rphThreshold = now - RPH_WINDOW_MS;
    const validHourTimestamps = hourTimestamps.filter(ts => ts > rphThreshold);

    if (validHourTimestamps.length !== hourTimestamps.length) {
        keyUsageHourTimestamps.set(keyData.api, validHourTimestamps);
    }

    if (rphLimit > 0 && validHourTimestamps.length >= rphLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPH limit (${rphLimit}) in last 1h 10m`);
        return false;
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

        // --- NEW: FORCED IMMEDIATE FLUSH FOR ACCURACY (User Request) ---
        // We flush immediately after recording token usage to ensure real-time dashboard updates.
        flushUsageStats().catch(e => console.error(`[KeyService] Immediate token flush failed: ${e.message}`));
    }
}

// Flush Usage Stats to Database (Called periodically)
async function flushUsageStats() {
    if (pendingUpdates.size === 0) return;

    // If a flush is already in progress, wait for it and then check if we still have work
    if (flushPromise) {
        await flushPromise;
        if (pendingUpdates.size === 0) return;
    }

    flushPromise = (async () => {
        // Take a snapshot of current pending updates and clear them from main map
        const updatesToFlush = new Map(pendingUpdates);
        pendingUpdates.clear();

        const keysToUpdate = Array.from(updatesToFlush.keys());
        const deltas = Array.from(updatesToFlush.values());

        const today = getPacificDate();

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
        } finally {
            flushPromise = null;
            // If new updates were added while we were flushing, trigger another flush
            if (pendingUpdates.size > 0) {
                flushUsageStats();
            }
        }
    })();

    return flushPromise;
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
            // User Request: All locks should be 24h
            const twentyFourHours = 24 * 60 * 60 * 1000;
            await markKeyAsDead(apiKey, Math.max(timeoutMs, twentyFourHours), 'header_limit_24h_min');
        }
    }
}

// 5. Smart Key Selection (Sequential Round-Robin)
// User Requirement: "total api jodi 1 - 100 ta take tahole 100 cross kore then 1 e asbe"
// Solution: O(1) Sequential Rotation with Atomic Reservation.

const globalKeyPointers = new Map(); 
const rotationLogs = []; 
const MAX_ROTATION_LOGS = 50;

function addRotationLog(provider, model, apiKey, index, total) {
    const log = {
        timestamp: new Date().toISOString(),
        provider,
        model,
        key: apiKey.substring(0, 12) + '***',
        index,
        total
    };
    rotationLogs.unshift(log);
    if (rotationLogs.length > MAX_ROTATION_LOGS) rotationLogs.pop();
}

function getRotationLogs() {
    return rotationLogs;
}

function getKeyUsageSummary(apiKey) {
    const now = Date.now();
    const rpmThreshold = now - RPM_WINDOW_MS;
    const rphThreshold = now - RPH_WINDOW_MS;
    
    const rpmTs = keyUsageTimestamps.get(apiKey) || [];
    const rphTs = keyUsageHourTimestamps.get(apiKey) || [];
    
    return {
        rpm: rpmTs.filter(ts => ts > rpmThreshold).length,
        rph: rphTs.filter(ts => ts > rphThreshold).length
    };
}

// --- NEW: MUTEX-LIKE LOCK FOR KEY SELECTION ---
let isSelectingKey = false;

async function getSmartKey(provider, model = 'default') {
    // Avoid blocking if cache is fresh
    if (typeof updateKeyCache === 'function') {
        const now = Date.now();
        if (now - lastCacheUpdate > CACHE_TTL) {
            await updateKeyCache();
        }
    }
    
    if (isModelLocked(model)) {
        console.warn(`[KeyService] Model ${model} is globally LOCKED.`);
        return null;
    }

    const mapKey = `${provider}:${model}`;
    let currentIndex = globalKeyPointers.get(mapKey) || 0;

    // 1. Get Candidate Keys from Cache
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

    // Filter alive keys for this specific pool
    const currentValidKeys = candidates.filter(k => isKeyAlive(k.api));
    if (currentValidKeys.length === 0) return null;

    // 2. SHUFFLED CYCLE MANAGEMENT
    let shuffledPool = shuffledPools.get(mapKey);

    // If no pool exists OR we completed a full cycle (pointer wrapped to 0) OR pool size changed
    if (!shuffledPool || currentIndex === 0 || currentIndex >= shuffledPool.length || shuffledPool.length !== currentValidKeys.length) {
        console.log(`[KeyService] 🎲 Shuffling API pool for ${mapKey} (New Cycle Start)`);
        // Create a new shuffled pool from currently valid keys
        shuffledPool = [...currentValidKeys].sort(() => Math.random() - 0.5);
        shuffledPools.set(mapKey, shuffledPool);
        currentIndex = 0; // Reset pointer for the new shuffled pool
    }

    const now = Date.now();
    const today = getPacificDate();

    for (let i = 0; i < shuffledPool.length; i++) {
        const actualIndex = (currentIndex + i) % shuffledPool.length;
        const candidateKey = shuffledPool[actualIndex];

        // Skip if key became dead during the cycle
        if (!isKeyAlive(candidateKey.api)) continue;

        // --- HARD CHECK: PRE-RESERVE RPM SLOT TO PREVENT RACE CONDITIONS ---
        const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
        const rpmThreshold = now - RPM_WINDOW_MS;
        const activeRpmCount = tsList.filter(ts => ts > rpmThreshold).length;

        // --- GET LIMITS (Take the MORE RESTRICTIVE one between Key-specific and Global Engine config) ---
        const globalLim = model !== 'default' ? dynamicLimits.get(String(model)) : null;
        
        const rpmLimit = Math.min(
            parseInt(candidateKey.rpm_limit) || 99999, 
            (globalLim && globalLim.rpm > 0) ? globalLim.rpm : 99999
        );
        const rphLimit = Math.min(
            parseInt(candidateKey.rph_limit) || 99999, 
            (globalLim && globalLim.rph > 0) ? globalLim.rph : 99999
        );
        const rpdLimit = Math.min(
            parseInt(candidateKey.rpd_limit) || 99999, 
            (globalLim && globalLim.rpd > 0) ? globalLim.rpd : 99999
        );

        // Check RPM
        if (rpmLimit < 99999 && activeRpmCount >= rpmLimit) {
            // console.log(`[KeyService] Skip ${candidateKey.api.substring(0,8)} (RPM Limit: ${activeRpmCount}/${rpmLimit})`);
            continue;
        }

        // Check RPH (Requests Per Hour)
        const hourTsList = keyUsageHourTimestamps.get(candidateKey.api) || [];
        const oneHourAgo = now - (60 * 60 * 1000 + 60 * 1000); // 1h 1m buffer
        const activeRphCount = hourTsList.filter(ts => ts > oneHourAgo).length;

        if (rphLimit < 99999 && activeRphCount >= rphLimit) {
            // console.log(`[KeyService] Skip ${candidateKey.api.substring(0,8)} (RPH Limit: ${activeRphCount}/${rphLimit})`);
            continue;
        }

        // Check RPD
        const pending = pendingUpdates.get(candidateKey.api) || { usage_delta: 0 };
        const dbUsage = candidateKey.last_date_checked === today ? (Number(candidateKey.usage_today) || 0) : 0;
        const effectiveUsageToday = dbUsage + pending.usage_delta;

        if (rpdLimit < 99999 && effectiveUsageToday >= rpdLimit) {
            console.warn(`[KeyService] ⛔ Key ${candidateKey.api.substring(0,8)}... hit RPD limit (${rpdLimit}). Usage: ${effectiveUsageToday}. Locking.`);
            // Update local state to prevent immediate re-selection
            candidateKey.status = 'locked';
            candidateKey.cooldown_until = new Date(Date.now() + getMsUntilPacificMidnight()).toISOString();
            
            // Persist to DB immediately
            markKeyAsDead(candidateKey.api, getMsUntilPacificMidnight(), `rpd_limit_reached_hard_${rpdLimit}`).catch(e => {});
            continue;
        }

        // --- KEY SELECTED: ATOMIC UPDATES ---
        
        // Update Rotation Pointer for NEXT request
        const nextIndex = (actualIndex + 1) % shuffledPool.length;
        globalKeyPointers.set(mapKey, nextIndex);

        // Record Timestamp immediately (Atomic Reservation)
        tsList.push(now);
        keyUsageTimestamps.set(candidateKey.api, tsList);

        const hourList = keyUsageHourTimestamps.get(candidateKey.api) || [];
        hourList.push(now);
        keyUsageHourTimestamps.set(candidateKey.api, hourList);

        // Update Usage Stats
        candidateKey.usage_count = (Number(candidateKey.usage_count) || 0) + 1;
        if (candidateKey.last_date_checked === today) {
            candidateKey.usage_today = (Number(candidateKey.usage_today) || 0) + 1;
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

        // --- NEW: FORCED IMMEDIATE FLUSH FOR ACCURACY ---
        // Instead of waiting 30s, we flush usage to DB immediately after selection
        // to ensure the UI shows the latest state instantly.
        flushUsageStats().catch(e => console.error(`[KeyService] Immediate flush failed: ${e.message}`));

        console.log(`[KeyService] ✅ Selected Key: ${candidateKey.api} (Index: ${actualIndex + 1}/${shuffledPool.length}, RPM: ${activeRpmCount + 1}/${rpmLimit || '∞'})`);
        addRotationLog(provider, model, candidateKey.api, actualIndex + 1, shuffledPool.length);

        return {
            key: candidateKey.api,
            provider: candidateKey.provider,
            model: candidateKey.model || model
        };
    }

    console.warn(`[KeyService] ⚠️ All ${currentValidKeys.length} keys exhausted for ${provider}/${model}`);
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

    getKeyUsageSummary,
    getRotationLogs,
    getManagedKey: () => null, 
    getAllManagedKeys: () => [], 
    getSmartKey, 
    markKeyAsDead,
    markKeyAsSuspended,
    markKeyAsQuotaExceeded,
    handleApiKeyError,
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
        const today = getPacificDate();
        
        // --- FETCH ALL KEYS FROM DATABASE FOR POOL (Including Cooldown) ---
        // We use keyCacheMap which is now populated with ALL keys from Postgres in updateKeyCache()
        
        const fullList = Array.from(keyCacheMap.values());
        
        if (providerFilter && providerFilter !== 'all') {
            // Filter by Provider
            if (providerFilter === 'google' || providerFilter === 'gemini') {
                keys = fullList.filter(k => (k.provider === 'google' || k.provider === 'gemini'));
            } else {
                keys = fullList.filter(k => k.provider === providerFilter);
            }
        } else {
            keys = fullList;
        }

        const query = String(searchQuery || '').trim().toLowerCase();
        const filteredKeys = query
            ? keys.filter(k => {
                const provider = (k.provider || '').toLowerCase();
                const api = (k.api || '').toLowerCase();
                return provider.includes(query) || api.includes(query);
            })
            : keys;

        // Sort: Active first, then by ID
        filteredKeys.sort((a, b) => {
            const aLocked = a.cooldown_until && new Date(a.cooldown_until) > new Date();
            const bLocked = b.cooldown_until && new Date(b.cooldown_until) > new Date();
            if (aLocked !== bLocked) return aLocked ? 1 : -1;
            return a.id - b.id;
        });

        const total = filteredKeys.length;
        const offset = (page - 1) * limit;
        const paginatedKeys = filteredKeys.slice(offset, offset + limit);

        return {
            total,
            page,
            limit,
            keys: paginatedKeys.map(k => {
                const summary = getKeyUsageSummary(k.api);
                const pending = pendingUpdates.get(k.api) || { usage_delta: 0 };
                const dbUsage = k.last_date_checked === today ? (k.usage_today || 0) : 0;
                
                return {
                    id: k.id,
                    provider: k.provider,
                    api: k.api, // Send full API key for searching (Admin Panel only)
                    email: k.email,
                    status: pending.status || k.status,
                    usage_today: dbUsage + (pending.usage_delta || 0),
                    last_used_at: k.last_used_at,
                    rph_limit: k.rph_limit,
                    rpm_limit: k.rpm_limit,
                    rpd_limit: k.rpd_limit,
                    current_rpm: summary.rpm,
                    current_rph: summary.rph,
                    cooldown_until: pending.cooldown_until || k.cooldown_until
                };
            })
        };
    }
};
