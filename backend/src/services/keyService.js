const dbService = require('./dbService');

const dynamicLimits = new Map();

let keyCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes

const DAILY_USAGE_LIMIT = 20;
const STATUS_ACTIVE = 'active';
const STATUS_DISABLED = 'disabled';
const DISABLE_DURATION_MS = 24 * 60 * 60 * 1000;

const deadKeys = new Map();
const DEFAULT_COOLDOWN = 60 * 1000; // 1 Minute default for RPM/TPM

const keyUsageMap = new Map(); 

const modelIndexMap = new Map();

const pendingUpdates = new Set();
// Flush Interval (Every 5 Seconds for better visibility)
setInterval(flushUsageStats, 5 * 1000);

// --- Background Cache Refresh (Every 5 Minutes) ---
// Proactively fetches new keys/limits from DB to keep memory fresh
setInterval(() => {
    console.log("[KeyService] Background cache refresh triggered.");
    updateKeyCache(true); // force = true
}, 5 * 60 * 1000);
// --------------------------------------------------

// --- Default Limits Map (Fallback if DB values are null) ---
// Based on typical Free Tier limits as of early 2025
const DEFAULT_LIMITS = {
    // Gemini Limits (Based on User Info)
    'gemini-1.5-flash': { rpm: 15, rpd: 1500 }, 
    'gemini-1.5-flash-8b': { rpm: 15, rpd: 1500 }, 
    
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
        lastCacheUpdate = now;
        console.log(`[KeyService] Cache updated. Total Keys: ${keys.length}`);
        
        // Optional: Clean up deadKeys map if a key is no longer in the DB
        for (const [key] of deadKeys) {
            if (!keys.find(k => k.api === key)) {
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
    
    // Determine Limits (DB > Dynamic > Default Map > Safe Fallback)
    let rpdLimit = keyDbObject.rpd_limit;
    let rpmLimit = keyDbObject.rpm_limit;

    if (!rpdLimit || !rpmLimit) {
        const dyn = dynamicLimits.get(keyDbObject.model);
        let fallbackDefault = DEFAULT_LIMITS['default'];
        if (keyDbObject.model && keyDbObject.model.endsWith(':free')) {
            fallbackDefault = { rpm: 20, rpd: 50 }; // Official OpenRouter Free Tier Limits
        }

        const modelDefaults = DEFAULT_LIMITS[keyDbObject.model] || fallbackDefault;
        
        if (!rpdLimit) rpdLimit = (dyn && dyn.rpd) ? dyn.rpd : modelDefaults.rpd;
        if (!rpmLimit) rpmLimit = (dyn && dyn.rpm) ? dyn.rpm : modelDefaults.rpm;
    }

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

    if (usageToday >= rpdLimit) {
        if (keyDbObject.provider === 'google' && keyDbObject.api) {
            markKeyAsQuotaExceeded(keyDbObject.api);
        }
        return false;
    }

    const minIntervalMs = 60000 / rpmLimit;
    
    const usageKey = `${keyDbObject.api}:${keyDbObject.model || 'default'}`;
    const lastUsed = keyUsageMap.get(usageKey) || 0;
    if (now - lastUsed < minIntervalMs) {
        // console.log(`Key ${keyDbObject.api.substring(0,6)}... hit RPM limit (Wait ${minIntervalMs - (now - lastUsed)}ms)`);
        return false;
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

    const cachedKey = keyCache.find(k => k.api === apiKey);

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
        const cachedKey = keyCache.find(k => k.api === apiKey);
        if (!cachedKey) return null;
        
        // We need to include 'api' for the upsert conflict target
        // And other required fields if they are missing (but we are updating, so it's fine)
        // Note: For upsert to work on 'api', it must be a unique constraint.
        // The schema usually has 'id' as PK, but we can try to use 'api' as match.
        // If 'api' is not unique constraint, we must fetch ID. 
        // Assuming 'api' is unique enough or we use loop fallback if upsert fails.
        
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

    // 2. Filter Keys from Memory Cache
    let validKeys = keyCache;

    // Filter by Provider
    if (provider) {
        if (provider === 'google' || provider === 'gemini') {
            validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
        } else {
            validKeys = validKeys.filter(k => k.provider === provider);
        }
    }

    // Filter by Model (Strict Match)
    let modelSpecificKeys = [];
    if (model) {
        modelSpecificKeys = validKeys.filter(k => k.model === model);
    }

    // RETRY LOGIC: If no keys found in cache, FORCE REFRESH from DB and try again
    if (model && modelSpecificKeys.length === 0) {
        // Prevent excessive DB hammering: Only force refresh if cache is older than 10 seconds
        if (Date.now() - lastCacheUpdate > 10000) {
            console.log(`[KeyService] No local keys found for ${provider}/${model}. Forcing DB refresh...`);
            await updateKeyCache(true);
            
            // Re-filter after refresh
            validKeys = keyCache;
            if (provider) {
                if (provider === 'google' || provider === 'gemini') {
                    validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
                } else {
                    validKeys = validKeys.filter(k => k.provider === provider);
                }
            }
            if (model) {
                modelSpecificKeys = validKeys.filter(k => k.model === model);
            }
        } else {
             // console.log(`[KeyService] No strict keys for ${model} and cache is fresh. Skipping refresh.`);
        }
    }

    // Use model-specific keys if available. 
    // STRICT MODE: If model is specified, we PREFER keys for that model.
    // BUT if no model-specific keys exist, we FALLBACK to ANY key for that provider.
    // This allows using a generic "google" key for any "gemini-*" model.
    if (model) {
        if (modelSpecificKeys.length > 0) {
            validKeys = modelSpecificKeys;
        } else {
            // RELAXED MODE: If we didn't find keys specifically labeled for this model,
            // we check if we have ANY keys for this provider.
            // Google keys are generally universal.
            if (validKeys.length > 0) {
                console.log(`[KeyService] No specific keys for ${model}. Using generic ${provider} keys.`);
                // validKeys is already filtered by provider, so we keep it.
            } else {
                console.warn(`[KeyService] No keys found for ${provider} (Specific or Generic). Returning null.`);
                return null;
            }
        }
    }
    // If model is NOT specified, we use any key for the provider (validKeys is already filtered by provider)

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
            
            pendingUpdates.add(candidateKey.api);
            
            modelIndexMap.set(mapKey, currentIndex);

            return {
                key: candidateKey.api,
                provider: candidateKey.provider,
                model: candidateKey.model
            };
        }
    }

    if (Date.now() - lastCacheUpdate > 5000) {
        console.log(`[KeyService] All cached keys are dead/limited. Forcing DB refresh to check for new keys...`);
        await updateKeyCache(true);
        
        // Re-fetch and Re-filter
        validKeys = keyCache;
        if (provider) {
             if (provider === 'google' || provider === 'gemini') {
                validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
            } else {
                validKeys = validKeys.filter(k => k.provider === provider);
            }
        }
        if (model) {
            validKeys = validKeys.filter(k => k.model === model);
        }
        for (let i = 0; i < validKeys.length; i++) {
            const candidateKey = validKeys[i];
            if (isKeyAlive(candidateKey.api) && isKeyWithinLimits(candidateKey)) {
                modelIndexMap.set(mapKey, (i + 1) % validKeys.length);
                return {
                    key: candidateKey.api,
                    provider: candidateKey.provider,
                    model: candidateKey.model
                };
            }
        }
    }

    // If still no valid key...
    console.warn(`[KeyService] All ${validKeys.length} keys for ${provider}/${model} are dead/limited.`);
    return null;
}

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
    report429, // Export 429 handler
    isModelLocked, // Export lock checker

    // Allow manual override from Config UI
    setManualLimit(modelId, { rpm, rpd }) {
        if (!modelId) return;
        console.log(`[KeyService] 🔧 Manual Limit Set for ${modelId}: RPM=${rpm}, RPD=${rpd}`);
        dynamicLimits.set(modelId, { rpm, rpd, source: 'manual' });
    },

    getLimitForModel: (modelId) => {
        const dyn = dynamicLimits.get(modelId);
        const def = DEFAULT_LIMITS[modelId] || DEFAULT_LIMITS['default'];
        if (dyn) return { ...def, ...dyn, source: 'realtime' };
        return { ...def, source: 'static' };
    }
};
