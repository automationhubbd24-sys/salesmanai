const dbService = require('./dbService');

const dynamicLimits = new Map();

let keyCache = []; // Keeping for backward compatibility if needed in loops
let keyCacheMap = new Map(); // NEW: Key lookup Map (apiKey -> object) for O(1) access
let keysByProvider = new Map();
let keysByModel = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 10 * 60 * 1000; // Increased to 10 Minutes for lower CPU

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
// Flush Interval (Increased to 10 Seconds to save CPU)
setInterval(flushUsageStats, 10 * 1000);

// --- Background Cache Refresh (Increased to 10 Minutes) ---
// Proactively fetches new keys/limits from DB to keep memory fresh
setInterval(() => {
    // console.log("[KeyService] Background cache refresh triggered.");
    updateKeyCache(true); // force = true
}, 10 * 60 * 1000);
// --------------------------------------------------

// --- Default Limits Map (Fallback if DB values are null) ---
// Based on typical Free Tier limits as of early 2025
const DEFAULT_LIMITS = {
    // Gemini Limits (Based on User Info)
    'gemini-2.0-flash': { rpm: 15, rpd: 1500 }, 
    'gemini-2.0-flash-lite': { rpm: 15, rpd: 1500 }, 
    'gemini-1.5-pro': { rpm: 2, rpd: 50 },
    
    // Groq Limits (Based on Official Docs)
    'llama-3.3-70b-versatile': { rpm: 30, rpd: 1000 }, // High Intelligence, Lower Daily Limit
    'llama-3.1-8b-instant': { rpm: 30, rpd: 14400 },   // High Speed, Massive Daily Limit
    
    // OpenRouter Free Limits (Safe Defaults)
    'arcee-ai/trinity-large-preview:free': { rpm: 9999, rpd: 9999 }, // TESTED: Survived 100+ requests (Unlimited)
    'upstage/solar-pro-3:free': { rpm: 20, rpd: 50 }, // TESTED: Hit limit at 25 requests (Not Unlimited)
    'liquid/lfm-2.5-1.2b-instruct:free': { rpm: 20, rpd: 50 }, // TESTED: Immediate 429
    'nvidia/nemotron-nano-12b-v2-vl:free': { rpm: 20, rpd: 50 }, // TESTED: Immediate 429
    'nousresearch/hermes-3-llama-3.1-405b:free': { rpm: 20, rpd: 50 }, // Huge model, likely strict limit
    'openrouter/default': { rpm: 1000, rpd: 10000 }, // High optimistic default
    
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

// Check if Key is within Limits (RPM, RPD)
function isKeyWithinLimits(keyDbObject) {
    if (isModelLocked(keyDbObject.model)) {
        return false;
    }

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    if (keyDbObject.status && keyDbObject.status !== STATUS_ACTIVE) {
        if (keyDbObject.status === STATUS_DISABLED && keyDbObject.last_used_at) {
            const disabledAt = new Date(keyDbObject.last_used_at).getTime();
            if (!Number.isNaN(disabledAt) && now - disabledAt >= DISABLE_DURATION_MS) {
                keyDbObject.status = STATUS_ACTIVE;
                keyDbObject.usage_today = 0;
                keyDbObject.last_date_checked = today;
                pendingUpdates.add(keyDbObject.api);
            } else {
                return false;
            }
        } else {
            return false;
        }
    }
    
    const dbDate = keyDbObject.last_date_checked;
    const usageToday = (dbDate === today) ? (keyDbObject.usage_today || 0) : 0;

    if ((keyDbObject.provider === 'google' || keyDbObject.provider === 'gemini') && usageToday >= DAILY_USAGE_LIMIT) {
        if (keyDbObject.status !== STATUS_DISABLED) {
            keyDbObject.status = STATUS_DISABLED;
            keyDbObject.last_used_at = new Date().toISOString();
            pendingUpdates.add(keyDbObject.api);
        }
        return false;
    }
    
    // Determine Limits (Manual/Dynamic > DB > Default Map > Safe Fallback)
    const dyn = dynamicLimits.get(keyDbObject.model);
    
    let rpdLimit = (dyn && dyn.rpd) ? dyn.rpd : keyDbObject.rpd_limit;
    let rpmLimit = (dyn && dyn.rpm) ? dyn.rpm : keyDbObject.rpm_limit;

    if (keyDbObject.provider === 'google' || keyDbObject.provider === 'gemini') {
        // For Google, we use strict global constants unless manual limit is LOWER
        rpdLimit = Math.min(GEMINI_RPD_LIMIT, rpdLimit || GEMINI_RPD_LIMIT);
        rpmLimit = Math.min(GEMINI_RPM_LIMIT, rpmLimit || GEMINI_RPM_LIMIT);
    } else if (!rpdLimit || !rpmLimit) {
        let fallbackDefault = DEFAULT_LIMITS['default'];
        if (keyDbObject.model && keyDbObject.model.endsWith(':free')) {
            fallbackDefault = { rpm: 20, rpd: 50 }; // Official OpenRouter Free Tier Limits
        }
        const modelDefaults = DEFAULT_LIMITS[keyDbObject.model] || fallbackDefault;
        
        if (!rpdLimit) rpdLimit = modelDefaults.rpd;
        if (!rpmLimit) rpmLimit = modelDefaults.rpm;
    }

    // Remove old dynamic Gemini limit logic as we now have strict constants
    /*
    if (keyDbObject.provider === 'google' || keyDbObject.provider === 'gemini') {
        if (!keyDbObject.rpd_limit || keyDbObject.rpd_limit > 20) {
            rpdLimit = 20;
        }

        const modelName = (keyDbObject.model || '').toLowerCase();
        const isLite = modelName.includes('lite');
        const targetRpm = isLite ? 10 : 5;

        if (!keyDbObject.rpm_limit || keyDbObject.rpm_limit > targetRpm) {
            rpmLimit = targetRpm;
        }
    }
    */

    if (usageToday >= rpdLimit) {
        if (keyDbObject.provider === 'google' && keyDbObject.api) {
            markKeyAsQuotaExceeded(keyDbObject.api);
        }
        return false;
    }

    // --- NEW: Global Model-Wide RPD Check ---
    // User Requirement: Total daily requests for a model must not exceed the limit set in Admin Config
    if (dyn && dyn.rpd) {
        const daily = modelDailyUsage.get(keyDbObject.model);
        if (daily && daily.date === today && daily.count >= dyn.rpd) {
            // console.log(`[KeyService] 🚫 Model-Wide RPD Limit Reached for ${keyDbObject.model} (${daily.count}/${dyn.rpd})`);
            return false;
        }
    }

    // --- NEW: Strict RPM Check (Sliding Window) ---
    // User Requirement: RPM limit MUST NOT be exceeded, even by one request.
    const timestamps = keyUsageTimestamps.get(keyDbObject.api) || [];
    
    // Clean up timestamps older than 60 seconds
    const minuteAgo = now - 60000;
    const recentTimestamps = timestamps.filter(ts => ts > minuteAgo);
    keyUsageTimestamps.set(keyDbObject.api, recentTimestamps);

    if (recentTimestamps.length >= rpmLimit) {
        // console.log(`[KeyService] 🚫 RPM Limit Reached for ${keyDbObject.api.substring(0,8)}... (${recentTimestamps.length}/${rpmLimit})`);
        return false;
    }

    // --- NEW: Global Model-Wide RPM Check ---
    // User Requirement: Total RPM for a model must not exceed the limit set in Admin Config
    if (dyn && dyn.rpm) {
        const modelTs = modelUsageTimestamps.get(keyDbObject.model) || [];
        const recentModelTs = modelTs.filter(ts => ts > minuteAgo);
        modelUsageTimestamps.set(keyDbObject.model, recentModelTs);
        
        if (recentModelTs.length >= dyn.rpm) {
            // console.log(`[KeyService] 🚫 Model-Wide RPM Limit Reached for ${keyDbObject.model} (${recentModelTs.length}/${dyn.rpm})`);
            return false;
        }
    }

    // 3. Check TPM (Tokens Per Minute)
    const tpmLimit = keyDbObject.tpm_limit || 0; // 0 means unchecked/unlimited by default for now
    if (tpmLimit > 0) {
        // Simple approximate check: If usageToday * avg_tokens > tpm? 
        // No, TPM requires a sliding window of actual token counts.
        // For now, we will skip complex TPM sliding window in memory to save RAM.
        // We will implement RPD (Requests) and TPD (Tokens Per Day) first.
    }

    // 4. Check TPD (Tokens Per Day)
    const tpdLimit = keyDbObject.tpd_limit || 0;
    const tokensToday = (dbDate === today) ? (keyDbObject.usage_tokens_today || 0) : 0;
    
    if (tpdLimit > 0 && tokensToday >= tpdLimit) {
        // console.log(`Key ${keyDbObject.api.substring(0,6)}... hit TPD limit (${tokensToday}/${tpdLimit})`);
        return false;
    }

    return true;
}

// Record Usage (Call this AFTER successful AI response)
async function recordKeyUsage(apiKey, tokenUsage = 0) {
    if (!apiKey) return;

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    const cachedKey = keyCacheMap.get(apiKey);

    if (cachedKey) {
        const usageKey = `${apiKey}:${cachedKey.model || 'default'}`;
        keyUsageMap.set(usageKey, now);
    } else {
        keyUsageMap.set(apiKey, now);
    }

    // 2. Update In-Memory Cache Object (Immediate Reflection for RPD/TPD)
    let newUsage = 1;
    let newTokens = tokenUsage;

    if (cachedKey) {
        if (cachedKey.last_date_checked === today) {
            // usage_today is already incremented in getSmartKey (Optimistic)
            // We only update tokens here.
            // cachedKey.usage_today = (cachedKey.usage_today || 0) + 1; 
            cachedKey.usage_tokens_today = (cachedKey.usage_tokens_today || 0) + tokenUsage;
            newUsage = cachedKey.usage_today;
            newTokens = cachedKey.usage_tokens_today;
        } else {
            // Date changed between getSmartKey and here? Unlikely but possible.
            cachedKey.last_date_checked = today;
            cachedKey.usage_today = 1; // Reset + 1 for this call? Or just 1 (from getSmartKey)? 
            // If getSmartKey was called yesterday, and this finishes today...
            // Safest to just set tokens.
            cachedKey.usage_tokens_today = tokenUsage;
            newUsage = 1;
            newTokens = tokenUsage;
        }
        cachedKey.last_used_at = new Date().toISOString();
        
        // Mark for batch update
        pendingUpdates.add(apiKey);
    }

    // 3. Update Database (Buffered/Batched)
    // Removed immediate DB call to prevent Supabase overload
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
        // If still no keys, try provider generic keys
        if (validKeys.length === 0 && provider) {
            validKeys = keysByProvider.get(provider) || [];
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
                validKeys = keysByModel.get(model) || (provider ? keysByProvider.get(provider) : []);
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

        if (isKeyAlive(candidateKey.api) && isKeyWithinLimits(candidateKey)) {
            const today = new Date().toISOString().split('T')[0];
            if (candidateKey.last_date_checked !== today) {
                candidateKey.last_date_checked = today;
                candidateKey.usage_today = 1;
                candidateKey.usage_tokens_today = 0;
            } else {
                candidateKey.usage_today = (candidateKey.usage_today || 0) + 1;
            }
            candidateKey.last_used_at = new Date().toISOString();
            
            // --- ATOMIC TIMESTAMP RECORDING ---
            // Record timestamp IMMEDIATELY before returning to prevent race condition
            const now = Date.now();
            
            // Per Key
            const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
            tsList.push(now);
            keyUsageTimestamps.set(candidateKey.api, tsList);

            // Per Model (Global)
            if (candidateKey.model) {
                // RPM
                const modelTs = modelUsageTimestamps.get(candidateKey.model) || [];
                modelTs.push(now);
                modelUsageTimestamps.set(candidateKey.model, modelTs);

                // RPD
                const daily = modelDailyUsage.get(candidateKey.model) || { date: today, count: 0 };
                if (daily.date === today) {
                    daily.count++;
                } else {
                    daily.date = today;
                    daily.count = 1;
                }
                modelDailyUsage.set(candidateKey.model, daily);
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

    // Final fallback (Try any generic provider key if specific model failed)
    if (model && provider) {
        const genericKeys = keysByProvider.get(provider) || [];
        // Already tried some of these if they were in the specific list, 
        // but this ensures we try all keys for the provider if model-specific fails.
        // To keep it fast, we only do this if validKeys was specifically filtered by model.
        if (validKeys !== genericKeys) {
             // Recursive call with model=null to try provider generic keys
             return getSmartKey(provider, null);
        }
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
    
    // NEW: Get filtered keys for Active Rotation Pool display
    getActiveRotationPool: (providerFilter = null, limit = 10) => {
        let keys = [];
        
        if (providerFilter) {
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

        // Return only top N keys (limit)
        return keys.slice(0, limit).map(k => ({
            id: k.id,
            provider: k.provider,
            model: k.model,
            api: k.api.substring(0, 12) + '***', // Mask key for safety
            status: k.status,
            usage_today: k.usage_today,
            last_used_at: k.last_used_at
        }));
    }
};
