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
const CACHE_TTL = 15 * 1000; // Updated to 15 Seconds for higher accuracy in multi-process environments

// --- PROVIDER-SPECIFIC HARDCODED DEFAULTS (User Request) ---
const PROVIDER_DEFAULTS = {
    google:  { rpm: 1, rph: 1, rpd: 15, tpm: 250000, tpd: 999999, tpmo: 999999 },
    gemini:  { rpm: 1, rph: 1, rpd: 15, tpm: 250000, tpd: 999999, tpmo: 999999 },
    mistral: { rpm: 999999, rph: 999999, rpd: 999999, tpm: 50000, tpd: 999999, tpmo: 4000000 },
    groq:    { rpm: 30, rph: 999999, rpd: 1000, tpm: 15000, tpd: 500000, tpmo: 999999 },
    default: { rpm: 999999, rph: 999999, rpd: 999999, tpm: 999999, tpd: 999999, tpmo: 999999 }
};

const STATUS_ACTIVE = 'active';
const STATUS_DISABLED = 'disabled';
const DISABLE_DURATION_MS = 24 * 60 * 60 * 1000;

const deadKeys = new Map();
const DEFAULT_COOLDOWN = 24 * 60 * 60 * 1000; // 24 Hours default for all locks as per User Request
const KEY_MIN_GAP_MS = process.env.KEY_MIN_GAP_MS ? parseInt(process.env.KEY_MIN_GAP_MS, 10) : 900;
const KEY_MIN_GAP_JITTER_MS = process.env.KEY_MIN_GAP_JITTER_MS ? parseInt(process.env.KEY_MIN_GAP_JITTER_MS, 10) : 400;

// --- CUSTOM RESET WINDOWS (User Request) ---
const RPM_WINDOW_MS = 70 * 1000; // 70 Seconds
const RPH_WINDOW_MS = 70 * 60 * 1000; // 1 Hour 10 Minutes
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 Hours
const TPM_WINDOW_MS = 60 * 1000; // 60 Seconds for Tokens

const keyUsageMap = new Map(); 

const keyUsageTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 seconds
const keyTokenUsageTimestamps = new Map(); // Key: apiKey, Value: Array of { ts: number, tokens: number } in last 60s
const keyUsageHourTimestamps = new Map(); // Key: apiKey, Value: Array of timestamps in the last 60 minutes
const modelUsageTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 seconds
const modelUsageHourTimestamps = new Map(); // Key: modelName, Value: Array of timestamps in the last 60 minutes
const modelDailyUsage = new Map(); // Key: modelName, Value: { date: string, count: number }

const modelIndexMap = new Map();
const globalKeyPointers = new Map(); // mapKey -> lastUsedIndex
const pendingUpdates = new Map(); // apiKey -> { usage_delta, token_delta, last_used_at, status, cooldown_until }
let flushPromise = null;

// --- SMART ROTATION HELPERS (User Request: Email-first Rotation) ---

/**
 * Shuffles an array in place using Fisher-Yates algorithm.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Interleaves API keys by email to ensure consecutive requests use different emails.
 * Step 1: Group keys by email.
 * Step 2: Shuffle email order.
 * Step 3: Shuffle keys within each email group.
 * Step 4: Interleave keys from each group.
 */
