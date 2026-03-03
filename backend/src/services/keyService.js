const dbService = require('./dbService');

const dynamicLimits = new Map();

let keyCache = []; // Keeping for backward compatibility if needed in loops
let keyCacheMap = new Map(); // NEW: Key lookup Map (apiKey -> object) for O(1) access
let keysByProvider = new Map();
let keysByModel = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 60 * 1000; // Updated to 30 Minutes as per User Request for lower CPU usage

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

const pendingUpdates = new Set();

// --- 3. KEY CACHE MANAGEMENT ---
// Function declaration MUST be hoisted or defined before call
async function updateKeyCache(force = false) {
    const now = Date.now();
    if (!force && now - lastCacheUpdate < CACHE_TTL && keyCache.length > 0) {
        return;
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

        keyCacheMap = newMap;
        keysByProvider = providerMap;
        keysByModel = modelMap;
        lastCacheUpdate = now;
        
        // console.log(`[KeyService] Cache updated: ${rows.length} active keys.`);
    } catch (err) {
        console.error(`[KeyService] Failed to update key cache:`, err.message);
    }
}

// Flush Interval (Increased to 30 Seconds to save CPU)
setInterval(flushUsageStats, 30 * 1000);

// --- Background Cache Refresh (30 Minutes) ---
// Proactively fetches new keys/limits from DB to keep memory fresh
setInterval(() => {
    if (typeof updateKeyCache === 'function') {
        updateKeyCache(true); 
    }
}, 30 * 60 * 1000);
// --------------------------------------------------

