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

const keyUsageMap = new Map(); 

const keyUsageTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 seconds
const modelUsageTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 seconds
const modelDailyUsage = new Map(); // Key: modelName, Value: { date: string, count: number }

const modelIndexMap = new Map();

const pendingUpdates = new Set();
// Flush Interval (Increased to 30 Seconds to save CPU)
setInterval(flushUsageStats, 30 * 1000);

// --- Background Cache Refresh (30 Minutes) ---
// Proactively fetches new keys/limits from DB to keep memory fresh
setInterval(() => {
    // console.log("[KeyService] Background cache refresh triggered.");
    updateKeyCache(true); // force = true
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

function report429(modelName) {
    if (!modelName) return;
    const now = Date.now();
    const state = modelLockMap.get(modelName) || { expiry: 0, strikes: 0 };
    
    // If previous lock expired long ago (e.g. > 1 hour since expiry), reset strikes?
    // For now, strict adherence to user rule: 
    // 1st hit -> 2 min
    // 2nd hit (after retry) -> 24 hours
    
    // Check if we are "escalating" a recent failure
    if (state.strikes === 0) {
        // First offense
        state.strikes = 1;
        state.expiry = now + 2 * 60 * 1000; // 2 Minutes
        console.warn(`[KeyService] 🔒 Locking ${modelName} for 2 minutes (First 429)`);
    } else {
        // Second offense (Consecutive or shortly after unlock)
        state.strikes = 2; 
        state.expiry = now + 24 * 60 * 60 * 1000; // 24 Hours
        console.warn(`[KeyService] 🔒 Locking ${modelName} for 24 HOURS (Repeated 429)`);
    }
    
    modelLockMap.set(modelName, state);
}

function isModelLocked(modelName) {
    if (!modelName) return false;
    const state = modelLockMap.get(modelName);
    if (!state) return false;
    
    if (Date.now() < state.expiry) {
        // console.log(`[KeyService] Model ${modelName} is LOCKED until ${new Date(state.expiry).toLocaleTimeString()}`);
        return true;
    }
    return false;
}

// --- Helper: Update Cache ---
async function updateKeyCache(force = false) {
    const now = Date.now();
    if (!force && now - lastCacheUpdate < CACHE_TTL && keyCache.length > 0) {
        return; // Cache is fresh
    }

    console.log("[KeyService] Refreshing API Key Cache from DB...");
    
    const pgClient = require('./pgClient');
    let keys = [];
    let error = null;

    try {
        const result = await pgClient.query(
            'SELECT * FROM api_list ORDER BY id ASC',
            []
        );
        keys = result.rows || [];
    } catch (e) {
        error = e;
    }

    if (keys && keys.length > 0) {
        const now = Date.now();
        const filtered = [];
        for (const k of keys) {
            // Log for debugging: check if any salesmanchatbot-flash/lite specific keys exist
            if (k.text_model || k.vision_model || k.voice_model) {
                 // console.log(`[KeyService] Found Role-Specific Key: ${k.api.substring(0,8)}... for ${k.text_model || k.vision_model || k.voice_model}`);
            }

            if (k.status && k.status !== STATUS_ACTIVE) {
                if (k.status === STATUS_DISABLED && k.last_used_at) {
                    const disabledAt = new Date(k.last_used_at).getTime();
                    if (!Number.isNaN(disabledAt) && now - disabledAt >= DISABLE_DURATION_MS) {
                        k.status = STATUS_ACTIVE;
                        k.usage_today = 0;
                        k.last_date_checked = new Date().toISOString().split('T')[0];
                        pendingUpdates.add(k.api);
                        filtered.push(k);
                    }
                    continue;
                }
                continue;
            }
            filtered.push(k);
        }
        keys = filtered;
    }

    if (error) {
        console.error("[KeyService] Failed to refresh key cache:", error.message);
        return;
    }

    if (keys) {
        keyCache = keys;
        
        // --- NEW: Pre-index keys for faster access (O(1) lookups) ---
        const newKeyCacheMap = new Map();
        const newKeysByProvider = new Map();
        const newKeysByModel = new Map();
        
        keys.forEach(k => {
            // Index by API Key (Direct Map Lookup)
            newKeyCacheMap.set(k.api, k);

            // Index by Provider
            const provider = k.provider || 'unknown';
            if (!newKeysByProvider.has(provider)) newKeysByProvider.set(provider, []);
            newKeysByProvider.get(provider).push(k);
            
            // Handle Google/Gemini alias
            if (provider === 'google' || provider === 'gemini') {
                if (!newKeysByProvider.has('google')) newKeysByProvider.set('google', []);
                if (!newKeysByProvider.has('gemini')) newKeysByProvider.set('gemini', []);
                // Add to both if not already added by primary provider
                if (provider === 'google') newKeysByProvider.get('gemini').push(k);
                else newKeysByProvider.get('google').push(k);
            }

            // Index by Model
            const model = k.model || 'default';
            if (!newKeysByModel.has(model)) newKeysByModel.set(model, []);
            newKeysByModel.get(model).push(k);

            // Index by Specific Roles (from engine configs)
            if (k.text_model) {
                if (!newKeysByModel.has(k.text_model)) newKeysByModel.set(k.text_model, []);
                newKeysByModel.get(k.text_model).push(k);
            }
            if (k.vision_model) {
                if (!newKeysByModel.has(k.vision_model)) newKeysByModel.set(k.vision_model, []);
                newKeysByModel.get(k.vision_model).push(k);
            }
            if (k.voice_model) {
                if (!newKeysByModel.has(k.voice_model)) newKeysByModel.set(k.voice_model, []);
                newKeysByModel.get(k.voice_model).push(k);
            }
        });

        keyCacheMap = newKeyCacheMap;
        keysByProvider = newKeysByProvider;
        keysByModel = newKeysByModel;
        
        lastCacheUpdate = now;
        // console.log(`[KeyService] Cache updated. Total Keys: ${keys.length}`);
        
        // --- NEW: Efficient deadKeys cleanup ---
        for (const [key] of deadKeys) {
            if (!keyCacheMap.has(key)) {
                deadKeys.delete(key);
            }
        }
    }
}

function markKeyAsDead(key, duration = DEFAULT_COOLDOWN, reason = 'unknown') {
    if (!key) return;
    const expiry = Date.now() + duration;
    console.warn(`[KeyService] Blocking key ${key.substring(0, 8)}... for ${(duration/1000).toFixed(1)}s. Reason: ${reason}`);
    deadKeys.set(key, { expiry, reason });
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

    // --- 1. KEY-LEVEL LIMITS (STRICT) ---
    // User Requirement: RPM and RPD must be followed strictly.
    const rpmLimit = parseInt(keyData.rpm_limit) || 3;
    const rpdLimit = parseInt(keyData.rpd_limit) || 1000; // Large default if not set

    // Check RPD (Requests Per Day)
    if (keyData.last_date_checked === today && (keyData.usage_today || 0) >= rpdLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPD limit (${rpdLimit})`);
        return false;
    }

    // Check RPM (Requests Per Minute)
    const timestamps = keyUsageTimestamps.get(keyData.api) || [];
    const oneMinuteAgo = now - 60000;
    const validTimestamps = timestamps.filter(ts => ts > oneMinuteAgo);
    
    // Cleanup old timestamps
    if (validTimestamps.length !== timestamps.length) {
        keyUsageTimestamps.set(keyData.api, validTimestamps);
    }

    if (validTimestamps.length >= rpmLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPM limit (${rpmLimit})`);
        return false;
    }

    // --- 2. MODEL-LEVEL LIMITS (STRICT) ---
    // Check limits for the requested model (e.g. from Global Config)
    if (modelToCheck) {
        const manual = dynamicLimits.get(modelToCheck);
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
        }
    }

    return true;
}