function smartInterleaveByEmail(keys) {
    if (!keys || keys.length <= 1) return keys;

    // 1. Group by Email
    const groups = new Map();
    keys.forEach(k => {
        const email = (k.email || 'unknown').toLowerCase();
        if (!groups.has(email)) groups.set(email, []);
        groups.get(email).push(k);
    });

    // 2. Shuffle Email List
    const emails = Array.from(groups.keys());
    shuffleArray(emails);

    // 3. Shuffle keys within each group
    emails.forEach(email => {
        shuffleArray(groups.get(email));
    });

    // 4. Interleave
    const interleaved = [];
    let hasMore = true;
    let round = 0;

    while (hasMore) {
        hasMore = false;
        emails.forEach(email => {
            const group = groups.get(email);
            if (round < group.length) {
                interleaved.push(group[round]);
                hasMore = true;
            }
        });
        round++;
    }

    return interleaved;
}

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
        const thisMonth = today.substring(0, 7); // YYYY-MM

        // --- NEW: ENSURE MODEL-SPECIFIC USAGE TABLE EXISTS (Migration on-the-fly) ---
        try {
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS public.api_key_model_usage (
                    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    api_key_id BIGINT REFERENCES api_list(id) ON DELETE CASCADE,
                    model_name TEXT NOT NULL,
                    usage_today INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active',
                    cooldown_until TIMESTAMP WITH TIME ZONE,
                    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    last_date_checked DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(api_key_id, model_name)
                );
                CREATE INDEX IF NOT EXISTS idx_api_model_usage_key_id ON api_key_model_usage(api_key_id);
                CREATE INDEX IF NOT EXISTS idx_api_model_usage_model_name ON api_key_model_usage(model_name);
                CREATE INDEX IF NOT EXISTS idx_api_model_usage_status ON api_key_model_usage(status);

                -- ADD FALLBACK COLUMNS TO api_engine_configs IF THEY DON'T EXIST
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='text_fallback_model') THEN
                        ALTER TABLE api_engine_configs ADD COLUMN text_fallback_model TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='voice_fallback_model') THEN
                        ALTER TABLE api_engine_configs ADD COLUMN voice_fallback_model TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='vision_fallback_model') THEN
                        ALTER TABLE api_engine_configs ADD COLUMN vision_fallback_model TEXT;
                    END IF;

                    -- ADD FALLBACK COLUMNS TO engine_configs IF THEY DON'T EXIST (For Branded Engines)
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='engine_configs' AND column_name='text_fallback_model') THEN
                        ALTER TABLE engine_configs ADD COLUMN text_fallback_model TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='engine_configs' AND column_name='voice_fallback_model') THEN
                        ALTER TABLE engine_configs ADD COLUMN voice_fallback_model TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='engine_configs' AND column_name='image_fallback_model') THEN
                        ALTER TABLE engine_configs ADD COLUMN image_fallback_model TEXT;
                    END IF;
                END $$;
            `);
        } catch (e) {
            console.warn(`[KeyService] Migration error (Table might already exist):`, e.message);
        }
        
        // --- SMART AUTO-RESET: Clear expired locks and reset usage for new Pacific Day/Month ---
        const resetResult = await pgClient.query(
            `UPDATE api_list 
             SET 
                status = 'active', 
                cooldown_until = NULL,
                usage_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_today END,
                usage_user_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_user_today END,
                usage_system_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_system_today END,
                usage_tokens_today = CASE WHEN last_date_checked != $1 THEN 0 ELSE usage_tokens_today END,
                usage_tokens_month = CASE WHEN last_month_checked != $2 THEN 0 ELSE usage_tokens_month END,
                last_date_checked = CASE WHEN last_date_checked != $1 THEN $1 ELSE last_date_checked END,
                last_month_checked = CASE WHEN last_month_checked != $2 THEN $2 ELSE last_month_checked END
             WHERE (
                (cooldown_until IS NOT NULL AND cooldown_until < NOW()) 
                OR (last_date_checked != $1 AND status != 'locked')
                OR (last_month_checked != $2)
                OR (status = 'locked' AND cooldown_until IS NULL AND last_used_at < (NOW() - interval '24 hours'))
             )
             AND status != 'disabled'`,
            [today, thisMonth]
        );
        if (resetResult.rowCount > 0) {
            console.log(`[KeyService] ♻️ Auto-reset ${resetResult.rowCount} keys whose 24h lock/cooldown expired.`);
        }

        // --- NEW: AUTO-RESET MODEL-SPECIFIC LOCKS (User Request Upgrade) ---
        await pgClient.query(
            `UPDATE api_key_model_usage 
             SET status = 'active', cooldown_until = NULL, usage_today = 0, last_date_checked = $1
             WHERE (cooldown_until IS NOT NULL AND cooldown_until < NOW()) 
             OR (last_date_checked != $1)`,
            [today]
        );

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

        // --- SMART INTERLEAVING BY EMAIL (User Request) ---
        // We interleave the keys in providerMap and modelMap so that Sequential Rotation naturally picks different emails.
        providerMap.forEach((keys, provider) => {
            providerMap.set(provider, smartInterleaveByEmail(keys));
            
            // Debug Log: First 5 interleaved keys for this provider
            const debugList = providerMap.get(provider).slice(0, 5).map(k => `${k.email}(${k.api.substring(0,6)})`).join(' -> ');
            console.log(`[KeyService] Interleaved Pool for ${provider}: ${debugList}... (Total: ${keys.length})`);
        });

        modelMap.forEach((keys, model) => {
            modelMap.set(model, smartInterleaveByEmail(keys));
        });

        keysByProvider = providerMap;
        keysByModel = modelMap;

        // --- NEW: LOAD GLOBAL LIMITS FROM api_engine_configs (User Request) ---
        // We sync limits set in 'Global Provider Models Configuration' UI to dynamicLimits map.
        const configResult = await pgClient.query("SELECT * FROM api_engine_configs");
        if (configResult.rows && configResult.rows.length > 0) {
            configResult.rows.forEach(cfg => {
                const provider = String(cfg.provider || '').toLowerCase();
                const modalities = ['text', 'vision', 'voice'];
                
                // 1. Process Legacy Single-Model Fields (Backward Compatibility)
                modalities.forEach(mod => {
                    const modelName = (cfg[`${mod}_model`] || '').toLowerCase();
                    const limits = {
                        rpm: cfg[`${mod}_rpm`],
                        rpd: cfg[`${mod}_rpd`],
                        rph: cfg[`${mod}_rph`],
                        tpm: cfg[`${mod}_tpm`],
                        tpd: cfg[`${mod}_tpd`],
                        tpmo: cfg[`${mod}_tpmo`],
                        source: 'global_config'
                    };

                    if (modelName) {
                        // Store both model-only and modality-specific for maximum flexibility
                        dynamicLimits.set(modelName, limits);
                        dynamicLimits.set(`${modelName}:${mod}`, limits);
                    }
                    
                    if (mod === 'text' && provider) {
                        dynamicLimits.set(provider, limits);
                        dynamicLimits.set(`${provider}:${mod}`, limits);
                    }
                });

                // 2. Process NEW Dynamic Model Lists (JSONB)
                modalities.forEach(mod => {
                    const listField = `${mod}_models_list`;
                    const modelList = Array.isArray(cfg[listField]) ? cfg[listField] : [];
                    
                    modelList.forEach(mCfg => {
                        const mName = String(mCfg.model || mCfg.model_name || '').toLowerCase();
                        if (mName) {
                            const limits = {
                                rpm: mCfg.rpm || mCfg.rpm_limit || 0,
                                rpd: mCfg.rpd || mCfg.rpd_limit || 0,
                                rph: mCfg.rph || mCfg.rph_limit || 0,
                                tpm: mCfg.tpm || mCfg.tpm_limit || 0,
                                tpd: mCfg.tpd || mCfg.tpd_limit || 0,
                                tpmo: mCfg.tpmo || mCfg.tpmo_limit || 0,
                                source: 'global_dynamic_list'
                            };
                            // Store modality-specific key to avoid cross-modality limit leaks
                            dynamicLimits.set(`${mName}:${mod}`, limits);
                            // Also store model-only as fallback
                            if (!dynamicLimits.has(mName)) {
                                dynamicLimits.set(mName, limits);
                            }
                        }
                    });
                });
            });
            console.log(`[KeyService] 🧠 Synced Modality-Aware Global & Dynamic Limits for ${configResult.rows.length} providers.`);
        }

        // --- NEW: LOAD MODEL-SPECIFIC LOCKS & USAGE (User Request Upgrade: Persistent Storage) ---
        const modelLockResult = await pgClient.query(
            "SELECT amu.*, al.api FROM api_key_model_usage amu JOIN api_list al ON amu.api_key_id = al.id"
        );
        if (modelLockResult.rows && modelLockResult.rows.length > 0) {
            modelLockResult.rows.forEach(row => {
                const lockKey = `${row.api}:${row.model_name.toLowerCase()}`;
                
                // 1. Load Usage (Persistent) - Robust Date Comparison
                const rowDateStr = row.last_date_checked ? new Date(row.last_date_checked).toISOString().split('T')[0] : null;
                
                if (rowDateStr === today) {
                    modelDailyUsage.set(lockKey, { date: today, count: Number(row.usage_today) || 0 });
                } else {
                    modelDailyUsage.set(lockKey, { date: today, count: 0 });
                }

                // 2. Load Locks
                if (row.status === 'locked') {
                    const expiry = row.cooldown_until ? new Date(row.cooldown_until).getTime() : Date.now() + 24 * 60 * 60 * 1000;
                    if (expiry > nowMs) {
                        modelLockMap.set(lockKey, { expiry, reason: 'persisted_lock' });
                    }
                }
            });
            console.log(`[KeyService] 🔒 Synced ${modelLockResult.rows.length} model-specific usage/lock records from database.`);
        }

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

// Flush Interval (Increased to 10 Seconds for better accuracy)
setInterval(flushUsageStats, 10 * 1000);

// Background Cache Refresh (Every 15 Seconds for cross-process accuracy)
setInterval(() => {
    updateKeyCache(true).catch(err => console.error(`[KeyService] Background cache refresh failed:`, err.message));
}, 15 * 1000);

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
    // Gemini Limits (Based on Official Docs - Restricted per User Request)
    'gemini-1.5-flash': { rpm: 1, rph: 1, rpd: 15 }, 
    'gemini-1.5-flash-8b': { rpm: 1, rph: 1, rpd: 15 }, 
    'gemini-2.0-flash-exp': { rpm: 1, rph: 1, rpd: 15 },
    'gemini-2.0-flash-lite-preview-02-05': { rpm: 1, rph: 1, rpd: 15 },
    'gemini-2.0-flash': { rpm: 1, rph: 1, rpd: 15 }, 
    'google-gemini': { rpm: 1, rph: 1, rpd: 15 },
    
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

// Check if a model is globally or key-specifically locked
function isModelLocked(modelName, apiKey = null) {
    if (!modelName) return false;
    
    const now = Date.now();
    
    // 1. Check GLOBAL Model Lock
    const globalState = modelLockMap.get(modelName);
    if (globalState && now < globalState.expiry) {
        return true;
    }

    // 2. Check KEY-SPECIFIC Model Lock
    if (apiKey) {
        const lockKey = `${apiKey}:${modelName}`;
        const keyModelState = modelLockMap.get(lockKey);
        if (keyModelState && now < keyModelState.expiry) {
            return true;
        }
    }

    return false;
}

// Helper to mark a specific model as dead on a specific key
async function markModelAsDead(apiKey, modelName, duration = DEFAULT_COOLDOWN, reason = 'unknown') {
    if (!apiKey || !modelName) return;
    
    const now = Date.now();
    const expiry = now + duration;
    const expiryDate = new Date(expiry);
    const lockKey = `${apiKey}:${modelName}`;
    
    console.warn(`[KeyService] 🔒 Locking model ${modelName} on key ${apiKey.substring(0,8)}... for ${(duration/1000/60).toFixed(1)} mins. Reason: ${reason}`);
    
    // Update In-Memory Map
    modelLockMap.set(lockKey, { expiry, reason });

    // --- IMMEDIATE DB UPDATE for model-specific lock ---
    try {
        const pgClient = require('./pgClient');
        
        const query = "INSERT INTO api_key_model_usage (api_key_id, model_name, status, cooldown_until, last_used_at) SELECT id, $2, 'locked', $3, NOW() FROM api_list WHERE api = $1 ON CONFLICT (api_key_id, model_name) DO UPDATE SET status = 'locked', cooldown_until = $3, last_used_at = NOW()";
        
        const params = [apiKey, modelName, expiryDate.toISOString()];
        await pgClient.query(query, params);
        console.log(`[KeyService] 💾 Persisted model-specific lock for ${modelName} on ${apiKey.substring(0,8)}...`);
    } catch (err) {
        console.error(`[KeyService] Failed to persist model-specific lock:`, err.message);
    }
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

async function handleApiKeyError(key, error, modelName = null, modality = 'text') {
    if (!key) return;
    const errorStr = String(error).toLowerCase();
    
    // --- SMART 429 DETECTION (FOR ALL PROVIDERS) ---
    if (errorStr.includes('429') || 
        errorStr.includes('too many requests') || 
        errorStr.includes('rate limit') ||
        errorStr.includes('status code 429')) {
        
        const isDailyQuota = errorStr.includes('perday') || 
                             errorStr.includes('quota exceeded') || 
                             errorStr.includes('quotavalue') ||
                             errorStr.includes('daily limit');

        const keyData = keyCacheMap.get(key);
        const provider = (keyData?.provider || 'unknown').toLowerCase();
        const model = (modelName || keyData?.model || 'default').toLowerCase();

        if (isDailyQuota) {
            console.warn(`[KeyService] 🚨 Daily Quota Exceeded for ${key.substring(0,8)}... Locking ENTIRE KEY until Midnight.`);
            await markKeyAsQuotaExceeded(key);
        } else {
            // User Request Upgrade: Lock ONLY the specific model for this key, not the whole key
            console.warn(`[KeyService] 🔒 Rate Limit (429) hit for model ${model} on key ${key.substring(0,8)}... locking MODEL ONLY.`);
            await markModelAsDead(key, model, getMsUntilPacificMidnight(), `model_rate_limit_429_${model}`);
        }
        
        await updateKeyCache(true);
        return;
    }

    if (errorStr.includes('401') || errorStr.includes('invalid api key') || errorStr.includes('expired') || 
        errorStr.includes('402') || errorStr.includes('insufficient balance') || errorStr.includes('billing')) {
        console.error(`[KeyService] 💀 Key ${key.substring(0,8)}... is DEAD (401/402/Invalid). Locking for 24h.`);
        // User Request: All Dead/Locked keys should reset after 24h
        const twentyFourHours = 24 * 60 * 60 * 1000;
        await markKeyAsDead(key, twentyFourHours, 'invalid_or_no_balance_24h_reset'); 
        return;
    }

    // --- NEW: POLICY VIOLATION DETECTION (Google/OpenRouter) ---
    if (errorStr.includes('policy') || errorStr.includes('violation') || 
        errorStr.includes('terms of service') || errorStr.includes('restricted') ||
        errorStr.includes('403') || errorStr.includes('forbidden')) {
        
        console.warn(`[KeyService] 👮 Policy/ToS Violation detected for ${key.substring(0,8)}... Locking for 24h to protect project.`);
        // Lock for 24 hours to prevent further flags
        const duration = 24 * 60 * 60 * 1000;
        await markKeyAsDead(key, duration, 'policy_violation_cooldown');
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
function isKeyWithinLimits(keyData, requestedModel = null, modality = 'text') {
    const modelToCheck = (requestedModel || keyData.model || 'default').toLowerCase();
    const providerToCheck = (keyData.provider || 'unknown').toLowerCase();
    
    // Check if the entire model is locked (due to repeated 429s)
    if (isModelLocked(modelToCheck)) {
        return false;
    }

    const today = getPacificDate();
    const now = Date.now();

    // --- 1. KEY-LEVEL LIMITS (STRICT & UNIFIED) ---
    // Use effective usage (Cache + Pending Delta) to prevent over-usage during cache refresh windows
    const pending = pendingUpdates.get(keyData.api) || { usage_delta: 0 };
    const effectiveUsageToday = (keyData.usage_today || 0) + (keyData.last_date_checked === today ? pending.usage_delta : 0);

    // --- GET LIMITS (Global Config takes MASTER priority) ---
    // Priority: 1. Model:Modality, 2. Model, 3. Provider:Modality, 4. Provider
    const manual = dynamicLimits.get(`${modelToCheck}:${modality}`.toLowerCase()) || 
                   dynamicLimits.get(modelToCheck.toLowerCase()) || 
                   dynamicLimits.get(`${providerToCheck}:${modality}`.toLowerCase()) ||
                   dynamicLimits.get(providerToCheck.toLowerCase());

    // --- RESOLVE LIMITS (PRIORITY: Global Setting > Key-Specific > System Default) ---
    const resolveInternalLimit = (keyVal, globalVal, hardDefault) => {
        // 1. GLOBAL SETTING (User's Master Control) - Overrides EVERYTHING if set
        const gv = (globalVal !== undefined && globalVal !== null) ? parseInt(globalVal) : null;
        if (gv !== null) {
            return gv > 0 ? gv : 999999999; // 0 means Unlimited
        }
        
        // 2. KEY-SPECIFIC LIMIT (Used only if Global is not set)
        const kv = (keyVal !== undefined && keyVal !== null) ? parseInt(keyVal) : null;
        if (kv !== null) {
            return kv > 0 ? kv : 999999999;
        }
        
        // 3. SYSTEM DEFAULT
        return (hardDefault && hardDefault > 0) ? hardDefault : 999999999;
    };

    const defaults = PROVIDER_DEFAULTS[String(keyData.provider).toLowerCase()] || PROVIDER_DEFAULTS.default;

    const rpdLimit = resolveInternalLimit(keyData.rpd_limit, manual?.rpd, defaults.rpd);
    const rpmLimit = resolveInternalLimit(keyData.rpm_limit, manual?.rpm, defaults.rpm);
    const rphLimit = resolveInternalLimit(keyData.rph_limit, manual?.rph, defaults.rph);
    const tpmLimit = resolveInternalLimit(keyData.tpm_limit, manual?.tpm, defaults.tpm);
    const tpdLimit = resolveInternalLimit(keyData.tpd_limit, manual?.tpd, defaults.tpd);
    const tpmoLimit = resolveInternalLimit(keyData.tpmo_limit, manual?.tpmo, defaults.tpmo);

    // --- 1. REQUEST-LEVEL CHECKS ---
    // Check RPD
    if (rpdLimit < 999999999 && keyData.last_date_checked === today && effectiveUsageToday >= rpdLimit) {
        console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPD limit (${rpdLimit}). Usage: ${effectiveUsageToday}. Locking for 24h.`);
        markKeyAsDead(keyData.api, 24 * 60 * 60 * 1000, 'rpd_limit_reached_strict').catch(e => {});
        return false;
    }

    // Check RPM
    if (rpmLimit < 999999999) {
        const timestamps = keyUsageTimestamps.get(keyData.api) || [];
        const rpmThreshold = now - RPM_WINDOW_MS;
        const validTimestamps = timestamps.filter(ts => ts > rpmThreshold);
        if (validTimestamps.length !== timestamps.length) {
            keyUsageTimestamps.set(keyData.api, validTimestamps);
        }
        if (validTimestamps.length >= rpmLimit) {
            console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPM limit (${rpmLimit})`);
            return false;
        }
    }

    // Check RPH
    if (rphLimit < 999999999) {
        const hourTimestamps = keyUsageHourTimestamps.get(keyData.api) || [];
        const rphThreshold = now - RPH_WINDOW_MS;
        const validHourTimestamps = hourTimestamps.filter(ts => ts > rphThreshold);
        if (validHourTimestamps.length !== hourTimestamps.length) {
            keyUsageHourTimestamps.set(keyData.api, validHourTimestamps);
        }
        if (validHourTimestamps.length >= rphLimit) {
            console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit RPH limit (${rphLimit})`);
            return false;
        }
    }

    // --- 2. TOKEN-LEVEL CHECKS ---
    // Check TPM
    if (tpmLimit < 999999999) {
        const tokenTs = keyTokenUsageTimestamps.get(keyData.api) || [];
        const activeTpmCount = tokenTs.filter(item => item.ts > now - TPM_WINDOW_MS).reduce((acc, item) => acc + item.tokens, 0);
        if (activeTpmCount >= tpmLimit) {
            console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit TPM limit (${tpmLimit}). Current: ${activeTpmCount}`);
            return false;
        }
    }

    // Check TPD
    if (tpdLimit < 999999999) {
        const effectiveTokensToday = (keyData.usage_tokens_today || 0) + (keyData.last_date_checked === today ? pending.token_delta : 0);
        if (effectiveTokensToday >= tpdLimit) {
            console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit TPD limit (${tpdLimit}). Current: ${effectiveTokensToday}`);
            return false;
        }
    }

    // Check TPMo
    if (tpmoLimit < 999999999) {
        const thisMonth = today.substring(0, 7);
        const effectiveTokensMonth = (keyData.usage_tokens_month || 0) + (keyData.last_month_checked === thisMonth ? pending.token_delta : 0);
        if (effectiveTokensMonth >= tpmoLimit) {
            console.warn(`[KeyService] ⛔ Key ${keyData.api.substring(0,8)}... hit TPMo limit (${tpmoLimit}). Current: ${effectiveTokensMonth}`);
            return false;
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
        cachedKey.usage_tokens_month = (cachedKey.usage_tokens_month || 0) + tokenUsage;
        
        // Track Token Usage per minute
        const now = Date.now();
        const tokenTs = keyTokenUsageTimestamps.get(apiKey) || [];
        tokenTs.push({ ts: now, tokens: tokenUsage });
        keyTokenUsageTimestamps.set(apiKey, tokenTs.filter(item => item.ts > now - TPM_WINDOW_MS));

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
                last_month_checked: today.substring(0, 7),
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
                const baseIndex = index * 8;
                valuePlaceholders.push(
                    `($${baseIndex + 1}, $${baseIndex + 2}::bigint, $${baseIndex + 3}::bigint, $${baseIndex + 4}::date, $${baseIndex + 5}, $${baseIndex + 6}::timestamp, $${baseIndex + 7}, $${baseIndex + 8}::timestamp)`
                );
                values.push(
                    u.api,
                    u.usage_delta,
                    u.token_delta,
                    u.last_date_checked,
                    u.last_month_checked,
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
                    usage_tokens_month = CASE 
                        WHEN a.last_month_checked = v.last_month_checked THEN a.usage_tokens_month + v.token_delta 
                        ELSE v.token_delta 
                    END,
                    last_date_checked = v.last_date_checked,
                    last_month_checked = v.last_month_checked,
                    last_used_at = v.last_used_at,
                    status = COALESCE(v.status, a.status),
                    cooldown_until = COALESCE(v.cooldown_until, a.cooldown_until)
                FROM (VALUES ${valuePlaceholders.join(', ')}) AS v(api, usage_delta, token_delta, last_date_checked, last_month_checked, last_used_at, status, cooldown_until)
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
const keySelectionQueue = [];

async function acquireSelectionLock() {
    if (!isSelectingKey) {
        isSelectingKey = true;
        return;
    }
    return new Promise(resolve => keySelectionQueue.push(resolve));
}

function releaseSelectionLock() {
    if (keySelectionQueue.length > 0) {
        const next = keySelectionQueue.shift();
        next();
    } else {
        isSelectingKey = false;
    }
}

async function getSmartKey(provider, model = 'default', modality = 'text', isSystemRequest = true, requestUserId = null) {
    await acquireSelectionLock();
    try {
        // --- JITTER: Introduce a small random delay ---
        const jitter = Math.floor(Math.random() * 500); 
        if (jitter > 0) await new Promise(resolve => setTimeout(resolve, jitter));

        // Avoid blocking if cache is fresh
        if (typeof updateKeyCache === 'function') {
            const now = Date.now();
            if (now - lastCacheUpdate > CACHE_TTL) {
                await updateKeyCache();
            }
        }
        
        const modelToCheck = (model && model !== 'default') ? model : 'default';
        
        if (isModelLocked(modelToCheck)) {
            console.warn(`[KeyService] Model ${modelToCheck} is globally LOCKED.`);
            return null;
        }

        const mapKey = `${provider}:${modelToCheck}`;
        
        // 1. Get Candidate Keys from Cache
        let candidates = [];
        if (modelToCheck !== 'default' && keysByModel.has(modelToCheck)) {
            candidates = keysByModel.get(modelToCheck);
        } else if (keysByProvider.has(provider)) {
            candidates = keysByProvider.get(provider);
        }
        
        if (!candidates || candidates.length === 0) {
            if (keysByProvider.has(provider)) candidates = keysByProvider.get(provider);
            if (!candidates || candidates.length === 0) return null;
        }

        // --- FILTER CANDIDATES BASED ON REQUEST SOURCE ---
        if (!isSystemRequest) {
            // DEVELOPER API: Must use their own keys ONLY
            candidates = candidates.filter(k => k.owner_id === requestUserId && k.mode === 'dev');
        } else {
            // SYSTEM REQUEST: Use Admin keys OR shared Dev keys
            candidates = candidates.filter(k => k.mode === 'admin' || k.mode === 'dev');
        }

        if (candidates.length === 0) return null;

        // 2. STRICT SEQUENTIAL ROTATION (O(1) Scale for 10k+ Keys)
        const totalKeys = candidates.length;
        let currentIndex = globalKeyPointers.get(mapKey) || 0;
        
        const now = Date.now();
        const today = getPacificDate();

        for (let i = 0; i < totalKeys; i++) {
            const actualIndex = (currentIndex + i) % totalKeys;
            const candidateKey = candidates[actualIndex];

            // Skip if key became dead during the cycle
            const isModelLockedForThisKey = isModelLocked(modelToCheck, candidateKey.api);
            if (!isKeyAlive(candidateKey.api) || isModelLockedForThisKey) {
                // Smart Skip: If this was the current pointer, advance it so next request doesn't waste time checking it
                if (i === 0) {
                    globalKeyPointers.set(mapKey, (actualIndex + 1) % totalKeys);
                }

                if (isModelLockedForThisKey) {
                    console.log(`[KeyService] ⏭️ Skipping key ${candidateKey.api.substring(0,8)}... for model ${modelToCheck} (Model-Specific Lock).`);
                }
                continue;
            }

            // --- HARD CHECK: PRE-RESERVE RPM SLOT TO PREVENT RACE CONDITIONS ---
            const tsList = keyUsageTimestamps.get(candidateKey.api) || [];
            const rpmThreshold = now - 60000; // Strict 60s window for RPM
            const activeRpmCount = tsList.filter(ts => ts > rpmThreshold).length;

            // --- GET LIMITS (Global Config takes MASTER priority) ---
            // Priority: 1. Model:Modality, 2. Model, 3. Provider:Modality, 4. Provider
            const globalLim = dynamicLimits.get(`${modelToCheck}:${modality}`.toLowerCase()) || 
                              dynamicLimits.get(modelToCheck.toLowerCase()) || 
                              dynamicLimits.get(`${provider}:${modality}`.toLowerCase()) ||
                              dynamicLimits.get(provider.toLowerCase());

            const defaults = PROVIDER_DEFAULTS[String(provider).toLowerCase()] || PROVIDER_DEFAULTS.default;
            
            // Helper to resolve limit: 0 = Unlimited (999999), null/undefined = Use Default
            const resolveLimit = (keyVal, globalVal, hardDefault) => {
                // 1. GLOBAL SETTING (User's Master Control) - Overrides EVERYTHING if set
                const gv = (globalVal !== undefined && globalVal !== null) ? parseInt(globalVal) : null;
                if (gv !== null) {
                    return gv > 0 ? gv : 999999; // 0 means Unlimited
                }
                
                // 2. KEY-SPECIFIC LIMIT (Used only if Global is not set)
                const kv = (keyVal !== undefined && keyVal !== null) ? parseInt(keyVal) : null;
                if (kv !== null) {
                    return kv > 0 ? kv : 999999;
                }
                
                // 3. APPLY HARDCODED DEFAULTS
                return (hardDefault && hardDefault > 0) ? hardDefault : 999999;
            };

            const rpmLimit = resolveLimit(candidateKey.rpm_limit, globalLim?.rpm, defaults.rpm);
            const rphLimit = resolveLimit(candidateKey.rph_limit, globalLim?.rph, defaults.rph);
            const rpdLimit = resolveLimit(candidateKey.rpd_limit, globalLim?.rpd, defaults.rpd);

            const tpmLimit = resolveLimit(candidateKey.tpm_limit, globalLim?.tpm, defaults.tpm);
            const tpdLimit = resolveLimit(candidateKey.tpd_limit, globalLim?.tpd, defaults.tpd);
            const tpmoLimit = resolveLimit(candidateKey.tpmo_limit, globalLim?.tpmo, defaults.tpmo);

            // --- SECRET 50/50 LIMIT LOGIC ---
            if (candidateKey.mode === 'dev') {
                const userLimit = Math.floor(rpdLimit / 2);
                const systemLimit = Math.ceil(rpdLimit / 2);

                if (!isSystemRequest) {
                    // Developer reached their 50% limit?
                    if ((candidateKey.usage_user_today || 0) >= userLimit) {
                        continue;
                    }
                } else {
                    // System reached its 50% limit?
                    if ((candidateKey.usage_system_today || 0) >= systemLimit) {
                        continue;
                    }
                }
            }

            // Check RPM
            if (rpmLimit < 999999 && activeRpmCount >= rpmLimit) {
                continue;
            }

            // Check TPM (Tokens Per Minute)
            if (tpmLimit < 999999) {
                const tokenTsList = keyTokenUsageTimestamps.get(candidateKey.api) || [];
                const activeTpmCount = tokenTsList.filter(item => item.ts > now - TPM_WINDOW_MS).reduce((acc, item) => acc + item.tokens, 0);
                if (activeTpmCount >= tpmLimit) {
                    continue;
                }
            }

            // Check RPH (Requests Per Hour)
            const hourTsList = keyUsageHourTimestamps.get(candidateKey.api) || [];
            const oneHourAgo = now - (60 * 60 * 1000); // Strict 1h window
            const activeRphCount = hourTsList.filter(ts => ts > oneHourAgo).length;

            if (rphLimit < 999999 && activeRphCount >= rphLimit) {
                continue;
            }

            // Check RPD & TPD & TPMo
            const pending = pendingUpdates.get(candidateKey.api) || { usage_delta: 0, token_delta: 0 };
            
            // RPD Check - TWO LEVEL: Model-Specific AND Key-Level
            const dbUsage = candidateKey.last_date_checked === today ? (Number(candidateKey.usage_today) || 0) : 0;
            const effectiveUsageToday = dbUsage + pending.usage_delta;

            // Get Model-Specific RPD for THIS MODEL ONLY
            const modelSpecificRpdLimit = resolveLimit(null, globalLim?.rpd, defaults.rpd);
            
            // Track model-specific usage separately
            const modelUsageKey = `${candidateKey.api}:${modelToCheck}`;
            const modelTsList = modelUsageTimestamps.get(modelUsageKey) || [];
            const modelDailyData = modelDailyUsage.get(modelUsageKey) || { date: null, count: 0 };
            
            // Reset model daily count if new Pacific day
            let modelUsageToday = 0;
            if (modelDailyData.date !== today) {
                modelUsageToday = 0;
                modelDailyUsage.set(modelUsageKey, { date: today, count: 0 });
            } else {
                modelUsageToday = modelDailyData.count;
            }

            // Model-Specific RPD Check: Only skip this model, don't lock the key
            if (modelSpecificRpdLimit < 999999 && modelUsageToday >= modelSpecificRpdLimit) {
                console.warn(`[KeyService] ⏭️ Key ${candidateKey.api.substring(0,8)}... SKIPPED for model ${modelToCheck} (Model RPD: ${modelUsageToday}/${modelSpecificRpdLimit}). Trying next key.`);
                continue;
            }

            // Key-Level Global RPD Check: Only lock key if ALL models exhausted
            const globalKeyRpdLimit = resolveLimit(candidateKey.rpd_limit, null, defaults.rpd);
            if (globalKeyRpdLimit < 999999 && effectiveUsageToday >= globalKeyRpdLimit) {
                console.warn(`[KeyService] ⛔ Key ${candidateKey.api.substring(0,8)}... hit GLOBAL KEY RPD limit (${globalKeyRpdLimit}). Usage: ${effectiveUsageToday}. Locking entire key.`);
                candidateKey.status = 'locked';
                candidateKey.cooldown_until = new Date(Date.now() + getMsUntilPacificMidnight()).toISOString();
                markKeyAsDead(candidateKey.api, getMsUntilPacificMidnight(), `global_key_rpd_limit_reached_${globalKeyRpdLimit}`).catch(e => {});
                continue;
            }

            // TPD Check
            const dbTokensToday = candidateKey.last_date_checked === today ? (Number(candidateKey.usage_tokens_today) || 0) : 0;
            const effectiveTokensToday = dbTokensToday + pending.token_delta;

            if (tpdLimit < 999999 && effectiveTokensToday >= tpdLimit) {
                console.warn(`[KeyService] ⛔ Key ${candidateKey.api.substring(0,8)}... hit TPD limit (${tpdLimit}). Current: ${effectiveTokensToday}`);
                continue;
            }

            // TPMo Check
            const thisMonth = today.substring(0, 7);
            const dbTokensMonth = candidateKey.last_month_checked === thisMonth ? (Number(candidateKey.usage_tokens_month) || 0) : 0;
            const effectiveTokensMonth = dbTokensMonth + pending.token_delta;

            if (tpmoLimit < 999999 && effectiveTokensMonth >= tpmoLimit) {
                console.warn(`[KeyService] ⛔ Key ${candidateKey.api.substring(0,8)}... hit TPMo limit (${tpmoLimit}). Current: ${effectiveTokensMonth}`);
                continue;
            }

            // --- KEY SELECTED: ATOMIC UPDATES ---
            
            // Update Rotation Pointer for NEXT request (Strict Sequential)
            const nextIndex = (actualIndex + 1) % totalKeys;
            globalKeyPointers.set(mapKey, nextIndex);

            // Record Timestamp immediately (Atomic Reservation)
            const updatedTsList = tsList.filter(ts => ts > rpmThreshold);
            updatedTsList.push(now);
            keyUsageTimestamps.set(candidateKey.api, updatedTsList);

            const updatedHourList = hourTsList.filter(ts => ts > oneHourAgo);
            updatedHourList.push(now);
            keyUsageHourTimestamps.set(candidateKey.api, updatedHourList);

            // Update Model-Specific Usage Tracking
            const updatedModelTsList = modelTsList.filter(ts => ts > now - 60000);
            updatedModelTsList.push(now);
            modelUsageTimestamps.set(modelUsageKey, updatedModelTsList);
            
            // Update Model Daily Count
            modelUsageToday = modelDailyData.count + 1;
            modelDailyUsage.set(modelUsageKey, { date: today, count: modelUsageToday });

            // --- NEW: PERSISTENT MODEL USAGE UPDATE ---
            // We update the DB immediately for model-specific usage to ensure consistency across server restarts.
            try {
                const pgClient = require('./pgClient');
                const modelUsageUpdateQuery = `
                    INSERT INTO api_key_model_usage (api_key_id, model_name, usage_today, last_date_checked, last_used_at)
                    SELECT id, $2, 1, $3, NOW() FROM api_list WHERE api = $1
                    ON CONFLICT (api_key_id, model_name) 
                    DO UPDATE SET 
                        usage_today = CASE WHEN api_key_model_usage.last_date_checked = $3 THEN api_key_model_usage.usage_today + 1 ELSE 1 END,
                        last_date_checked = $3,
                        last_used_at = NOW()
                `;
                pgClient.query(modelUsageUpdateQuery, [candidateKey.api, modelToCheck, today]).catch(e => {
                    console.error(`[KeyService] 💾 Failed to persist model usage for ${modelToCheck}:`, e.message);
                });
            } catch (err) {
                console.error(`[KeyService] DB error on model usage persistence:`, err.message);
            }

            // Update Usage Stats
            candidateKey.usage_count = (Number(candidateKey.usage_count) || 0) + 1;
            if (candidateKey.last_date_checked === today) {
                candidateKey.usage_today = (Number(candidateKey.usage_today) || 0) + 1;
                if (isSystemRequest) candidateKey.usage_system_today = (Number(candidateKey.usage_system_today) || 0) + 1;
                else candidateKey.usage_user_today = (Number(candidateKey.usage_user_today) || 0) + 1;
            } else {
                candidateKey.last_date_checked = today;
                candidateKey.usage_today = 1;
                candidateKey.usage_system_today = isSystemRequest ? 1 : 0;
                candidateKey.usage_user_today = isSystemRequest ? 0 : 1;
            }
            candidateKey.last_used_at = new Date().toISOString();

            // Track Delta for Persistence
            const current = pendingUpdates.get(candidateKey.api) || { usage_delta: 0, token_delta: 0 };
            current.usage_delta = (current.usage_delta || 0) + 1;
            current.last_used_at = candidateKey.last_used_at;
            pendingUpdates.set(candidateKey.api, current);

            flushUsageStats().catch(e => console.error(`[KeyService] Immediate flush failed: ${e.message}`));

            console.log(`[KeyService] ✅ Selected Key: ${candidateKey.api} (Source: ${isSystemRequest ? 'System' : 'User'}, Index: ${actualIndex + 1}/${totalKeys}, RPM: ${activeRpmCount + 1}/${rpmLimit || '∞'}, ModelRPD: ${(modelDailyUsage.get(modelUsageKey)?.count || 0)}/${modelSpecificRpdLimit})`);
            addRotationLog(provider, model, candidateKey.api, actualIndex + 1, totalKeys);

            return {
                key: candidateKey.api,
                provider: candidateKey.provider,
                model: candidateKey.model || model
            };
        }

        console.warn(`[KeyService] ⚠️ All ${candidates.length} keys exhausted for ${provider}/${model}`);
        return null;
    } finally {
        releaseSelectionLock();
    }
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

function getModelUsageSummaryForKey(apiKey) {
    if (!apiKey) return {};
    const today = getPacificDate();
    const summary = {};
    
    // Use the modelDailyUsage map which is already synced with DB
    modelDailyUsage.forEach((data, key) => {
        if (key.startsWith(`${apiKey}:`)) {
            // Correctly extract model name from key format "apiKey:modelName"
            const modelName = key.substring(apiKey.length + 1);
            summary[modelName] = {
                count: data.date === today ? data.count : 0,
                date: data.date
            };
        }
    });
    
    return summary;
}

/**
 * Unified Key Picker for Developer API
 */
async function getUnifiedKey(userId, type, modelName) {
    // Wrapper around getSmartKey for Developer API requests (isSystemRequest = false)
    return await getSmartKey('google', modelName || 'gemini-1.5-flash', type, false, userId);
}

async function trackUnifiedUsage(key, userId) {
    // Usage is now tracked inside getSmartKey for atomic updates
    return;
}

module.exports = {
    getUnifiedKey,
    trackUnifiedUsage,
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

    getModelUsageSummaryForKey,
    
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
                const email = (k.email || '').toLowerCase();
                return provider.includes(query) || api.includes(query) || email.includes(query);
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
                const pending = pendingUpdates.get(k.api) || { usage_delta: 0, token_delta: 0 };
                const dbUsage = k.last_date_checked === today ? (k.usage_today || 0) : 0;
                const dbTokens = k.last_date_checked === today ? (k.usage_tokens_today || 0) : 0;
                
                return {
                    id: k.id,
                    provider: k.provider,
                    api: k.api,
                    email: k.email,
                    status: pending.status || k.status,
                    usage_today: dbUsage + (pending.usage_delta || 0),
                    usage_tokens_today: dbTokens + (pending.token_delta || 0),
                    usage_count: (Number(k.usage_count) || 0) + (pending.usage_delta || 0),
                    last_used_at: k.last_used_at,
                    rph_limit: k.rph_limit,
                    rpm_limit: k.rpm_limit,
                    rpd_limit: k.rpd_limit,
                    current_rpm: summary.rpm,
                    current_rph: summary.rph,
                    cooldown_until: pending.cooldown_until || k.cooldown_until,
                    model_usage: getModelUsageSummaryForKey(k.api)
                };
            })
        };
    }
};