// --- Default Limits Map (Fallback if DB values are null) ---
// Based on typical Free Tier limits as of early 2025
const DEFAULT_LIMITS = {
    // Gemini Limits (Based on User Info)
    'gemini-2.5-flash': { rpm: 15, rpd: 1500 }, // User Request: 2.5 Support
    'gemini-2.5-flash-lite': { rpm: 15, rpd: 1500 }, 
    'gemini-2.0-flash': { rpm: 15, rpd: 1500 }, 
    'gemini-2.0-flash-lite': { rpm: 15, rpd: 1500 }, 
    'gemini-1.5-pro': { rpm: 2, rpd: 50 },
    
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

function report429(modelName, apiKey = null) {
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
            markKeyAsDead(apiKey, duration, '429_rate_limit_1st');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 2 mins (First 429)`);
        } else {
            // Second offense -> 24 Hours
            state.strikes = 2;
            const duration = 24 * 60 * 60 * 1000;
            markKeyAsDead(apiKey, duration, '429_rate_limit_2nd');
            console.warn(`[KeyService] 🔒 Locking KEY ${apiKey.substring(0,8)}... for 24 HOURS (Repeated 429)`);
        }
        
        state.last_429 = now;
    keyLockState.set(apiKey, state);
    return; // DONE. Do not lock the whole model.
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

// Helper to mark key dead directly using object or string
function markKeyAsDead(keyOrObj, duration = DEFAULT_COOLDOWN, reason = 'unknown') {
    const key = typeof keyOrObj === 'object' ? keyOrObj.api : keyOrObj;
    if (!key) return;
    const expiry = Date.now() + duration;
    console.warn(`[KeyService] Blocking key ${key.substring(0, 8)}... for ${(duration/1000).toFixed(1)}s. Reason: ${reason}`);
    deadKeys.set(key, { expiry, reason });
}


function markKeyAsSuspended(key, reason = 'suspended') {
    if (!key) return;
    const cachedKey = keyCacheMap.get(key);
    if (cachedKey) {
        cachedKey.status = 'suspended';
        cachedKey.last_used_at = new Date().toISOString();
        pendingUpdates.add(key);
    }
    console.warn(`[KeyService] Marked key ${key.substring(0, 8)}... as suspended. Reason: ${reason}`);
}

function markKeyAsQuotaExceeded(key) {
    if (!key) return;
    // Calculate time until next midnight (UTC)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0); // Next UTC Midnight
    const duration = tomorrow.getTime() - now.getTime();
    
    // Add 1 hour buffer to be safe
    const safeDuration = duration + (60 * 60 * 1000);
    
    markKeyAsDead(key, safeDuration, 'quota_exceeded');
}

function isKeyAlive(key) {
    if (!deadKeys.has(key)) return true;
    const entry = deadKeys.get(key);
    
    // Check if expired
    if (Date.now() > entry.expiry) {
        deadKeys.delete(key); // Cooldown over
        return true;
    }
    return false;
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
    // If not set (null/0), assume UNLIMITED.
    
    // RPD (Requests Per Day) - Unified
    const rpdLimit = parseInt(keyData.rpd_limit); 
    
    // We use the key's total daily usage (regardless of model)
    // Only check if rpdLimit is a valid positive number
    if (rpdLimit > 0 && keyData.last_date_checked === today && (keyData.usage_today || 0) >= rpdLimit) {
        // console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPD limit (${rpdLimit})`);
        return false;
    }

    // RPM (Requests Per Minute) - Unified
    const rpmLimit = parseInt(keyData.rpm_limit);
    
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
        // console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPM limit (${rpmLimit})`);
        return false;
    }

    const rphLimit = parseInt(keyData.rph_limit);
    const hourTimestamps = keyUsageHourTimestamps.get(keyData.api) || [];
    const oneHourAgo = now - 60 * 60 * 1000;
    const validHourTimestamps = hourTimestamps.filter(ts => ts > oneHourAgo);

    if (validHourTimestamps.length !== hourTimestamps.length) {
        keyUsageHourTimestamps.set(keyData.api, validHourTimestamps);
    }

    if (rphLimit > 0 && validHourTimestamps.length >= rphLimit) {
        return false;
    }

    // --- 2. MODEL-LEVEL LIMITS (OPTIONAL/SECONDARY) ---
    // Only check model-specific limits if the key itself is fine.
    // This is useful if you want to limit "Gemini Vision" specifically to 1 RPM, but allow "Gemini Flash" 10 RPM.
    if (modelToCheck) {
        const manual = dynamicLimits.get(String(modelToCheck));
        if (manual) {
            // Strict Model RPD
            if (manual.rpd) {
                const daily = modelDailyUsage.get(modelToCheck) || { date: today, count: 0 };
                if (daily.date === today && daily.count >= manual.rpd) {
                    console.warn(`[KeyService] ⛔ Model ${modelToCheck} hit GLOBAL RPD limit (${manual.rpd})`);
                    return false;
                }
            }
            // Strict Model RPM
            if (manual.rpm) {
                const mTimestamps = modelUsageTimestamps.get(modelToCheck) || [];
                const mValid = mTimestamps.filter(ts => ts > oneMinuteAgo);
                if (mValid.length >= manual.rpm) {
                    console.warn(`[KeyService] ⛔ Model ${modelToCheck} hit GLOBAL RPM limit (${manual.rpm})`);
                    return false;
                }
            }
            if (manual.rph) {
                const oneHourAgo = now - 60 * 60 * 1000;
                const mHour = modelUsageHourTimestamps.get(modelToCheck) || [];
                const mHourValid = mHour.filter(ts => ts > oneHourAgo);
                if (mHourValid.length >= manual.rph) {
                    console.warn(`[KeyService] ⛔ Model ${modelToCheck} hit GLOBAL RPH limit (${manual.rph})`);
                    return false;
                }
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
        
        // Mark for batch update to DB
        pendingUpdates.add(apiKey);
    }
}

// Flush Usage Stats to Database (Called periodically)
async function flushUsageStats() {
    if (pendingUpdates.size === 0) return;

    // console.log(`[KeyService] Flushing usage stats for ${pendingUpdates.size} keys...`);
    const keysToUpdate = Array.from(pendingUpdates);
    pendingUpdates.clear();

    // OPTIMIZATION: Bulk Upsert to prevent Server Overload with 2400+ keys
    const updates = keysToUpdate.map(apiKey => {
        const cachedKey = keyCacheMap.get(apiKey);
        if (!cachedKey) return null;
        
        return {
            api: apiKey,
            usage_today: cachedKey.usage_today,
            usage_tokens_today: cachedKey.usage_tokens_today,
            last_date_checked: cachedKey.last_date_checked,
            last_used_at: cachedKey.last_used_at,
            status: cachedKey.status,
            provider: cachedKey.provider, 
            model: cachedKey.model
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
                `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`
            );
            values.push(
                u.api,
                u.usage_today,
                u.usage_tokens_today,
                u.last_date_checked,
                u.last_used_at,
                u.status,
                u.provider
            );
        });

        const queryText = `
            INSERT INTO api_list (api, usage_today, usage_tokens_today, last_date_checked, last_used_at, status, provider)
            VALUES ${valuePlaceholders.join(', ')}
            ON CONFLICT (api)
            DO UPDATE SET
                usage_today = EXCLUDED.usage_today,
                usage_tokens_today = EXCLUDED.usage_tokens_today,
                last_date_checked = EXCLUDED.last_date_checked,
                last_used_at = EXCLUDED.last_used_at,
                status = EXCLUDED.status
        `;

        await pgClient.query(queryText, values);
    } catch (err) {
        console.error(`[KeyService] Failed to flush stats`, err.message);
    }
}