// Record Usage (Call this AFTER successful AI response to track tokens)
async function recordKeyUsage(apiKey, tokenUsage = 0) {
    if (!apiKey) return;

    const cachedKey = keyCacheMap.get(apiKey);

    if (cachedKey) {
        const usageKey = `${apiKey}:${cachedKey.model || 'default'}`;
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
            const current = dynamicLimits.get(keyInfo.model) || {};
            // Only update if it's different to avoid spamming
            if (current.rpm !== parseInt(limitCap)) {
                console.log(`[KeyService] 🧠 Learned Real-Time Limit for ${keyInfo.model}: ${limitCap} RPM (Config was ${DEFAULT_LIMITS[keyInfo.model]?.rpm || 'unknown'})`);
                dynamicLimits.set(keyInfo.model, { ...current, rpm: parseInt(limitCap) });
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

// Smart Key Rotation (Serial Round Robin + Health Check)
async function getSmartKey(provider, model) {
    // 1. Ensure Cache is Fresh
    await updateKeyCache();

    // 2. USE PRE-INDEXED MAPS FOR O(1) LOOKUP (Fast selection)
    let validKeys = [];

    if (model) {
        validKeys = keysByModel.get(model) || [];
        // Fallback: If no keys found for specific model, try 'default' model keys for the same provider
        if (validKeys.length === 0 && provider) {
            const providerKeys = keysByProvider.get(provider) || [];
            validKeys = providerKeys.filter(k => !k.model || k.model === 'default');
        }
    } else if (provider) {
        validKeys = keysByProvider.get(provider) || [];
    } else {
        validKeys = keyCache; // Fallback to all (unlikely)
    }

    if (validKeys.length === 0) {
        // RETRY LOGIC: If no keys found in cache, FORCE REFRESH from DB and try again
        // Prevent excessive DB hammering: Only force refresh if cache is older than 10 seconds
        if (Date.now() - lastCacheUpdate > 10000) {
            // console.log(`[KeyService] No local keys found for ${provider}/${model}. Forcing DB refresh...`);
            await updateKeyCache(true);
            
            // Try again after refresh
            if (model) {
                validKeys = keysByModel.get(model) || [];
                // Fallback after refresh
                if (validKeys.length === 0 && provider) {
                    const providerKeys = keysByProvider.get(provider) || [];
                    validKeys = providerKeys.filter(k => !k.model || k.model === 'default');
                }
            } else if (provider) {
                validKeys = keysByProvider.get(provider) || [];
            }
        }
    }

    if (validKeys.length === 0) {
        // console.warn(`[KeyService] No keys found for ${provider} (Specific or Generic). Returning null.`);
        return null;
    }

    const mapKey = `${provider || 'all'}:${model || 'all'}`;
    let currentIndex = modelIndexMap.get(mapKey) || 0;
    
    if (currentIndex >= validKeys.length) {
        currentIndex = 0;
    }

    for (let i = 0; i < validKeys.length; i++) {
        const candidateKey = validKeys[currentIndex];

        if (isKeyAlive(candidateKey.api) && isKeyWithinLimits(candidateKey, model)) {
            // --- ATOMIC TIMESTAMP RECORDING (RPM Check) ---
            const now = Date.now();
            const today = new Date().toISOString().split('T')[0];
            
            // Per Key RPM
            const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
            tsList.push(now);
            keyUsageTimestamps.set(candidateKey.api, tsList);

            // Per Model RPM (Global)
            const modelToIncrement = model || candidateKey.model;
            if (modelToIncrement) {
                const modelTs = modelUsageTimestamps.get(modelToIncrement) || [];
                modelTs.push(now);
                modelUsageTimestamps.set(modelToIncrement, modelTs);
            }

            // --- USAGE COUNTING (Every Call Attempt) ---
            // User Request: "jotobar ai call diba totobar countut hobe"
            candidateKey.usage_count = (candidateKey.usage_count || 0) + 1;
            if (candidateKey.last_date_checked === today) {
                candidateKey.usage_today = (candidateKey.usage_today || 0) + 1;
            } else {
                candidateKey.last_date_checked = today;
                candidateKey.usage_today = 1;
            }
            candidateKey.last_used_at = new Date().toISOString();

            // --- MODEL-WIDE RPD INCREMENT ---
            if (modelToIncrement) {
                const daily = modelDailyUsage.get(modelToIncrement) || { date: today, count: 0 };
                if (daily.date === today) {
                    daily.count++;
                } else {
                    daily.date = today;
                    daily.count = 1;
                }
                modelDailyUsage.set(modelToIncrement, daily);
            }

            pendingUpdates.add(candidateKey.api);
            
            modelIndexMap.set(mapKey, (currentIndex + 1) % validKeys.length);

            return {
                key: candidateKey.api,
                provider: candidateKey.provider,
                model: candidateKey.model
            };
        }
        
        currentIndex = (currentIndex + 1) % validKeys.length;
    }

    return null;
}

// --- 24. Initialization ---
// Populate the cache immediately on server start
updateKeyCache(true);

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
        dynamicLimits.set(modelId, { rpm: newLimit, rpd: 10000 }); // Keep RPD high, focus on RPM

        // 4. (Optional) Persist to DB? 
        // For now, in-memory is safer to avoid thrashing DB on every 429. 
        // It will reset on restart, which is good for recovering from temporary outages.
    },

    getManagedKey: () => null, 
    getAllManagedKeys: () => [], 
    getSmartKey, 
    markKeyAsDead,
    markKeyAsQuotaExceeded,
    recordKeyUsage,
    updateKeyStatusFromHeaders,
    updateKeyCache, // Export this!
    flushUsageStats, // Export this!
    report429, 
    isModelLocked,
    setManualLimit(modelId, limits) {
        if (!modelId || !limits) return;
        const rpm = parseInt(limits.rpm) || 1000;
        const rpd = parseInt(limits.rpd) || 10000;
        console.log(`[KeyService] ⚙️ Manually Setting Limits for ${modelId}: RPM=${rpm}, RPD=${rpd}`);
        dynamicLimits.set(modelId, { rpm, rpd, source: 'manual' });
    },
    getLimitForModel: (modelId) => {
        const dyn = dynamicLimits.get(modelId);
        const def = DEFAULT_LIMITS[modelId] || DEFAULT_LIMITS['default'];
        if (dyn) return { ...def, ...dyn, source: 'realtime' };
        return { ...def, source: 'static' };
    },
    
    // NEW: Get filtered keys for Active Rotation Pool display with pagination
    getActiveRotationPool: (providerFilter = null, page = 1, limit = 10) => {
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

        const total = keys.length;
        const offset = (page - 1) * limit;
        const paginatedKeys = keys.slice(offset, offset + limit);

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
                last_used_at: k.last_used_at
            }))
        };
    }
};