// Update Key Status based on Response Headers
function updateKeyStatusFromHeaders(apiKey, headers) {
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
            markKeyAsDead(apiKey, timeoutMs, 'header_limit');
        }
    }
}

// 5. Smart Key Selection (Sequential Round-Robin)
// User Requirement: "total api jodi 1 - 100 ta take tahole 100 cross kore then 1 e asbe kintu 1 e ase jodi deke 24 er rate limit reset hoi ni engine work korbe na"
// Solution: Sequential Global Rotation.
// We maintain a global index for each Model/Provider combo.

const globalKeyPointers = new Map(); // Stores last used index for each "provider:model"

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
        // Fallback: If specific model keys not found, try provider generic keys
        if (keysByProvider.has(provider)) {
             candidates = keysByProvider.get(provider);
        }
        
        if (!candidates || candidates.length === 0) {
            console.warn(`[KeyService] No keys found for ${provider}/${model}`);
            return null;
        }
    }

    // Filter dead keys
    const validKeys = candidates.filter(k => isKeyAlive(k.api));

    if (validKeys.length === 0) {
        console.warn(`[KeyService] All keys dead for ${provider}/${model}`);
        return null;
    }

    // 2. SEQUENTIAL ROTATION LOGIC
    // Sort keys by ID to ensure consistent order (1, 2, 3...)
    // This is crucial for the "1-100 then back to 1" requirement.
    validKeys.sort((a, b) => a.id - b.id);

    const mapKey = `${provider}:${model}`;
    let currentIndex = globalKeyPointers.get(mapKey) || 0;
    
    // If index out of bounds (e.g. new keys added or removed), reset to 0
    if (currentIndex >= validKeys.length) {
        currentIndex = 0;
    }

    const minGapMs = KEY_MIN_GAP_MS > 0 ? (KEY_MIN_GAP_MS + Math.floor(Math.random() * (KEY_MIN_GAP_JITTER_MS + 1))) : 0;
    const now = Date.now();

    // Iterate through keys starting from Last Index
    // We check exactly ONCE through the list.
    for (let i = 0; i < validKeys.length; i++) {
        // Circular Index: (Start + i) % Length
        const actualIndex = (currentIndex + i) % validKeys.length;
        const candidateKey = validKeys[actualIndex];

        if (minGapMs > 0 && candidateKey.last_used_at) {
            const lastUsedMs = new Date(candidateKey.last_used_at).getTime();
            if (!Number.isNaN(lastUsedMs) && now - lastUsedMs < minGapMs) {
                continue;
            }
        }

        // Check if Key is usable (RPM/RPD)
        if (isKeyWithinLimits(candidateKey, model)) {
            
            // --- 24-HOUR RESET CHECK (Loop Back Safety) ---
            // User Requirement: "1 e ase jodi deke 24 er rate limit reset hoi ni engine work korbe na"
            // If we wrapped around (actualIndex < currentIndex), it means we finished the list.
            // We should be extra careful about reuse.
            
            // For now, isKeyWithinLimits handles the 24h check via RPD.
            // If RPD limit is reached, isKeyWithinLimits returns false.
            // So we don't need extra logic here, just ensure RPD limit is set correctly.
            
            // Update Pointer for next time (Next Key)
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
        const rpm = parseInt(limits.rpm) || 1000;
        const rpd = parseInt(limits.rpd) || 10000;
        const rph = parseInt(limits.rph) || 0;
        console.log(`[KeyService] ⚙️ Manually Setting Limits for ${modelId}: RPM=${rpm}, RPD=${rpd}, RPH=${rph}`);
        dynamicLimits.set(modelId, { rpm, rpd, rph, source: 'manual' });
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
