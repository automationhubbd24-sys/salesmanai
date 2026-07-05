const { query } = require('./pgClient');

// Helper function to check and expire monthly plans
async function checkAndExpirePlan(userId) {
  try {
    const result = await query(
      'SELECT subscription_plan, monthly_expires_at FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
      [String(userId)]
    );
    if (result.rows.length === 0) return null;
    
    const config = result.rows[0];
    const now = new Date();
    
    if (config.subscription_plan && config.subscription_plan !== 'none' && config.monthly_expires_at) {
      const expiresAt = new Date(config.monthly_expires_at);
      if (now > expiresAt) {
        // Expire the plan
        await query(
          `UPDATE user_configs 
           SET subscription_plan = 'none', 
               daily_limit = 0, 
               bonus_credit = 0, 
               monthly_limit = 0,
               monthly_used = 0
           WHERE user_id::text = $1::text`,
          [String(userId)]
        );
        console.log(`[DB] Auto-expired monthly plan for User ${userId}`);
        return { expired: true };
      }
    }
    return { expired: false, config };
  } catch (err) {
    console.error('[DB] Error checking plan expiry:', err);
    return null;
  }
}

// 1. Get Page Config (Multi-Tenant Rule - Step 7)
async function getPageConfig(pageId) {
  try {
    // 1. Fetch Fresh Page Data (Bypassing User Association Check)
    const result = await query(
      `SELECT pam.*, 
              fb.semantic_cache_enabled, 
              fb.semantic_cache_threshold, 
              fb.embed_enabled,
              fb.semantic_cache_autosave,
              fb.order_email_confirmation_enabled,
              fb.admin_notification_email,
              fb.engine_override
       FROM page_access_token_message pam
       LEFT JOIN fb_message_database fb ON CAST(fb.page_id AS TEXT) = CAST(pam.page_id AS TEXT)
       WHERE CAST(pam.page_id AS TEXT) = CAST($1 AS TEXT) LIMIT 1`,
      [pageId]
    );

    if (result.rows.length === 0) return null;
    const data = result.rows[0];

    // --- AUTO-REPAIR: Link User ID if missing but email exists ---
    if (!data.user_id && data.email) {
        try {
            const userLookup = await query(
                'SELECT user_id FROM user_configs WHERE email = $1 LIMIT 1',
                [data.email]
            );
            if (userLookup.rows.length > 0) {
                const foundUserId = userLookup.rows[0].user_id;
                console.log(`[DB] Auto-Repair: Linking Page ${pageId} to User ${foundUserId} via email ${data.email}`);
                await query(
                    'UPDATE page_access_token_message SET user_id = $1 WHERE page_id = $2',
                    [foundUserId, pageId]
                );
                data.user_id = foundUserId; // Update local object to proceed with credit fetch
            }
        } catch (repairErr) {
            console.error(`[DB] Auto-Repair Failed for Page ${pageId}:`, repairErr.message);
        }
    }
    // -----------------------------------------------------------

    // Check and expire plan first
    if (data.user_id) {
      await checkAndExpirePlan(data.user_id);
    }

    // 2. Fetch Centralized User Credit (Sync across all members & pages)
    if (data.user_id) {
        const creditResult = await query(
            'SELECT message_credit, bonus_credit, permanent_credit, daily_limit, daily_used, monthly_limit, monthly_used, subscription_plan, monthly_expires_at FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(data.user_id)]
        );
        if (creditResult.rows.length > 0) {
            const row = creditResult.rows[0];
            // SaaS Level Summation: Available Monthly + Bonus + Legacy + Permanent
            const availableMonthly = Math.max(0, Number(row.monthly_limit || 0) - Number(row.monthly_used || 0));
            data.message_credit = availableMonthly + Number(row.bonus_credit || 0) + Number(row.message_credit || 0) + Number(row.permanent_credit || 0);
            
            data.bonus_credit = Number(row.bonus_credit || 0);
            data.permanent_credit = Number(row.permanent_credit || 0);
            data.daily_limit = Number(row.daily_limit || 0);
            data.daily_used = Number(row.daily_used || 0);
            data.monthly_limit = Number(row.monthly_limit || 0);
            data.monthly_used = Number(row.monthly_used || 0);
            data.monthly_expires_at = row.monthly_expires_at;
            
            // Also sync subscription status if it's 'active' or 'none'
            if (row.subscription_plan) {
                data.subscription_status = row.subscription_plan;
            }
            data.credit_source = 'shared_user_balance';
        }
    }

    if (data.message_credit === undefined) data.message_credit = 0;

    if (!data.credit_source) {
      data.credit_source = 'page_balance';
    }

    const defaultProvider = 'google';
    const defaultModel = 'gemini-2.5-flash';

    let needsAiUpdate = false;
    if (!data.ai) {
      data.ai = defaultProvider;
      needsAiUpdate = true;
    }
    if (!data.chat_model) {
      data.chat_model = defaultModel;
      needsAiUpdate = true;
    }
    if (data.cheap_engine === undefined || data.cheap_engine === null) {
      data.cheap_engine = true;
      needsAiUpdate = true;
    }
    if (data.pro_plus_mode === undefined || data.pro_plus_mode === null) {
      data.pro_plus_mode = false;
      needsAiUpdate = true;
    }
    if (needsAiUpdate) {
      await query(
        'UPDATE page_access_token_message SET ai = $1, chat_model = $2, cheap_engine = $3, pro_plus_mode = $4 WHERE page_id = $5',
        [data.ai, data.chat_model, data.cheap_engine, data.pro_plus_mode, pageId]
      );
    }

    return data;
  } catch (error) {
    console.error(`Error fetching config for page ${pageId}:`, error);
    return null;
  }
}

// 2. Get Knowledge Base / Prompts (Step 2 Context)
async function getPagePrompts(pageId) {
    try {
        const result = await query(
            'SELECT * FROM fb_message_database WHERE page_id = $1 LIMIT 1',
            [pageId]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0];
    } catch (error) {
        console.error(`Error fetching prompts for page ${pageId}:`, error);
        return null;
    }
}

// 3. Save Lead / Chat History (Step 5)
async function saveLead(data) {
    try {
        await query(
            `INSERT INTO wp_chats (page_id, sender_id, text, status, timestamp)
             VALUES ($1,$2,$3,$4,$5)`,
            [
                data.page_id,
                data.sender_id,
                data.message,
                'done',
                Date.now()
            ]
        );
    } catch (error) {
        console.error("Error saving lead:", error);
    }
}

// 3.1 Conversation State Management (Agentic Follow-up Context)
async function getConversationState(pageId, senderId) {
    try {
        const result = await query(
            'SELECT * FROM conversation_state WHERE page_id = $1 AND sender_id = $2',
            [pageId, senderId]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error(`Error fetching conv state for ${senderId}:`, error);
        return null;
    }
}

async function setConversationState(pageId, senderId, data) {
    try {
        await query(
            `INSERT INTO conversation_state (page_id, sender_id, last_product_id, last_variant_key, last_intent, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (page_id, sender_id) 
             DO UPDATE SET 
                last_product_id = EXCLUDED.last_product_id,
                last_variant_key = EXCLUDED.last_variant_key,
                last_intent = EXCLUDED.last_intent,
                updated_at = NOW()`,
            [pageId, senderId, data.last_product_id || null, data.last_variant_key || null, data.last_intent || null]
        );
        return true;
    } catch (error) {
        console.error(`Error saving conv state for ${senderId}:`, error);
        return false;
    }
}

// Backward-compatible alias used by legacy WhatsApp paths.
async function updateConversationState(pageId, senderId, data) {
    return setConversationState(pageId, senderId, data);
}

// 4. Debounce / Duplicate Check
async function checkDuplicate(messageId) {
    if (!messageId) return false;

    try {
        const existing = await query(
            'SELECT id FROM wpp_debounce WHERE debounce_key = $1 LIMIT 1',
            [messageId]
        );
        if (existing.rows.length > 0) {
            return true;
        }
        await query(
            'INSERT INTO wpp_debounce (debounce_key) VALUES ($1)',
            [messageId]
        );
        return false;
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            return true;
        }
        console.error("Error in checkDuplicate:", error.message);
        return false;
    }
}

// 5. Smart Credit Deduction (Centralized User Balance)
async function deductCredit(pageId, amount = 1) {
    const { query } = require('./pgClient');
    try {
        // Migration on-the-fly: Ensure columns exist in user_configs
        try {
            await query(`
                ALTER TABLE user_configs 
                ADD COLUMN IF NOT EXISTS daily_limit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS daily_used NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS monthly_used NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS bonus_credit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS permanent_credit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS last_monthly_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
            `);
        } catch (e) {}

        const pageResult = await query(
            'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 LIMIT 1',
            [pageId]
        );

        if (pageResult.rows.length === 0 || !pageResult.rows[0].user_id) {
            console.warn(`[Credit] Page ${pageId} not linked to any user.`);
            return false;
        }

        const linkedUser = pageResult.rows[0];

        const userConfigResult = await query(
            'SELECT * FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(linkedUser.user_id)]
        );

        if (userConfigResult.rows.length === 0) {
            console.warn(`[Credit] User config not found for ${linkedUser.user_id}.`);
            return false;
        }

        const config = userConfigResult.rows[0];
        const userIdStr = String(linkedUser.user_id);

        // Check and expire plan first
        await checkAndExpirePlan(userIdStr);
        // Re-fetch config after possible expiry
        const updatedConfigResult = await query(
            'SELECT * FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [userIdStr]
        );
        const finalConfig = updatedConfigResult.rows.length > 0 ? updatedConfigResult.rows[0] : config;

        // --- 1. RESET CHECKS (DAILY & MONTHLY) ---
        const now = new Date();
        const lastReset = new Date(finalConfig.last_reset_at || 0);
        const lastMonthlyReset = new Date(finalConfig.last_monthly_reset_at || 0);
        
        const isNewDay = lastReset.toDateString() !== now.toDateString();
        const isNewMonth = lastMonthlyReset.getMonth() !== now.getMonth() || lastMonthlyReset.getFullYear() !== now.getFullYear();

        let dailyUsed = Number(finalConfig.daily_used || 0);
        let bonusCredit = Number(finalConfig.bonus_credit || 0);
        let monthlyUsed = Number(finalConfig.monthly_used || 0);

        if (isNewMonth) {
            // Reset usage counters AND Monthly Bonus for new month
            dailyUsed = 0;
            monthlyUsed = 0;
            await query(
                'UPDATE user_configs SET daily_used = 0, monthly_used = 0, bonus_credit = 0, last_reset_at = NOW(), last_monthly_reset_at = NOW() WHERE user_id::text = $1',
                [userIdStr]
            );
            console.log(`[Credit] Monthly usage & Bonus reset for User ${userIdStr}`);
        } else if (isNewDay) {
            dailyUsed = 0;
            await query(
                'UPDATE user_configs SET daily_used = 0, last_reset_at = NOW() WHERE user_id::text = $1',
                [userIdStr]
            );
            console.log(`[Credit] Daily usage reset for User ${userIdStr}`);
        }

        // --- 2. DEDUCTION LOGIC (SMART ROUTING: Free -> Daily -> Bonus -> Permanent) ---
        
        // --- SaaS Level Credit Deduction Logic (Priority Buckets) ---

        // 1. Free/Legacy Message Credit (Sign-up or Free Tier - 100 Messages)
        // User wants this to be used FIRST.
        if (Number(finalConfig.message_credit || 0) > 0) {
            await query(
                'UPDATE user_configs SET message_credit = message_credit - $1 WHERE user_id::text = $2',
                [amount, userIdStr]
            );
            console.log(`[Credit] Deducted from Free Message Credit for User ${userIdStr}`);
            return true;
        }

        // 2. Daily Limit (Subscription Daily Quota - Resets Daily)
        const monthlyExpiresAt = finalConfig.monthly_expires_at ? new Date(finalConfig.monthly_expires_at) : null;
        const isSubscriptionActive = !monthlyExpiresAt || now < monthlyExpiresAt;
        
        if (isSubscriptionActive && Number(finalConfig.daily_limit || 0) > dailyUsed) {
            await query(
                'UPDATE user_configs SET daily_used = daily_used + $1 WHERE user_id::text = $2',
                [amount, userIdStr]
            );
            console.log(`[Credit] Deducted from Daily Limit for User ${userIdStr}`);
            return true;
        }

        // 3. Bonus Credit (Promotional / Monthly Bonus)
        if (isSubscriptionActive && bonusCredit > 0) {
            await query(
                'UPDATE user_configs SET bonus_credit = bonus_credit - $1 WHERE user_id::text = $2',
                [amount, userIdStr]
            );
            console.log(`[Credit] Deducted from Bonus Credit for User ${userIdStr}`);
            return true;
        }

        // 4. Permanent Credit (Lifetime Pack - No Expiry)
        if (Number(config.permanent_credit || 0) > 0) {
            await query(
                'UPDATE user_configs SET permanent_credit = permanent_credit - $1 WHERE user_id::text = $2',
                [amount, userIdStr]
            );
            console.log(`[Credit] Deducted from Permanent Credit for User ${userIdStr}`);
            return true;
        }

        console.warn(`[Credit] Insufficient credits for User ${userIdStr}. All balances empty.`);
        return false;
    } catch (err) {
        console.error("Error in smart credit deduction:", err);
        return false;
    }
}

// --- AI MODEL PRICING SYSTEM ---

let pricingCache = new Map();
let lastPricingUpdate = 0;
const PRICING_TTL = 60 * 1000; // 1 minute

async function getModelPricing() {
    const now = Date.now();
    if (pricingCache.size > 0 && (now - lastPricingUpdate < PRICING_TTL)) {
        return Array.from(pricingCache.values());
    }

    try {
        const result = await query('SELECT * FROM model_pricing');
        const list = result.rows || [];
        
        const newCache = new Map();
        list.forEach(p => newCache.set(p.model_id, p));
        pricingCache = newCache;
        lastPricingUpdate = now;
        
        return list;
    } catch (err) {
        console.warn('[DB] Failed to fetch model pricing from DB, using fallback:', err.message);
        // Fallback pricing if table doesn't exist yet
        return [
            { model_id: 'salesmanchatbot-pro', cost_per_request: 0.15 },
            { model_id: 'salesmanchatbot-flash', cost_per_request: 0.10 },
            { model_id: 'salesmanchatbot-lite', cost_per_request: 0.08 },
            { model_id: 'salesmanchatbot-brain', cost_per_request: 0.09 }
        ];
    }
}

async function getCostForModel(modelId) {
    await getModelPricing(); // Ensure cache is warm
    
    // Normalize model ID (e.g. handle versions or prefixes)
    let id = modelId || 'salesmanchatbot-pro';
    if (!pricingCache.has(id)) {
        if (id.includes('flash')) id = 'salesmanchatbot-flash';
        else if (id.includes('lite')) id = 'salesmanchatbot-lite';
        else if (id.includes('brain')) id = 'salesmanchatbot-brain';
        else id = 'salesmanchatbot-pro';
    }

    const pricing = pricingCache.get(id);
    return pricing ? Number(pricing.cost_per_request) : 0.15;
}

/**
 * Logs API usage for tracking and analytics
 */
async function logApiUsage(userId, model, tokens, cost, platform = 'external_api') {
    try {
        await query(
            'INSERT INTO api_usage_stats (user_id, model, tokens, cost, platform) VALUES ($1, $2, $3, $4, $5)',
            [userId, model, tokens, cost, platform]
        );
    } catch (err) {
        console.error('[DB] Failed to log API usage:', err.message);
    }
}

async function deductUserBalance(userId, amount, description = 'API Call') {
    try {
        const res = await query(
            'UPDATE user_configs SET balance = balance - $1 WHERE user_id = $2::uuid RETURNING balance',
            [amount, userId]
        );
        
        if (res.rows.length > 0) {
            return res.rows[0].balance;
        }
        return null;
    } catch (err) {
        console.error('[DB] Balance deduction error:', err.message);
        throw err;
    }
}

// 6. Get Chat History (Context Window)
async function getChatHistory(sessionId, limit = 10) {
    try {
        const result = await query(
            `SELECT message
             FROM backend_chat_histories
             WHERE session_id = $1
             ORDER BY id DESC
             LIMIT $2`,
            [sessionId, limit]
        );
        return result.rows.map(row => row.message).reverse();
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }
}

// 7. Save Chat Message
async function saveChatMessage(sessionId, role, content, messageId = null) {
    console.log(`[DB] Saving chat for ${sessionId}: [${role}] ${content.substring(0, 50)}...`);
    try {
        if (messageId) {
             // Check if exists to prevent duplicates (e.g. from Echo events)
             const check = await query(
                 `SELECT id FROM backend_chat_histories WHERE message_id = $1 LIMIT 1`,
                 [messageId]
             );
             if (check.rows.length > 0) {
                 // console.log(`[DB] Chat message ${messageId} already exists in history. Skipping.`);
                 return;
             }
             
             await query(
                `INSERT INTO backend_chat_histories (session_id, message, message_id, role, text)
                 VALUES ($1, $2, $3, $4, $5)`,
                [sessionId, { role, content }, messageId, role, content]
            );
        } else {
            // Fallback for calls without messageId
            await query(
                `INSERT INTO backend_chat_histories (session_id, message, role, text)
                 VALUES ($1, $2, $3, $4)`,
                [sessionId, { role, content }, role, content]
            );
        }
    } catch (error) {
        console.error("Error saving chat message:", error);
    }
}

// 8. Centralized Error Logging
async function logError(error, context = 'Unknown', metadata = {}) {
    try {
        // Always log to console first for immediate visibility
        console.error(`[ERROR] [${context}]`, error.message);
        if (error.stack) console.error(error.stack);

        const errorMessage = error.message || String(error);
        const stackTrace = error.stack || null;
        const metaJson = JSON.stringify(metadata);

        // Save to DB
        await query(
            `INSERT INTO error_logs (error_message, stack_trace, context, metadata)
             VALUES ($1, $2, $3, $4)`,
            [errorMessage, stackTrace, context, metaJson]
        );
    } catch (dbError) {
        // Fallback: If DB logging fails, just console log it.
        // We don't want the error logger to cause another crash.
        console.error("[CRITICAL] Failed to save error log to DB:", dbError);
    }
}

// 9. Initialize Tables (Run on Startup)
async function initTables() {
    try {
        // --- SEQUENCE REPAIR (Duplicate Key Fix) ---
        // Fix for "duplicate key value violates unique constraint"
        try {
            await query(`
                SELECT setval(
                    pg_get_serial_sequence('backend_chat_histories', 'id'),
                    COALESCE(MAX(id), 0) + 1,
                    false
                ) FROM backend_chat_histories;
            `);
            await query(`
                SELECT setval(
                    pg_get_serial_sequence('ai_usage_logs', 'id'),
                    COALESCE(MAX(id), 0) + 1,
                    false
                ) FROM ai_usage_logs;
            `);
            console.log("[DB] Table sequences repaired.");
        } catch (seqErr) {
            console.warn("[DB] Sequence repair warning:", seqErr.message);
        }

        // FB Contacts Table (For Handover/Lock)
        await query(`
            CREATE TABLE IF NOT EXISTS fb_contacts (
                id SERIAL PRIMARY KEY,
                page_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                is_locked BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(page_id, sender_id)
            );
            CREATE INDEX IF NOT EXISTS idx_fb_contacts_page_sender ON fb_contacts(page_id, sender_id);
        `);

        await query(`
            CREATE TABLE IF NOT EXISTS whatsapp_contacts (
                id SERIAL PRIMARY KEY,
                session_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                name TEXT,
                is_locked BOOLEAN DEFAULT FALSE,
                last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(session_name, phone_number)
            );
            CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_session_phone ON whatsapp_contacts(session_name, phone_number);
        `);

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='phone_number') THEN
                    ALTER TABLE whatsapp_contacts ADD COLUMN phone_number TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='name') THEN
                    ALTER TABLE whatsapp_contacts ADD COLUMN name TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='is_locked') THEN
                    ALTER TABLE whatsapp_contacts ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='last_interaction') THEN
                    ALTER TABLE whatsapp_contacts ADD COLUMN last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                END IF;
            END $$;
        `);

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='phone_number') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN phone_number TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='is_locked') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='token_usage') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN token_usage INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='model_used') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN model_used TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='is_group') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN is_group BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='group_id') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN group_id TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_chats' AND column_name='group_name') THEN
                    ALTER TABLE whatsapp_chats ADD COLUMN group_name TEXT;
                END IF;
            END $$;
        `);

        await query(`
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS push_name TEXT;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS ai_provider TEXT;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS chat_model TEXT;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS voice_model TEXT;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS vision_model TEXT;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS cheap_engine BOOLEAN DEFAULT TRUE;
            ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS pro_plus_mode BOOLEAN DEFAULT FALSE;
        `);

        await query(`
            ALTER TABLE backend_chat_histories ADD COLUMN IF NOT EXISTS role TEXT;
        `);

        await query(`
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS page_id TEXT;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS sender_name TEXT;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS user_message TEXT;
            ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS ai_reply TEXT;
        `);

        await query(`
            CREATE TABLE IF NOT EXISTS public.api_engine_configs (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                provider text UNIQUE NOT NULL,
                text_model text DEFAULT 'gemini-2.5-flash',
                vision_model text DEFAULT 'gemini-2.5-flash',
                voice_model text DEFAULT 'gemini-2.5-flash',
                text_rpm int DEFAULT 0,
                text_rpd int DEFAULT 0,
                text_rph int DEFAULT 0,
                vision_rpm int DEFAULT 0,
                vision_rpd int DEFAULT 0,
                vision_rph int DEFAULT 0,
                voice_rpm int DEFAULT 0,
                voice_rpd int DEFAULT 0,
                voice_rph int DEFAULT 0,
                text_models_list JSONB DEFAULT '[]'::jsonb,
                vision_models_list JSONB DEFAULT '[]'::jsonb,
                voice_models_list JSONB DEFAULT '[]'::jsonb,
                updated_at timestamp with time zone DEFAULT now()
            );
            INSERT INTO public.api_engine_configs (provider, text_model, vision_model, voice_model)
            VALUES ('google', 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash')
            ON CONFLICT (provider) DO NOTHING;
            INSERT INTO public.api_engine_configs (provider, text_model, vision_model, voice_model)
            VALUES ('mistral', 'mistral-small-latest', 'mistral-small-latest', 'mistral-small-latest')
            ON CONFLICT (provider) DO NOTHING;
        `);

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='text_models_list') THEN
                    ALTER TABLE api_engine_configs ADD COLUMN text_models_list JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='vision_models_list') THEN
                    ALTER TABLE api_engine_configs ADD COLUMN vision_models_list JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_engine_configs' AND column_name='voice_models_list') THEN
                    ALTER TABLE api_engine_configs ADD COLUMN voice_models_list JSONB DEFAULT '[]'::jsonb;
                END IF;
            END $$;
        `);

        await query(`
            CREATE TABLE IF NOT EXISTS public.engine_configs (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                provider VARCHAR(50) NOT NULL,
                text_model VARCHAR(255),
                voice_model VARCHAR(255),
                image_model VARCHAR(255),
                voice_provider_override VARCHAR(50),
                image_provider_override VARCHAR(50),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            INSERT INTO engine_configs (name, provider, text_model, voice_model, image_model)
            VALUES 
                ('salesmanchatbot-pro', 'google', 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash'),
                ('salesmanchatbot-flash', 'openrouter', 'arcee-ai/trinity-large-preview', 'arcee-ai/trinity-large-preview', 'arcee-ai/trinity-large-preview'),
                ('salesmanchatbot-lite', 'groq', 'llama-3.3-70b-versatile', 'whisper-large-v3', 'llama-3.2-11b-vision-preview')
            ON CONFLICT (name) DO NOTHING;
        `);

        await query(`
            DO $$ 
            DECLARE seq_name text;
            BEGIN
                seq_name := pg_get_serial_sequence('fb_chats', 'id');
                IF seq_name IS NOT NULL THEN
                    EXECUTE 'SELECT setval(''' || seq_name || ''', (SELECT COALESCE(MAX(id),0)+1 FROM fb_chats), false)';
                END IF;

                seq_name := pg_get_serial_sequence('wp_chats', 'id');
                IF seq_name IS NOT NULL THEN
                    EXECUTE 'SELECT setval(''' || seq_name || ''', (SELECT COALESCE(MAX(id),0)+1 FROM wp_chats), false)';
                END IF;
            END $$;
        `);

        // Conversation State Table (Agentic AI Follow-up context)
        await query(`
            CREATE TABLE IF NOT EXISTS conversation_state (
                page_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                last_product_id TEXT,
                last_variant_key TEXT,
                last_intent TEXT,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                PRIMARY KEY (page_id, sender_id)
            );
            CREATE INDEX IF NOT EXISTS idx_conv_state_updated ON conversation_state(updated_at DESC);
        `);
        console.log("[DB] 'conversation_state' table initialized.");

        // Ensure 'custom_base_url' column exists
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='page_access_token_message' AND column_name='custom_base_url') THEN
                    ALTER TABLE page_access_token_message ADD COLUMN custom_base_url TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='page_access_token_message' AND column_name='pro_plus_mode') THEN
                    ALTER TABLE page_access_token_message ADD COLUMN pro_plus_mode BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);

        // Ensure 'is_locked' column exists (for backward compatibility)
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_contacts' AND column_name='is_locked') THEN
                    ALTER TABLE fb_contacts ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_contacts' AND column_name='updated_at') THEN
                    ALTER TABLE fb_contacts ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                END IF;
            END $$;
        `);
        console.log("[DB] 'fb_contacts' table/column checked.");

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='last_used_at') THEN
                    ALTER TABLE api_list ADD COLUMN last_used_at TIMESTAMP WITH TIME ZONE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='usage_today') THEN
                    ALTER TABLE api_list ADD COLUMN usage_today INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='usage_tokens_today') THEN
                    ALTER TABLE api_list ADD COLUMN usage_tokens_today INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='last_date_checked') THEN
                    ALTER TABLE api_list ADD COLUMN last_date_checked DATE DEFAULT CURRENT_DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='cooldown_until') THEN
                    ALTER TABLE api_list ADD COLUMN cooldown_until TIMESTAMP WITH TIME ZONE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='rph_limit') THEN
                    ALTER TABLE api_list ADD COLUMN rph_limit INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='rpm_limit') THEN
                    ALTER TABLE api_list ADD COLUMN rpm_limit INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='rpd_limit') THEN
                    ALTER TABLE api_list ADD COLUMN rpd_limit INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='model') THEN
                    ALTER TABLE api_list ADD COLUMN model TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='email') THEN
                    ALTER TABLE api_list ADD COLUMN email TEXT;
                END IF;
            END $$;
        `);
        console.log("[DB] 'api_list' columns verified.");
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='allow_description') THEN
                    ALTER TABLE fb_message_database ADD COLUMN allow_description BOOLEAN DEFAULT FALSE;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='sender_number') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN sender_number TEXT;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='audio_detection') THEN
                    ALTER TABLE fb_message_database ADD COLUMN audio_detection BOOLEAN DEFAULT FALSE;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_enabled') THEN
                    ALTER TABLE fb_message_database ADD COLUMN semantic_cache_enabled BOOLEAN DEFAULT FALSE;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_threshold') THEN
                    ALTER TABLE fb_message_database ADD COLUMN semantic_cache_threshold NUMERIC DEFAULT 0.96;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='embed_enabled') THEN
                    ALTER TABLE fb_message_database ADD COLUMN embed_enabled BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='order_email_confirmation_enabled') THEN
                    ALTER TABLE fb_message_database ADD COLUMN order_email_confirmation_enabled BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='admin_notification_email') THEN
                    ALTER TABLE fb_message_database ADD COLUMN admin_notification_email TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='order_email_confirmation_enabled') THEN
                    ALTER TABLE whatsapp_message_database ADD COLUMN order_email_confirmation_enabled BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='admin_notification_email') THEN
                    ALTER TABLE whatsapp_message_database ADD COLUMN admin_notification_email TEXT;
                END IF;
            END $$;
        `);
        console.log("[DB] 'fb_message_database' extra columns checked.");

        // 1. Ensure allowed_messenger_ids exists (Modern Standard)
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allowed_messenger_ids') THEN
                    ALTER TABLE products ADD COLUMN allowed_messenger_ids JSONB DEFAULT '[]'::jsonb;
                END IF;
            END $$;
        `);
        console.log("[DB] 'products.allowed_messenger_ids' column checked.");

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allow_description') THEN
                    ALTER TABLE products ADD COLUMN allow_description BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);
        console.log("[DB] 'products.allow_description' column checked.");

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='video_url') THEN
                    ALTER TABLE products ADD COLUMN video_url TEXT;
                END IF;
            END $$;
        `);
        console.log("[DB] 'products.video_url' column checked.");

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allowed_wa_sessions') THEN
                    ALTER TABLE products ADD COLUMN allowed_wa_sessions JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='product_mode') THEN
                    ALTER TABLE products ADD COLUMN product_mode TEXT DEFAULT 'simple';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='attribute_schema') THEN
                    ALTER TABLE products ADD COLUMN attribute_schema JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='sku_matrix') THEN
                    ALTER TABLE products ADD COLUMN sku_matrix JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='searchable_text') THEN
                    ALTER TABLE products ADD COLUMN searchable_text TEXT;
                END IF;
            END $$;
        `);
        await query(`UPDATE products SET allowed_wa_sessions = '[]'::jsonb WHERE allowed_wa_sessions IS NULL`);
        await query(`UPDATE products SET allowed_messenger_ids = '[]'::jsonb WHERE allowed_messenger_ids IS NULL`);
        await query(`UPDATE products SET product_mode = 'simple' WHERE product_mode IS NULL`);
        await query(`UPDATE products SET attribute_schema = '[]'::jsonb WHERE attribute_schema IS NULL`);
        await query(`UPDATE products SET sku_matrix = '[]'::jsonb WHERE sku_matrix IS NULL`);
        await backfillGeneratedSkuMatrixForLegacyProducts();
        console.log("[DB] 'products.allowed_wa_sessions' column checked.");

        // Error Logs Table
        await query(`
            CREATE TABLE IF NOT EXISTS error_logs (
                id SERIAL PRIMARY KEY,
                error_message TEXT,
                stack_trace TEXT,
                context TEXT,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                resolved BOOLEAN DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved);
        `);
        console.log("[DB] 'error_logs' table checked/initialized.");

        // Expire Old Monthly Plans
        try {
            await query(`
                ALTER TABLE user_configs
                ADD COLUMN IF NOT EXISTS monthly_expires_at TIMESTAMP WITH TIME ZONE;
            `);
            await query(`
                UPDATE public.user_configs uc
                SET monthly_expires_at = tx.latest_plan_tx_at + INTERVAL '30 days'
                FROM (
                    SELECT user_email, MAX(created_at) AS latest_plan_tx_at
                    FROM payment_transactions
                    WHERE method LIKE 'plan_%'
                    GROUP BY user_email
                ) tx
                WHERE uc.email = tx.user_email
                  AND uc.subscription_plan IN ('starter', 'pro', 'enterprise', 'm1000', 'm3000', 'm7500')
                  AND uc.monthly_expires_at IS NULL;
            `);
            await query(`
                UPDATE public.user_configs 
                SET subscription_plan = 'none',
                    daily_limit = 0,
                    bonus_credit = 0,
                    monthly_limit = 0,
                    monthly_used = 0
                WHERE subscription_plan IN ('starter', 'pro', 'enterprise', 'm1000', 'm3000', 'm7500') 
                AND (monthly_expires_at IS NULL OR monthly_expires_at < NOW());
            `);
            console.log("[DB] Cleaned up expired monthly subscriptions.");
        } catch (expErr) {
            console.warn("[DB] Failed to expire old subscriptions:", expErr.message);
        }

        // API Usage Stats Table (CRITICAL for Dashboard)
        // Note: user_id references 'users(id)' to match postgres_schema.sql
        await query(`
            CREATE TABLE IF NOT EXISTS api_usage_stats (
                id BIGSERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                model TEXT NOT NULL,
                tokens INTEGER DEFAULT 0,
                cost NUMERIC DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_api_usage_stats_user_id ON api_usage_stats(user_id);
            CREATE INDEX IF NOT EXISTS idx_api_usage_stats_created_at ON api_usage_stats(created_at DESC);
        `);

        // Ensure 'cost' column exists (for backward compatibility if table was already there)
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_usage_stats' AND column_name='cost') THEN
                    ALTER TABLE api_usage_stats ADD COLUMN cost NUMERIC DEFAULT 0;
                END IF;
            END $$;
        `);
        console.log("[DB] 'api_usage_stats' table checked/initialized.");

        await query(`
            DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='api_list') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_list' AND column_name='usage_tokens_today') THEN
                        ALTER TABLE api_list ADD COLUMN usage_tokens_today INTEGER DEFAULT 0;
                    END IF;
                END IF;
            END $$;
        `);
        console.log("[DB] 'api_list' usage_tokens_today column checked.");

        // Ensure 'api_list' has unique constraint on 'api'"
        await query(`
            DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='api_list') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_list_api_key') THEN
                        ALTER TABLE api_list ADD CONSTRAINT api_list_api_key UNIQUE (api);
                    END IF;
                END IF;
            END $$;
        `);
        console.log("[DB] 'api_list' unique constraint checked.");

        // OpenRouter Engine Tables Repair
        await query(`
            CREATE TABLE IF NOT EXISTS public.openrouter_engine_config (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                config_type TEXT UNIQUE DEFAULT 'best_models',
                text_model TEXT,
                voice_model TEXT,
                image_model TEXT,
                text_model_details JSONB,
                voice_model_details JSONB,
                image_model_details JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_config' AND column_name='updated_at') THEN
                    ALTER TABLE openrouter_engine_config ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_config' AND column_name='text_model_details') THEN
                    ALTER TABLE openrouter_engine_config ADD COLUMN text_model_details JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_config' AND column_name='voice_model_details') THEN
                    ALTER TABLE openrouter_engine_config ADD COLUMN voice_model_details JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_config' AND column_name='image_model_details') THEN
                    ALTER TABLE openrouter_engine_config ADD COLUMN image_model_details JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_config' AND column_name='config_type') THEN
                    ALTER TABLE openrouter_engine_config ADD COLUMN config_type TEXT UNIQUE DEFAULT 'best_models';
                END IF;
            END $$;
        `);

        await query(`
            CREATE TABLE IF NOT EXISTS public.openrouter_engine_keys (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                api_key TEXT NOT NULL UNIQUE,
                label TEXT DEFAULT 'default',
                usage_limit NUMERIC DEFAULT 0,
                usage_used NUMERIC DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                last_checked_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_keys' AND column_name='last_checked_at') THEN
                    ALTER TABLE openrouter_engine_keys ADD COLUMN last_checked_at TIMESTAMPTZ DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_keys' AND column_name='created_at') THEN
                    ALTER TABLE openrouter_engine_keys ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_keys' AND column_name='usage_limit') THEN
                    ALTER TABLE openrouter_engine_keys ADD COLUMN usage_limit NUMERIC DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='openrouter_engine_keys' AND column_name='usage_used') THEN
                    ALTER TABLE openrouter_engine_keys ADD COLUMN usage_used NUMERIC DEFAULT 0;
                END IF;
            END $$;
        `);
        console.log("[DB] 'openrouter_engine' tables checked/initialized.");

        await ensureFbOrderTrackingTable();
        
        // Ensure 'status' and 'is_locked' columns exist in fb_order_tracking
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='status') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN status TEXT DEFAULT 'ongoing';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='is_locked') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='updated_at') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='reminder_count') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN reminder_count INTEGER DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='last_reminder_sent_at') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN last_reminder_sent_at TIMESTAMP WITH TIME ZONE;
                END IF;
            END $$;
        `);
        await query(`
            UPDATE fb_order_tracking
            SET
                updated_at = COALESCE(updated_at, created_at, NOW()),
                reminder_count = COALESCE(reminder_count, 0)
            WHERE updated_at IS NULL OR reminder_count IS NULL
        `);
        console.log("[DB] 'fb_order_tracking' status columns verified.");

        await ensureFbChatsTable();
        await ensureFbCommentsTable();
        await ensureAdsLibraryTable();
        console.log("[DB] Audit: Critical tables and constraints verified.");

    } catch (error) {
        console.error("[DB] Failed to init tables:", error);
    }
}

// Run init immediately
initTables();

// --- ADMIN TOOLS ---
async function addBalanceByEmail(email, amount) {
    // 1. Find User ID by Email
    // We check 'user_configs' (assuming email is stored or linked via auth)
    // Actually user_configs has user_id, but email is in auth.users or we might have it in page_access_token_message
    
    // Better approach: Search 'page_access_token_message' for any page owned by this email to get user_id?
    // Or check if we have an 'app_users' or similar mapping.
    // Wait, Supabase Auth stores email. We can't query auth.users directly via JS client easily without service role.
    // But we are using service role here.
    
    try {
        // Try to find user_id from our local tables first if possible
        // But 'user_configs' is keyed by user_id.
        // Let's try to find a user who has this email in 'page_access_token_message' (if they connected a page)
        // OR 'whatsapp_sessions' (if they connected WA)
        
        let userId = null;

        const userConfigResult = await query(
            'SELECT user_id FROM user_configs WHERE email = $1 LIMIT 1',
            [email]
        );
        if (userConfigResult.rows.length > 0) {
            userId = userConfigResult.rows[0].user_id;
        }

        if (!userId) {
            const waResult = await query(
                'SELECT user_id FROM whatsapp_sessions WHERE user_email = $1 LIMIT 1',
                [email]
            );
            if (waResult.rows.length > 0) {
                userId = waResult.rows[0].user_id;
            }
        }

        if (!userId) {
            const fbResult = await query(
                'SELECT user_id FROM page_access_token_message WHERE email = $1 LIMIT 1',
                [email]
            );
            if (fbResult.rows.length > 0) {
                userId = fbResult.rows[0].user_id;
            }
        }

        if (!userId) {
            throw new Error("User not found. Ensure the user exists in user_configs with a valid email.");
        }

        const balanceResult = await query(
            'SELECT balance FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(userId)]
        );
        if (balanceResult.rows.length === 0) {
            throw new Error("User config not found");
        }

        const currentBalance = Number(balanceResult.rows[0].balance || 0);
        const newBalance = currentBalance + Number(amount);

        await query(
            'UPDATE user_configs SET balance = $2 WHERE user_id::text = $1::text',
            [String(userId), newBalance]
        );

        await query(
            `INSERT INTO payment_transactions
                (user_email, amount, method, trx_id, sender_number, status)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
                email,
                Number(amount),
                'admin_manual_topup',
                `ADM_${Date.now()}`,
                'ADMIN',
                'completed'
            ]
        );

        return { success: true, newBalance };

    } catch (error) {
        console.error("Admin Topup Error:", error);
        throw error;
    }
}

// --- n8n Workflow Specific Tables ---

// 8. Save to fb_chats (n8n compatible)
async function saveFbChat(data) {
    const params = [
        data.page_id,
        data.sender_id,
        data.recipient_id,
        data.message_id,
        data.text,
        data.timestamp,
        data.status || 'pending',
        data.reply_by || 'user',
        data.token || 0,
        data.ai_model || null
    ];

    const run = async () => {
        await query(
            `INSERT INTO fb_chats
                (page_id, sender_id, recipient_id, message_id, text, timestamp, status, reply_by, token, ai_model)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (message_id) DO UPDATE SET
                page_id = EXCLUDED.page_id,
                sender_id = EXCLUDED.sender_id,
                recipient_id = EXCLUDED.recipient_id,
                text = EXCLUDED.text,
                timestamp = EXCLUDED.timestamp,
                status = EXCLUDED.status,
                reply_by = EXCLUDED.reply_by,
                token = EXCLUDED.token,
                ai_model = EXCLUDED.ai_model`,
            params
        );
    };

    try {
        await run();
    } catch (error) {
        if (error.message.includes('no unique or exclusion constraint') || error.code === '42P01') {
            console.log("[DB] fb_chats table or constraint missing. Ensuring...");
            await ensureFbChatsTable();
            await run();
        } else {
            console.error(`Error saving to fb_chats (msg: ${data.message_id}, page: ${data.page_id}):`, error.message);
        }
    }
}

async function ensureAdsLibraryTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS ads_library (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            ad_id TEXT NOT NULL,
            page_id TEXT NOT NULL,
            user_id TEXT,
            description TEXT,
            linked_product_ids JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(ad_id, page_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ads_library_page ON ads_library(page_id);
        CREATE INDEX IF NOT EXISTS idx_ads_library_user ON ads_library(user_id);
    `);
}

async function ensureFbChatsTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS fb_chats (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            page_id TEXT,
            sender_id TEXT,
            recipient_id TEXT,
            message_id TEXT UNIQUE,
            text TEXT,
            timestamp BIGINT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            reply_by TEXT,
            token INTEGER DEFAULT 0,
            ai_model TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_fb_chats_page_sender ON fb_chats(page_id, sender_id);
    `);
}

// 9. Get Old Messages from fb_chats
async function getFbChatHistory(pageId, senderId, limit = 5) {
    try {
        const result = await query(
            `SELECT *
             FROM fb_chats
             WHERE page_id = $1
               AND (sender_id = $2 OR recipient_id = $2)
             ORDER BY timestamp DESC
             LIMIT $3`,
            [pageId, senderId, limit]
        );
        return result.rows.reverse();
    } catch (error) {
        console.error("Error getting fb_chats history:", error);
        return [];
    }
}

// 10. n8n Debounce (fb_n8n_debounce)
async function checkN8nDebounce(key) {
    // Increment 'incr' for the key
    // This is a simplified version of n8n's debounce logic which might use a stored procedure or transaction
    // Here we just check if key exists or update timestamp
    // Ideally we use Redis, but for Postgres/Supabase:
    
    try {
        await query(
            `INSERT INTO fb_n8n_debounce (key, incr)
             VALUES ($1,1)
             ON CONFLICT (key) DO UPDATE SET incr = fb_n8n_debounce.incr + 1`,
            [key]
        );
        return true;
    } catch (error) {
        console.error("Error in checkN8nDebounce:", error);
        return false;
    }
}

async function getFbChatById(messageId) {
    if (!messageId) return null;
    try {
        const result = await query(
            'SELECT * FROM fb_chats WHERE message_id = $1 LIMIT 1',
            [messageId]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error("Error in getFbChatById:", error);
        return null;
    }
}

async function getWhatsAppChatById(messageId) {
    if (!messageId) return null;
    try {
        const result = await query(
            'SELECT * FROM whatsapp_chats WHERE message_id = $1 LIMIT 1',
            [messageId]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error("Error in getWhatsAppChatById:", error);
        return null;
    }
}

async function getMessageById(messageId) {
    if (!messageId) return null;
    
    try {
        const fbResult = await query(
            'SELECT text FROM fb_chats WHERE message_id = $1 LIMIT 1',
            [messageId]
        );
        if (fbResult.rows.length > 0 && fbResult.rows[0].text) {
            return fbResult.rows[0].text;
        }

        const waResult = await query(
            'SELECT text FROM whatsapp_chats WHERE message_id = $1 LIMIT 1',
            [messageId]
        );
        if (waResult.rows.length > 0 && waResult.rows[0].text) {
            return waResult.rows[0].text;
        }

        return null;
    } catch (error) {
        console.error("Error in getMessageById:", error);
        return null;
    }
}

// 12. Create WhatsApp Entry (whatsapp_message_database & whatsapp_sessions)
async function createWhatsAppEntry(sessionName, userId, planDays = 30, initialStatus = 'connected', userEmail = null) {
    const { query } = require('./pgClient');

    const existingResult = await query(
        'SELECT * FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
        [sessionName]
    );
    if (existingResult.rows.length > 0) {
        return existingResult.rows[0];
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(planDays));

    const insertResult = await query(
        `INSERT INTO whatsapp_message_database
            (session_name, user_id, email, active, status, reply_message, order_tracking, subscription_status, text_prompt, expires_at, plan_days, ai_provider, chat_model, cheap_engine)
         VALUES ($1,$2,$3,true,$4,true,true,'active',
                 'You are a helpful assistant for this store. Reply in a friendly manner.',
                 $5,$6,$7,$8,$9)
         RETURNING *`,
        [sessionName, userId, userEmail, initialStatus, expiresAt.toISOString(), parseInt(planDays), 'google', 'gemini-2.5-flash', true]
    );

    const row = insertResult.rows[0];

    // --- FREE CREDITS LOGIC: Give 100 credits for new integration ---
    if (existingResult.rows.length === 0) {
        console.log(`[WhatsApp] New integration detected for session ${sessionName}. Giving 100 free credits.`);
        try {
            // Check if this session has EVER received free credits to prevent exploit
            const alreadyGranted = await query(
                'SELECT id FROM integration_credit_history WHERE integration_id = $1 AND platform = $2',
                [String(sessionName), 'whatsapp']
            );

            if (alreadyGranted.rowCount === 0) {
                // --- FREE CREDITS REMOVED ---
            // await query(
            //     'UPDATE user_configs SET message_credit = message_credit + 100 WHERE user_id::text = $1::text OR email = $2',
            //     [String(userId), userEmail]
            // );
                
                // Mark as granted permanently
                await query(
                    'INSERT INTO integration_credit_history (integration_id, platform, user_id, credit_type, amount) VALUES ($1, $2, $3, $4, $5)',
                    [String(sessionName), 'whatsapp', String(userId), 'welcome_bonus', 100]
                );
                
                console.log(`[WhatsApp] Added 100 free credits to user and logged to history.`);
            } else {
                console.log(`[WhatsApp] Session ${sessionName} already received welcome bonus in the past. Skipping.`);
            }
        } catch (creditErr) {
            console.error('[WhatsApp] Failed to grant free credits:', creditErr.message);
            // Attempt to create history table if it doesn't exist
            if (creditErr.message.includes('relation "integration_credit_history" does not exist')) {
                try {
                    await query(`
                        CREATE TABLE IF NOT EXISTS integration_credit_history (
                            id SERIAL PRIMARY KEY,
                            integration_id TEXT NOT NULL,
                            platform TEXT NOT NULL,
                            user_id TEXT NOT NULL,
                            credit_type TEXT NOT NULL,
                            amount INTEGER DEFAULT 0,
                            granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_integration_credit_history_id ON integration_credit_history(integration_id);
                    `);
                    console.log("[DB] Created integration_credit_history table.");
                } catch (tableErr) {
                    console.error("[DB] Failed to create credit history table:", tableErr.message);
                }
            }
        }
    }

    try {
        await query(
            `INSERT INTO whatsapp_sessions
                (session_name, session_id, user_id, user_email, plan_days, expires_at, created_at, updated_at, status, qr, qr_code)
             VALUES ($1,$1,$2,$3,$4,$5,now(),now(),$6,'',NULL)
             ON CONFLICT (session_name) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                user_email = EXCLUDED.user_email,
                plan_days = EXCLUDED.plan_days,
                expires_at = EXCLUDED.expires_at,
                updated_at = now(),
                status = EXCLUDED.status`,
            [sessionName, userId, userEmail, parseInt(planDays), expiresAt.toISOString(), initialStatus]
        );
    } catch (e) {
        console.warn("[DB] Failed to insert into whatsapp_sessions (ignoring):", e.message);
    }

    return row;
}

// 12.5 Create WhatsApp Session Entry (Public Table)
async function createWhatsAppSessionEntry(sessionName, userId, planDays = 30, initialStatus = 'connected', userEmail = null) {
    const { query } = require('./pgClient');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(planDays));

    const result = await query(
        `INSERT INTO whatsapp_sessions
            (session_name, session_id, user_id, user_email, plan_days, expires_at, created_at, updated_at, status, qr, qr_code)
         VALUES ($1,$1,$2,$3,$4,$5,now(),now(),$6,'',NULL)
         ON CONFLICT (session_name) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            user_email = EXCLUDED.user_email,
            plan_days = EXCLUDED.plan_days,
            expires_at = EXCLUDED.expires_at,
            updated_at = now(),
            status = EXCLUDED.status
         RETURNING *`,
        [sessionName, userId, userEmail, parseInt(planDays), expiresAt.toISOString(), initialStatus]
    );

    return result.rows[0];
}

// --- WhatsApp Specific Functions ---

// 13. Get WhatsApp Config & Prompts
async function getWhatsAppConfig(sessionName) {
    const { query } = require('./pgClient');

    await query(`
        ALTER TABLE whatsapp_message_database
        ADD COLUMN IF NOT EXISTS provider_type text,
        ADD COLUMN IF NOT EXISTS waba_id text,
        ADD COLUMN IF NOT EXISTS phone_number_id text,
        ADD COLUMN IF NOT EXISTS cloud_access_token text
    `);

    const mainResult = await query(
        `SELECT *
         FROM whatsapp_message_database
         WHERE session_name = $1
            OR waba_id = $1
            OR phone_number_id = $1
         ORDER BY
            CASE
                WHEN session_name = $1 THEN 0
                WHEN waba_id = $1 THEN 1
                WHEN phone_number_id = $1 THEN 2
                ELSE 3
            END
         LIMIT 1`,
        [sessionName]
    );
    if (mainResult.rows.length === 0) return null;

    const data = mainResult.rows[0];

    if (!data.text_prompt) {
        data.text_prompt = 'You are a helpful sales assistant.';
    }

    // 2. Fetch Centralized User Credit (Sync across all members & pages)
    if (data.user_id) {
        const creditResult = await query(
            'SELECT message_credit, bonus_credit, permanent_credit, daily_limit, daily_used, subscription_plan FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [String(data.user_id)]
        );
        if (creditResult.rows.length > 0) {
            const row = creditResult.rows[0];
            data.message_credit = row.message_credit || 0;
            data.bonus_credit = row.bonus_credit || 0;
            data.permanent_credit = row.permanent_credit || 0;
            data.daily_limit = row.daily_limit || 0;
            data.daily_used = row.daily_used || 0;
            // Also sync subscription status if it's 'active' or 'none'
            if (row.subscription_plan) {
                data.subscription_status = row.subscription_plan;
            }
            data.credit_source = 'shared_user_balance';
        }
    }

    if (data.message_credit === undefined) data.message_credit = 0;

    const defaultProvider = 'google';
    const defaultModel = 'gemini-2.5-flash';

    let needsAiUpdate = false;
    if (!data.ai_provider && !data.ai) {
        data.ai_provider = defaultProvider;
        data.ai = defaultProvider;
        needsAiUpdate = true;
    } else if (!data.ai_provider && data.ai) {
        data.ai_provider = data.ai;
        needsAiUpdate = true;
    } else if (!data.ai && data.ai_provider) {
        data.ai = data.ai_provider;
    } else if (data.ai && data.ai_provider && data.ai !== data.ai_provider) {
        data.ai = data.ai_provider;
    }
    if (!data.chat_model) {
        data.chat_model = defaultModel;
        needsAiUpdate = true;
    }
    if (data.cheap_engine === undefined || data.cheap_engine === null) {
        data.cheap_engine = true;
        needsAiUpdate = true;
    }
    if (data.pro_plus_mode === undefined || data.pro_plus_mode === null) {
        data.pro_plus_mode = false;
        needsAiUpdate = true;
    }
    if (needsAiUpdate) {
        await query(
            'UPDATE whatsapp_message_database SET ai_provider = $1, chat_model = $2, voice_model = $3, vision_model = $4, cheap_engine = $5, pro_plus_mode = $6 WHERE session_name = $7',
            [data.ai_provider || data.ai, data.chat_model, data.voice_model || null, data.vision_model || null, data.cheap_engine, data.pro_plus_mode, sessionName]
        );
    }

    const labelResult = await query(
        'SELECT label_name, ai_action FROM label_actions WHERE page_id = $1',
        [sessionName]
    );
    data.label_actions = labelResult.rows;

    const promptResult = await query(
        'SELECT * FROM page_prompts WHERE page_id = $1 LIMIT 1',
        [sessionName]
    );
    if (promptResult.rows.length > 0) {
        data.page_prompts = promptResult.rows[0];
    }

    return data;
}

// 14. Save WhatsApp Chat
async function saveWhatsAppChat(data) {
    const { query } = require('./pgClient');
    const run = async () => {
        await query(
            `INSERT INTO whatsapp_chats
                (session_name, sender_id, recipient_id, message_id, text, timestamp, status, reply_by, token_usage, model_used, is_group, group_id, group_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (message_id) DO UPDATE SET
                text = EXCLUDED.text,
                timestamp = EXCLUDED.timestamp,
                status = EXCLUDED.status,
                reply_by = EXCLUDED.reply_by,
                token_usage = EXCLUDED.token_usage,
                model_used = EXCLUDED.model_used,
                is_group = EXCLUDED.is_group,
                group_id = EXCLUDED.group_id,
                group_name = EXCLUDED.group_name`,
            [
                data.session_name,
                data.sender_id,
                data.recipient_id,
                data.message_id,
                data.text,
                data.timestamp,
                data.status,
                data.reply_by,
                data.token_usage || 0,
                data.model_used || null,
                data.is_group || false,
                data.group_id || null,
                data.group_name || null
            ]
        );
    };

    try {
        await run();
    } catch (err) {
        // If constraint is missing, try to add it and retry
        if (err.message.includes('no unique or exclusion constraint') || err.code === '42P01') {
            console.log("[DB] whatsapp_chats table or constraint missing. Ensuring...");
            await ensureWhatsAppChatsTable();
            await run();
        } else {
            throw err;
        }
    }
}

async function ensureWhatsAppChatsTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS whatsapp_chats (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            session_name TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            recipient_id TEXT,
            message_id TEXT NOT NULL UNIQUE,
            text TEXT,
            timestamp BIGINT,
            status TEXT,
            reply_by TEXT,
            token_usage INTEGER DEFAULT 0,
            is_group BOOLEAN DEFAULT FALSE,
            group_id TEXT,
            group_name TEXT,
            model_used TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_session_sender ON whatsapp_chats(session_name, sender_id);
        CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_timestamp ON whatsapp_chats(timestamp DESC);
        
        -- Explicitly add unique constraint if it somehow doesn't exist
        DO $$ 
        BEGIN 
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_chats_message_id_key') THEN
                ALTER TABLE whatsapp_chats ADD CONSTRAINT whatsapp_chats_message_id_key UNIQUE (message_id);
            END IF;
        END $$;
    `);
}

// 15. Get WhatsApp Chat History (Deprecated - Removed Duplicate)
// See function at line ~460


// 16. Check WhatsApp Duplicate
async function checkWhatsAppDuplicate(messageId) {
    if (!messageId) return false;

    try {
        const existing = await query(
            'SELECT id FROM whatsapp_debounce WHERE message_id = $1 LIMIT 1',
            [messageId]
        );
        if (existing.rows.length > 0) {
            return true;
        }
        await query(
            'INSERT INTO whatsapp_debounce (message_id) VALUES ($1)',
            [messageId]
        );
        return false;
    } catch (error) {
        console.error("Error in checkWhatsAppDuplicate:", error);
        return false;
    }
}

// 16.5 Approve Deposit Transaction
async function approveDepositTransaction(txn) {
    const { getPool } = require('./pgClient');
    const pool = getPool();
    const client = await pool.connect();
    try {
        console.log(`[ApproveTxn] Processing txn ID: ${txn.id}, Email: ${txn.user_email}, Amount: ${txn.amount}`);
        
        // 1. Check if already processed
        const checkRes = await client.query("SELECT status FROM payment_transactions WHERE id = $1", [txn.id]);
        if (checkRes.rows.length > 0 && (checkRes.rows[0].status === 'completed' || checkRes.rows[0].status === 'approved')) {
            console.log(`[ApproveTxn] Transaction ${txn.id} already completed/approved. Skipping.`);
            return true;
        }

        await client.query('BEGIN');

        // 0. Find user_id from users table
        let userId = null;

        // Priority 1: Check local 'users' table (public.users) - This is the primary auth table now
        try {
            await client.query('SAVEPOINT public_lookup');
            const publicUserRes = await client.query('SELECT id FROM public.users WHERE LOWER(email) = LOWER($1)', [txn.user_email]);
            if (publicUserRes.rows.length > 0) {
                userId = publicUserRes.rows[0].id;
            }
            await client.query('RELEASE SAVEPOINT public_lookup');
        } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT public_lookup');
            console.warn("[ApproveTxn] Failed to query public.users:", e.message);
        }

        if (!userId) {
            // Priority 2: Check user_configs if email exists there
            const configRes = await client.query('SELECT user_id FROM user_configs WHERE LOWER(email) = LOWER($1)', [txn.user_email]);
            if (configRes.rows.length > 0) {
                userId = configRes.rows[0].user_id;
            }
        }

        if (!userId) {
            // Priority 3: Try Supabase auth.users (Legacy/Fallback)
            try {
                await client.query('SAVEPOINT auth_lookup');
                const userRes = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1)', [txn.user_email]);
                if (userRes.rows.length > 0) {
                    userId = userRes.rows[0].id;
                }
                await client.query('RELEASE SAVEPOINT auth_lookup');
            } catch (e) {
                await client.query('ROLLBACK TO SAVEPOINT auth_lookup');
                console.warn("[ApproveTxn] Failed to query auth.users:", e.message);
            }
        }

        if (!userId) {
            console.error(`[ApproveTxn] User not found for email: ${txn.user_email}`);
            throw new Error(`User not found for email: ${txn.user_email} (Please ask user to login first to create account)`);
        }

        // 1. Update transaction status
        // Use 'completed' to match other flows (admin_manual_topup, redeemCoupon)
        await client.query(
            "UPDATE payment_transactions SET status = 'completed' WHERE id = $1",
            [txn.id]
        );

        // 2. Add balance to user
        const amount = parseFloat(txn.amount);
        if (isNaN(amount)) {
             throw new Error(`Invalid amount: ${txn.amount}`);
        }
        
        // Update user_configs balance
        // We use UPSERT to ensure if row doesn't exist (but user exists in auth), it's created
        const updateRes = await client.query(
            `INSERT INTO user_configs (user_id, balance, email)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) 
             DO UPDATE SET balance = COALESCE(user_configs.balance, 0) + $2, email = EXCLUDED.email
             RETURNING balance`,
            [userId, amount, txn.user_email]
        );
        
        const newBalance = updateRes.rows[0]?.balance;

        await client.query('COMMIT');
        console.log(`[ApproveTxn] Successfully approved txn ${txn.id} for user ${userId}. New Balance: ${newBalance}`);
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in approveDepositTransaction:", error);
        throw error;
    } finally {
        client.release();
    }
}

// 17. Save WhatsApp Order Tracking
async function saveWhatsAppOrderTracking(orderData) {
    let { session_name, sender_id, product_name, number, location, product_quantity, price, customer_email, customer_name } = orderData;
    const { query } = require('./pgClient');

    // Clean product name
    if (product_name) {
        if (product_name.includes('|')) product_name = product_name.split('|')[0].trim();
        product_name = product_name.replace(/Item \d+:/gi, '').replace(/##product/gi, '').replace(/"/g, '').replace(/\[.*?\]/g, '').trim();
        if (!product_name) product_name = 'Recovered Lead';
    }

    try {
        await query(`
            ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS customer_email text;
            ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS customer_name text;
            ALTER TABLE whatsapp_order_tracking ADD COLUMN IF NOT EXISTS status text DEFAULT 'ongoing';
        `);
    } catch (e) {
        console.warn("[DB] whatsapp_order_tracking migration failed:", e.message);
    }

    try {
        // SMART MERGE: Last 1 hour
        const recentOrder = await query(
            `SELECT id, product_name, number, location, product_quantity, price, customer_email, customer_name
             FROM whatsapp_order_tracking 
             WHERE session_name = $1::text AND sender_id = $2::text 
             AND created_at >= NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC LIMIT 1`,
            [session_name || null, sender_id || null]
        );

        if (recentOrder.rows.length > 0) {
            const existing = recentOrder.rows[0];
            const updates = [];
            const values = [];
            let idx = 1;

            if (product_name && product_name !== 'Recovered Lead' && product_name !== 'Pending') {
                updates.push(`product_name = $${idx++}::text`);
                values.push(product_name);
            }
            if (number && number !== 'Pending') {
                updates.push(`number = $${idx++}::text`);
                values.push(number);
            }
            if (location && location !== 'N/A' && location !== 'Pending' && location !== '') {
                updates.push(`location = $${idx++}::text`);
                values.push(location);
            }
            if (product_quantity && product_quantity !== '1') {
                updates.push(`product_quantity = $${idx++}::text`);
                values.push(product_quantity);
            }
            if (price && price !== '0') {
                updates.push(`price = $${idx++}::text`);
                values.push(price);
            }
            if (customer_email) {
                updates.push(`customer_email = $${idx++}::text`);
                values.push(customer_email);
            }
            if (customer_name && customer_name !== 'Pending') {
                updates.push(`customer_name = $${idx++}::text`);
                values.push(customer_name);
            }

            if (updates.length > 0) {
                values.push(existing.id);
                const updateResult = await query(
                    `UPDATE whatsapp_order_tracking SET ${updates.join(', ')} WHERE id = $${idx}::bigint RETURNING *`,
                    values
                );
                console.log(`[WA Order] Smart Merged data into ID ${existing.id}`);
                return updateResult.rows[0];
            }
            
            if (number && existing.number && number !== existing.number) {
                console.log(`[WA Order] New number for ${sender_id}. New row.`);
            } else {
                return existing;
            }
        }

        if (!number && !product_name && !location) return null;

        const result = await query(
            `INSERT INTO whatsapp_order_tracking
                (session_name, sender_id, product_name, number, location, product_quantity, price, customer_email, customer_name)
             VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text)
             RETURNING *`,
            [session_name || null, sender_id || null, product_name || null, number || null, location || null, product_quantity || null, price || null, customer_email || null, customer_name || null]
        );
        return result.rows[0];
    } catch (error) {
        console.error("Error in saveWhatsAppOrderTracking:", error);
        return null;
    }
}

// 17. Get WhatsApp Chat History
async function getWhatsAppChatHistory(sessionName, senderId, limit = 10) {
    const { query } = require('./pgClient');
    const result = await query(
        `SELECT * FROM whatsapp_chats
         WHERE session_name = $1
           AND (
                (sender_id = $2 AND recipient_id = $1)
             OR (sender_id = $1 AND recipient_id = $2)
           )
         ORDER BY timestamp DESC
         LIMIT $3`,
        [sessionName, senderId, limit]
    );

    return result.rows.reverse().map(msg => ({
        role: msg.reply_by === 'user' ? 'user' : (msg.reply_by === 'system' ? 'system' : 'assistant'),
        content: msg.text || ''
    }));
}

// --- Helper: Get Last WhatsApp Message (Raw) for Duplicate Check ---
async function getLastWhatsAppMessage(sessionName, recipientId) {
    const { query } = require('./pgClient');
    const result = await query(
        `SELECT * FROM whatsapp_chats
         WHERE session_name = $1
           AND (
                (sender_id = $2 AND recipient_id = $1)
             OR (sender_id = $1 AND recipient_id = $2)
           )
         ORDER BY timestamp DESC
         LIMIT 1`,
        [sessionName, recipientId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
}

// 18. Deduct WhatsApp Credit (Smart Routing: Daily -> Bonus -> Permanent)
async function deductWhatsAppCredit(sessionName, amount = 1) {
    const { query } = require('./pgClient');

    try {
        // Migration on-the-fly: Ensure columns exist in user_configs
        try {
            await query(`
                ALTER TABLE user_configs 
                ADD COLUMN IF NOT EXISTS daily_limit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS daily_used NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS monthly_used NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS bonus_credit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS permanent_credit NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                ADD COLUMN IF NOT EXISTS last_monthly_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
            `);
        } catch (e) {}

        const sessionResult = await query(
            'SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
            [sessionName]
        );
        if (sessionResult.rows.length === 0 || !sessionResult.rows[0].user_id) {
            console.error(`[WA Credit] Session ${sessionName} not linked to user or not found.`);
            return false;
        }

        const userId = sessionResult.rows[0].user_id;
        const userIdStr = String(userId);

        const configResult = await query(
            'SELECT * FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
            [userIdStr]
        );
        if (configResult.rows.length === 0) {
            console.error(`[WA Credit] User config not found for ${userId}.`);
            return false;
        }

        const config = configResult.rows[0];

        // --- 1. RESET CHECKS (DAILY & MONTHLY) ---
        const now = new Date();
        const lastReset = new Date(config.last_reset_at || 0);
        const lastMonthlyReset = new Date(config.last_monthly_reset_at || 0);
        
        const isNewDay = lastReset.toDateString() !== now.toDateString();
        const isNewMonth = lastMonthlyReset.getMonth() !== now.getMonth() || lastMonthlyReset.getFullYear() !== now.getFullYear();

        let dailyUsed = Number(config.daily_used || 0);
        let bonusCredit = Number(config.bonus_credit || 0);
        let monthlyUsed = Number(config.monthly_used || 0);

        if (isNewMonth) {
            // Reset usage counters AND Monthly Bonus for new month
            dailyUsed = 0;
            monthlyUsed = 0;
            await query(
                'UPDATE user_configs SET daily_used = 0, monthly_used = 0, bonus_credit = 0, last_reset_at = NOW(), last_monthly_reset_at = NOW() WHERE user_id::text = $1',
                [userIdStr]
            );
        } else if (isNewDay) {
            dailyUsed = 0;
            await query(
                'UPDATE user_configs SET daily_used = 0, last_reset_at = NOW() WHERE user_id::text = $1',
                [userIdStr]
            );
        }

        // --- 2. DEDUCTION LOGIC (SMART ROUTING: Daily -> Bonus -> Free -> Permanent) ---
        
        // Priority 1: Daily Limit (RPD - Resets Daily)
        if (Number(config.daily_limit || 0) > dailyUsed) {
            await query(
                'UPDATE user_configs SET daily_used = daily_used + $1, monthly_used = monthly_used + $1 WHERE user_id::text = $2',
                [amount, userIdStr]
            );
            console.log(`[WA Credit] Deducted from Daily Limit for User ${userIdStr}`);
            return true;
        }

        // Priority 2: Bonus Credit (Monthly Bonus - Resets Monthly)
        if (bonusCredit > 0) {
            const deduct = Math.min(bonusCredit, amount);
            await query(
                'UPDATE user_configs SET bonus_credit = bonus_credit - $1, monthly_used = monthly_used + $1 WHERE user_id::text = $2',
                [deduct, userIdStr]
            );
            console.log(`[WA Credit] Deducted from Bonus Credit for User ${userIdStr}`);
            return true;
        }

        // Priority 3: Legacy Message Credit (Free 100 Messages)
        if (Number(config.message_credit || 0) > 0) {
            const deduct = Math.min(Number(config.message_credit), amount);
            await query(
                'UPDATE user_configs SET message_credit = message_credit - $1 WHERE user_id::text = $2',
                [deduct, userIdStr]
            );
            console.log(`[WA Credit] Deducted from Free Message Credit for User ${userIdStr}`);
            return true;
        }

        // Priority 4: Permanent Credit (Never Expires)
        if (Number(config.permanent_credit || 0) > 0) {
            const deduct = Math.min(Number(config.permanent_credit), amount);
            await query(
                'UPDATE user_configs SET permanent_credit = permanent_credit - $1 WHERE user_id::text = $2',
                [deduct, userIdStr]
            );
            console.log(`[WA Credit] Deducted from Permanent Credit for User ${userIdStr}`);
            return true;
        }

        console.warn(`[WA Credit] Insufficient credits for User ${userIdStr}.`);
        return false;
    } catch (err) {
        console.error("Error in smart WA credit deduction:", err);
        return false;
    }
}

// 19. Save WhatsApp Contact (Lead)
async function saveWhatsAppContact(data) {
    const { query } = require('./pgClient');
    const run = async () => {
        const existingResult = await query(
            'SELECT name FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
            [data.session_name, data.phone_number]
        );

        const updates = {
            session_name: data.session_name,
            phone_number: data.phone_number,
            last_interaction: new Date().toISOString()
        };

        if (data.lid) {
            updates.lid = data.lid;
        }

        if (data.name && data.name !== 'Unknown' && data.name.trim() !== '') {
            updates.name = data.name;
        } else if (existingResult.rows.length === 0) {
            updates.name = 'Unknown';
        }

        const params = [
            updates.session_name,
            updates.phone_number,
            updates.lid || null,
            updates.name || null,
            updates.last_interaction
        ];

        await query(
            `INSERT INTO whatsapp_contacts
                (session_name, phone_number, lid, name, last_interaction)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (session_name, phone_number) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, whatsapp_contacts.name),
                lid = COALESCE(EXCLUDED.lid, whatsapp_contacts.lid),
                last_interaction = EXCLUDED.last_interaction`,
            params
        );
    };

    try {
        await run();
    } catch (err) {
        const msg = err && err.message ? String(err.message) : '';
        if (err && (err.code === '42P01' || err.code === '42703' || msg.includes('last_interaction') || msg.includes('whatsapp_contacts'))) {
            await ensureWhatsAppContactsTable();
            await run();
            return;
        }
        throw err;
    }
}

async function ensureWhatsAppContactsTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS whatsapp_contacts (
            id SERIAL PRIMARY KEY,
            session_name TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            lid TEXT,
            name TEXT,
            is_locked BOOLEAN DEFAULT FALSE,
            last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(session_name, phone_number)
        );
        CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_session_phone ON whatsapp_contacts(session_name, phone_number);
    `);

    await query(`
        DO $$ 
        BEGIN 
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='phone_number') THEN
                ALTER TABLE whatsapp_contacts ADD COLUMN phone_number TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='lid') THEN
                ALTER TABLE whatsapp_contacts ADD COLUMN lid TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='name') THEN
                ALTER TABLE whatsapp_contacts ADD COLUMN name TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='is_locked') THEN
                ALTER TABLE whatsapp_contacts ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_contacts' AND column_name='last_interaction') THEN
                ALTER TABLE whatsapp_contacts ADD COLUMN last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW();
            END IF;
        END $$;
    `);
}
// 20. Toggle WhatsApp Lock (Handover)
async function toggleWhatsAppLock(sessionName, phoneNumber, isLocked) {
    const { query } = require('./pgClient');
    console.log(`[WA Lock] Toggling lock for ${sessionName} - User: ${phoneNumber} -> ${isLocked}`);

    if (!sessionName || !phoneNumber) {
        console.error("[WA Lock] Missing sessionName or phoneNumber");
        return false;
    }

    const run = async () => {
        await query(
            `INSERT INTO whatsapp_contacts
                (session_name, phone_number, is_locked, name, last_interaction)
             VALUES ($1,$2,$3,'Unknown',$4)
             ON CONFLICT (session_name, phone_number) DO UPDATE SET
                is_locked = EXCLUDED.is_locked,
                last_interaction = EXCLUDED.last_interaction`,
            [sessionName, phoneNumber, isLocked, new Date().toISOString()]
        );
    };

    try {
        await run();
        console.log(`[WA Lock] Upsert successful for ${phoneNumber}`);
        return true;
    } catch (err) {
        if (err && (err.code === '42P01' || err.code === '42703')) {
            await ensureWhatsAppContactsTable();
            try {
                await run();
                console.log(`[WA Lock] Upsert successful for ${phoneNumber}`);
                return true;
            } catch (inner) {
                console.error(`[WA Lock] Unexpected error: ${inner.message}`);
                return false;
            }
        }
        console.error(`[WA Lock] Unexpected error: ${err.message}`);
        return false;
    }
}

// 27. Check WhatsApp Emoji Lock (History Scan - Enhanced)
async function checkWhatsAppEmojiLock(sessionName, phoneNumber, lockEmojis, unlockEmojis) {
    const { query } = require('./pgClient');
    try {
        console.log(`[WA Lock] Checking emoji lock history. Lock emojis: [${lockEmojis.join(', ')}], Unlock emojis: [${unlockEmojis.join(', ')}]`);
        // Increase LIMIT to 20 for deeper history scan
        const numbers = Array.isArray(phoneNumber) ? phoneNumber.filter(Boolean) : [phoneNumber].filter(Boolean);
        const result = await query(
            `SELECT text, reply_by, timestamp
             FROM whatsapp_chats
             WHERE session_name = $1
               AND recipient_id = ANY($2)
               AND reply_by IN ('admin','bot')
             ORDER BY timestamp DESC
             LIMIT 20`,
            [sessionName, numbers]
        );

        if (result.rows.length === 0) return null;

        // Helper to normalize emojis (remove VS16 \uFE0F and NFC)
        const normalize = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');

        // Pre-normalize config emojis and filter out any empty strings
        const normLock = lockEmojis.map(normalize).filter(e => e.length > 0);
        const normUnlock = unlockEmojis.map(normalize).filter(e => e.length > 0);

        for (const msg of result.rows) {
            const rawText = (msg.text || '').trim();
            if (!rawText) continue;

            const normText = normalize(rawText);

            // Check Lock Emojis
            for (const emoji of normLock) {
                if (normText.includes(emoji)) {
                    console.log(`[WA Lock] Found Lock Emoji (Normalized: ${emoji}) in message: "${rawText}"`);
                    return { locked: true, timestamp: msg.timestamp };
                }
            }

            // Check Unlock Emojis
            for (const emoji of normUnlock) {
                if (normText.includes(emoji)) {
                    console.log(`[WA Lock] Found Unlock Emoji (Normalized: ${emoji}) in message: "${rawText}"`);
                    return { locked: false, timestamp: msg.timestamp };
                }
            }
        }

        return null;
    } catch (e) {
        console.error("Error checking emoji lock history:", e);
        return null;
    }
}

// 21. Get WhatsApp Contact (Check Lock Status)
async function getWhatsAppContact(sessionName, phoneNumber) {
    const { query } = require('./pgClient');
    const run = async () => {
        const result = await query(
            'SELECT * FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
            [sessionName, phoneNumber]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0];
    };

    try {
        return await run();
    } catch (err) {
        if (err && (err.code === '42P01' || err.code === '42703')) {
            await ensureWhatsAppContactsTable();
            return await run();
        }
        throw err;
    }
}

async function getWhatsAppContactByLid(sessionName, lid) {
    const { query } = require('./pgClient');
    const run = async () => {
        const result = await query(
            'SELECT * FROM whatsapp_contacts WHERE session_name = $1 AND lid = $2 LIMIT 1',
            [sessionName, lid]
        );
        if (result.rows.length === 0) return null;
        return result.rows[0];
    };

    try {
        return await run();
    } catch (err) {
        if (err && (err.code === '42P01' || err.code === '42703')) {
            await ensureWhatsAppContactsTable();
            return await run();
        }
        throw err;
    }
}



// 11. Save Comment (n8n compatible)
async function saveFbComment(data) {
    const run = async () => {
        await query(
            `INSERT INTO fb_comments
                (comment_id, page_id, sender_id, parent_id, post_id, message, reply_text, created_at, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),COALESCE($9,'replied'))
             ON CONFLICT (comment_id) DO UPDATE SET
                page_id = EXCLUDED.page_id,
                sender_id = EXCLUDED.sender_id,
                parent_id = EXCLUDED.parent_id,
                post_id = EXCLUDED.post_id,
                message = EXCLUDED.message,
                reply_text = EXCLUDED.reply_text,
                status = EXCLUDED.status`,
            [
                data.comment_id,
                data.page_id,
                data.sender_id,
                data.parent_id,
                data.post_id,
                data.message,
                data.reply_text,
                data.created_at || null,
                data.status || null
            ]
        );
    };

    try {
        await run();
    } catch (error) {
        if (error.message.includes('no unique or exclusion constraint') || error.code === '42P01') {
            console.log("[DB] fb_comments table or constraint missing. Ensuring...");
            await ensureFbCommentsTable();
            await run();
        } else {
            console.error("Error saving comment:", error);
        }
    }
}

async function ensureFbCommentsTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS fb_comments (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            comment_id TEXT UNIQUE,
            page_id TEXT,
            sender_id TEXT,
            parent_id TEXT,
            post_id TEXT,
            message TEXT,
            reply_text TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            status TEXT DEFAULT 'replied'
        );
        CREATE INDEX IF NOT EXISTS idx_fb_comments_page ON fb_comments(page_id);
    `);
}

async function logMessage(msgData) {
    const { page_id, sender_id, recipient_id, message_id, text, reply_to, image, timestamp, status, reply_by } = msgData;

    try {
        await query(
            `INSERT INTO backend_chat_histories
                (page_id, sender_id, recipient_id, message_id, text, reply_to, image, timestamp, status, reply_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                page_id,
                sender_id,
                recipient_id,
                message_id,
                text,
                reply_to || null,
                image,
                timestamp,
                status,
                reply_by || 'user'
            ]
        );
    } catch (err) {
        console.error('[DB] Unexpected error logging message:', err);
    }
}

// 12. Save Order (Unified Wrapper)
async function saveOrder(orderData) {
    const { platform } = orderData;
    if (platform === 'whatsapp') {
        return await saveWhatsAppOrderTracking({
            session_name: orderData.page_id, // For WA, page_id is session_name
            sender_id: orderData.sender_id,
            product_name: orderData.product_name,
            number: orderData.phone,
            location: orderData.address,
            product_quantity: orderData.quantity,
            price: orderData.price,
            customer_email: orderData.customer_email,
            customer_name: orderData.customer_name
        });
    } else {
        return await saveOrderTracking({
            page_id: orderData.page_id,
            sender_id: orderData.sender_id,
            product_name: orderData.product_name,
            number: orderData.phone,
            location: orderData.address,
            product_quantity: orderData.quantity,
            price: orderData.price,
            sender_number: orderData.phone,
            customer_email: orderData.customer_email,
            customer_name: orderData.customer_name
        });
    }
}

async function updateContactPhone(pageId, senderId, phone) {
    try {
        await query(
            `UPDATE whatsapp_contacts 
             SET phone_number = $1 
             WHERE session_name = $2 AND (phone_number = $3 OR lid = $3)`,
            [phone, pageId, senderId]
        );
        return true;
    } catch (e) {
        console.warn("[DB] Failed to update contact phone:", e.message);
        return false;
    }
}

// 12. Save Order Tracking (Messenger)
async function saveOrderTracking(orderData) {
    let { page_id, sender_id, product_name, number, location, product_quantity, price, sender_number, customer_email } = orderData;
    
    // --- 1. SMART DATA CLEANING (Filter out templates like "নাম: ঠিকানা:") ---
    const cleanValue = (val) => {
        if (!val || typeof val !== 'string') return val;
        // Remove common prompt templates like (জেলা, থানা...) or নাম: ঠিকানা:
        let cleaned = val
            .replace(/\(.*?\)/g, '') // Remove everything in brackets
            .replace(/(নাম|ঠিকানা|ফোন|মোবাইল|নাম্বার|জেলা|থানা|উপজেলা|বাজার|এলাকা|ফুল ঠিকানা|পূর্ণাঙ্গ ঠিকানা)\s*[:：-]\s*/gi, '')
            .replace(/\|/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned || val; // Fallback to original if cleaning results in empty
    };

    if (product_name) {
        product_name = cleanValue(product_name)
            .replace(/Item \d+:/gi, '')
            .replace(/##product/gi, '')
            .replace(/"/g, '')
            .trim();
        if (!product_name || product_name.toLowerCase() === 'pending') product_name = 'Recovered Lead';
    }
    
    location = cleanValue(location);
    number = cleanValue(number);
    sender_number = cleanValue(sender_number);

    // --- SAFE FIX: Reject orders with missing sender_id or page_id ---
    if (!sender_id || !page_id || sender_id === 'null' || page_id === 'null') {
        console.warn(`[Order] Skipping Save: Missing Critical Identifiers (Page: ${page_id}, Sender: ${sender_id})`);
        return null;
    }

    try {
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='customer_name') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN customer_name text;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='customer_email') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN customer_email text;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='status') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN status text DEFAULT 'ongoing';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_order_tracking' AND column_name='is_locked') THEN
                    ALTER TABLE fb_order_tracking ADD COLUMN is_locked boolean DEFAULT false;
                END IF;
            END $$;
        `);
    } catch (e) {
        console.warn("[DB] fb_order_tracking migration failed:", e.message);
    }

    try {
        // --- 2. SMART AGENT DECISION (Merge into existing incomplete order) ---
        const recentOrder = await query(
            `SELECT id, is_locked, status, product_name, number, location FROM fb_order_tracking 
             WHERE page_id = $1::text AND sender_id = $2::text 
             AND created_at > NOW() - INTERVAL '24 hours'
             ORDER BY created_at DESC LIMIT 1`,
            [page_id || null, sender_id || null]
        );

        if (recentOrder.rows.length > 0) {
            const existing = recentOrder.rows[0];
            
            // --- LOCK MECHANISM: If order is locked or delivered, do NOT update it. Create new instead. ---
            if (existing.is_locked || existing.status === 'delivered' || existing.status === 'locked') {
                console.log(`[Order] Recent order (${existing.id}) is LOCKED/DELIVERED. Creating a fresh order row.`);
            } else {
                const orderId = existing.id;
                
                // --- INCOMPLETE ORDER LOGIC: Check if vital fields are missing ---
                const isMissingDetails = !existing.product_name || existing.product_name === 'Pending' || 
                                       !existing.number || existing.number === 'Pending' || 
                                       !existing.location || existing.location === 'Pending';

                console.log(`[Order] Found active recent order (${orderId}). Incomplete: ${isMissingDetails}. Updating...`);
                
                await query(
                    `UPDATE fb_order_tracking SET
                        product_name = CASE 
                            WHEN $1::text IS NOT NULL AND $1::text <> 'Pending' AND $1::text <> 'Recovered Lead' AND $1::text <> 'Unknown' AND $1::text <> '' THEN $1::text 
                            ELSE product_name 
                        END,
                        number = CASE 
                            WHEN $2::text IS NOT NULL AND $2::text <> 'Pending' AND $2::text <> 'null' AND $2::text <> '' THEN $2::text 
                            ELSE number 
                        END,
                        location = CASE 
                            WHEN $3::text IS NOT NULL AND $3::text <> 'Pending' AND $3::text <> 'null' AND $3::text <> '' THEN $3::text 
                            ELSE location 
                        END,
                        product_quantity = CASE 
                            WHEN $4::text IS NOT NULL AND $4::text <> '1' AND $4::text <> '0' AND $4::text <> '' THEN $4::text 
                            ELSE product_quantity 
                        END,
                        price = CASE 
                            WHEN $5::text IS NOT NULL AND $5::text <> '0' AND $5::text <> '' THEN $5::text 
                            ELSE price 
                        END,
                        sender_number = CASE 
                            WHEN $6::text IS NOT NULL AND $6::text <> 'Pending' AND $6::text <> 'null' AND $6::text <> '' THEN $6::text 
                            ELSE sender_number 
                        END,
                        customer_name = CASE
                            WHEN $8::text IS NOT NULL AND $8::text <> 'Pending' AND $8::text <> 'Unknown' AND $8::text <> '' THEN $8::text
                            ELSE customer_name
                        END,
                        customer_email = CASE
                            WHEN $9::text IS NOT NULL AND $9::text <> '' THEN $9::text
                            ELSE customer_email
                        END,
                        updated_at = NOW()
                     WHERE id = $7::bigint`,
                    [product_name || null, number || null, location || null, product_quantity || null, price || null, sender_number || null, orderId, orderData.customer_name || null, customer_email || null]
                );
                return { id: orderId, status: 'updated' };
            }
        }

        // --- 3. NEW ORDER (Strict Requirement: Must have a phone number to start a new row) ---
        // If we reach here, no existing order was found. We ONLY create a new row if we have a phone number.
        if (!number || number === 'Pending' || number === 'null' || number.length < 8) {
            console.log(`[Order] Skipping New Order Creation: Missing or invalid phone number (${number}).`);
            return null;
        }

        const result = await query(
            `INSERT INTO fb_order_tracking
                (page_id, sender_id, product_name, number, location, product_quantity, price, sender_number, created_at, status, is_locked, customer_name, customer_email)
             VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, NOW(), 'ongoing', FALSE, $9::text, $10::text)
             RETURNING *`,
            [page_id || null, sender_id || null, product_name || null, number || null, location || null, product_quantity || null, price || null, sender_number || null, orderData.customer_name || null, customer_email || null]
        );
        return result.rows[0];

    } catch (error) {
        console.error("[Order] Smart Save Error:", error.message);
        return null;
    }
}

async function ensureFbOrderTrackingTable() {
    const { query } = require('./pgClient');
    await query(`
        CREATE TABLE IF NOT EXISTS fb_order_tracking (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            page_id TEXT,
            sender_id TEXT,
            product_name TEXT,
            number TEXT,
            location TEXT,
            product_quantity TEXT,
            price TEXT,
            sender_number TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
}

// 13. Check Conversation Lock Status (Failure Lock)
async function checkLockStatus(pageId, senderId) {
    try {
        const result = await query(
            'SELECT is_locked FROM fb_contacts WHERE page_id = $1 AND sender_id = $2 LIMIT 1',
            [pageId, senderId]
        );
        if (result.rows.length > 0) {
            return result.rows[0].is_locked === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking lock status:", error);
        return false;
    }
}

// 14. Check Daily AI Reply Count for WhatsApp (Admin Handover Logic)
async function getWhatsAppDailyAICount(sessionName, senderId) {
    const { query } = require('./pgClient');
    const today = new Date().toISOString().split('T')[0];
    try {
        const result = await query(
            `SELECT COUNT(*) AS cnt
             FROM whatsapp_chats
             WHERE session_name = $1
               AND recipient_id = $2
               AND reply_by = 'bot'
               AND timestamp >= $3`,
            [sessionName, senderId, new Date(`${today}T00:00:00Z`).getTime()]
        );
        return parseInt(result.rows[0].cnt, 10) || 0;
    } catch (e) {
        console.error(`[DB] Failed to count daily AI messages: ${e.message}`);
        return 0;
    }
}

// 15. Get All Active Page IDs (Cache Warmup)
async function getAllActivePages() {
    try {
        const pagesResult = await query(
            `SELECT page_id, user_id, message_credit, subscription_status, api_key, cheap_engine
             FROM page_access_token_message
             WHERE subscription_status IN ('active','trial','active_trial','active_paid','none')`,
            []
        );

        const pages = pagesResult.rows;
        if (!pages || pages.length === 0) return [];

        const userIds = [...new Set(pages.map(p => p.user_id).filter(Boolean))];
        const userCredits = {};

        if (userIds.length > 0) {
            const configsResult = await query(
                `SELECT user_id, message_credit
                 FROM user_configs
                 WHERE user_id::text = ANY($1::text[])`,
                [userIds]
            );
            configsResult.rows.forEach(c => {
                const total = Number(c.message_credit || 0);
                userCredits[c.user_id] = total;
            });
        }

        const allowedPageIds = pages
            .filter(p => {
                const status = p.subscription_status;
                const isActive = ['active', 'trial', 'active_trial', 'active_paid', 'none'].includes(status);
                if (!isActive) return false;

                const sharedCredits = userCredits[p.user_id] || 0;
                const hasOwnKey = p.api_key && p.api_key.length > 5 && p.cheap_engine === false;

                if (hasOwnKey) return true;
                if (sharedCredits > 0) return true;
                return false;
            })
            .map(p => p.page_id);

        return allowedPageIds;
    } catch (error) {
        console.error("Error fetching active pages:", error);
        return [];
    }
}

async function updatePageToken(pageId, newPageAccessToken) {
    if (!pageId || !newPageAccessToken) {
        return false;
    }

    try {
        await query(
            `UPDATE page_access_token_message
             SET page_access_token = $1,
                 subscription_status = 'active'
             WHERE page_id = $2`,
            [newPageAccessToken, String(pageId)]
        );
        return true;
    } catch (error) {
        console.error(`Error updating page token for ${pageId}:`, error);
        return false;
    }
}

// 15. Mark Page Token as Invalid
async function markPageTokenInvalid(pageId) {
    console.warn(`[DB] Marking token as INVALID for page ${pageId}`);
    try {
        await query(
            `UPDATE page_access_token_message
             SET subscription_status = 'invalid_token'
             WHERE page_id = $1`,
            [pageId]
        );
    } catch (error) {
        console.error(`Error marking page ${pageId} invalid:`, error);
    }

    // Insert System Alert into fb_chats
    await saveFbChat({
        page_id: pageId,
        sender_id: pageId, // System is sender
        recipient_id: pageId, // Self
        message_id: `sys_err_${Date.now()}`,
        text: "⚠️ SYSTEM ALERT: Facebook Page Token Expired. Please Reconnect Page in Dashboard.",
        timestamp: Date.now(), // Fixed: using Date.now() integer for BIGINT
        status: 'error',
        reply_by: 'bot'
    });
}

// 20. Update WhatsApp Entry (e.g. status, QR code)
async function updateWhatsAppEntry(id, updates) {
    try {
        const keys = Object.keys(updates || {});
        if (keys.length === 0) return;

        const setClauses = keys.map((k, idx) => `${k} = $${idx + 1}`);
        const values = keys.map(k => updates[k]);

        await query(
            `UPDATE whatsapp_message_database
             SET ${setClauses.join(', ')}
             WHERE id = $${keys.length + 1}`,
            [...values, id]
        );

        const sessionResult = await query(
            'SELECT session_name FROM whatsapp_message_database WHERE id = $1 LIMIT 1',
            [id]
        );

        if (sessionResult.rows.length > 0 && sessionResult.rows[0].session_name) {
            const sessionName = sessionResult.rows[0].session_name;
            const sessionUpdates = { ...updates, updated_at: new Date().toISOString() };
            delete sessionUpdates.reply_message;
            delete sessionUpdates.order_tracking;
            delete sessionUpdates.text_prompt;
            delete sessionUpdates.active;
            delete sessionUpdates.subscription_status;

            const sessionKeys = Object.keys(sessionUpdates);
            if (sessionKeys.length === 0) return;

            const sessionSet = sessionKeys.map((k, idx) => `${k} = $${idx + 1}`);
            const sessionValues = sessionKeys.map(k => sessionUpdates[k]);

            await query(
                `UPDATE whatsapp_sessions
                 SET ${sessionSet.join(', ')}
                 WHERE session_name = $${sessionKeys.length + 1}`,
                [...sessionValues, sessionName]
            );
        }
    } catch (error) {
        console.error("Error updating WhatsApp entry:", error.message);
    }
}

// 21. Update WhatsApp Entry By Name
async function updateWhatsAppEntryByName(sessionName, updates) {
    try {
        const keys = Object.keys(updates || {});
        if (keys.length === 0) return;

        const setClauses = keys.map((k, idx) => `${k} = $${idx + 1}`);
        const values = keys.map(k => updates[k]);

        await query(
            `UPDATE whatsapp_message_database
             SET ${setClauses.join(', ')}
             WHERE session_name = $${keys.length + 1}`,
            [...values, sessionName]
        );

        const sessionUpdates = { ...updates, updated_at: new Date().toISOString() };
        delete sessionUpdates.reply_message;
        delete sessionUpdates.order_tracking;
        delete sessionUpdates.text_prompt;
        delete sessionUpdates.active;
        delete sessionUpdates.subscription_status;

        const sessionKeys = Object.keys(sessionUpdates);
        if (sessionKeys.length === 0) return;

        const sessionSet = sessionKeys.map((k, idx) => `${k} = $${idx + 1}`);
        const sessionValues = sessionKeys.map(k => sessionUpdates[k]);

        await query(
            `UPDATE whatsapp_sessions
             SET ${sessionSet.join(', ')}
             WHERE session_name = $${sessionKeys.length + 1}`,
            [...sessionValues, sessionName]
        );
    } catch (error) {
        console.error("Error updating WhatsApp entry by name:", error.message);
    }
}

// 22. Renew WhatsApp Session
async function renewWhatsAppSession(sessionName, days) {
    const sessionResult = await query(
        'SELECT expires_at, plan_days FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
        [sessionName]
    );

    if (sessionResult.rows.length === 0) {
        throw new Error("Session not found");
    }

    const session = sessionResult.rows[0];
    let newExpiresAt = new Date();

    if (session.expires_at && new Date(session.expires_at) > new Date()) {
        newExpiresAt = new Date(session.expires_at);
    }

    newExpiresAt.setDate(newExpiresAt.getDate() + days);

    const updateResult = await query(
        `UPDATE whatsapp_message_database
         SET expires_at = $2,
             plan_days = COALESCE(plan_days, 0) + $3,
             active = true,
             status = 'working',
             subscription_status = 'active'
         WHERE session_name = $1
         RETURNING *`,
        [sessionName, newExpiresAt.toISOString(), days]
    );

    try {
        await query(
            `UPDATE whatsapp_sessions
             SET expires_at = $2,
                 plan_days = COALESCE(plan_days, 0) + $3,
                 status = 'working',
                 updated_at = now()
             WHERE session_name = $1`,
            [sessionName, newExpiresAt.toISOString(), days]
        );
    } catch (e) {}

    return updateResult.rows[0];
}

// 23. Get Expired WhatsApp Sessions
async function getExpiredWhatsAppSessions() {
    const now = new Date().toISOString();
    try {
        const result = await query(
            `SELECT session_name, user_id, expires_at
             FROM whatsapp_message_database
             WHERE expires_at < $1
               AND active = true`,
            [now]
        );
        return result.rows;
    } catch (error) {
        console.error("Error fetching expired sessions:", error);
        return [];
    }
}

// 24. Deduct User Balance (for Plans)
async function deductUserBalance(userId, amount, description = 'Plan Purchase') {
    const result = await query(
        'SELECT balance FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
        [String(userId)]
    );

    if (result.rows.length === 0) {
        throw new Error("User config not found");
    }

    const balance = result.rows[0].balance || 0;
    if (balance < amount) {
        throw new Error("Insufficient balance");
    }

    await query(
        'UPDATE user_configs SET balance = $2 WHERE user_id::text = $1::text',
        [String(userId), balance - amount]
    );

    return true;
}

// 25. Delete WhatsApp Entry
async function deleteWhatsAppEntry(sessionName) {
    try {
        await query(
            'DELETE FROM whatsapp_message_database WHERE session_name = $1',
            [sessionName]
        );
    } catch (error) {
        console.error("Error deleting WhatsApp entry:", error.message);
        throw error;
    }

    try {
        await query(
            'DELETE FROM whatsapp_sessions WHERE session_name = $1',
            [sessionName]
        );
    } catch (e) {
        console.warn("[DB] Failed to delete from whatsapp_sessions:", e.message);
    }
}

async function deleteMessengerPage(pageId) {
    const client = require('./pgClient');
    try {
        await client.query('DELETE FROM fb_contacts WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_contacts:", e.message);
    }

    try {
        await client.query('DELETE FROM fb_included_users WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_included_users:", e.message);
    }

    try {
        await client.query('DELETE FROM fb_chats WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_chats:", e.message);
    }

    try {
        await client.query('DELETE FROM fb_order_tracking WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_order_tracking:", e.message);
    }

    try {
        await client.query('DELETE FROM backend_chat_histories WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from backend_chat_histories:", e.message);
    }

    try {
        await client.query('DELETE FROM fb_comments WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_comments:", e.message);
    }

    try {
        await client.query('DELETE FROM label_actions WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from label_actions:", e.message);
    }

    try {
        await client.query('DELETE FROM page_prompts WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from page_prompts:", e.message);
    }

    try {
        await client.query('DELETE FROM fb_message_database WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from fb_message_database:", e.message);
    }

    try {
        await client.query('DELETE FROM page_access_token_message WHERE page_id = $1', [pageId]);
    } catch (e) {
        console.warn("[DB] Failed to delete from page_access_token_message:", e.message);
        // Do NOT rethrow, so that the API returns success to the user
        // and the page disappears from the UI.
    }
}

// 26. Check WhatsApp Lock Status
async function checkWhatsAppLockStatus(sessionName, senderId) {
    try {
        const run = async () => {
            const result = await query(
                'SELECT is_locked FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
                [sessionName, senderId]
            );
            if (result.rows.length > 0) {
                return result.rows[0].is_locked === true;
            }
            return false;
        };

        return await run();
    } catch (error) {
        if (error && (error.code === '42P01' || error.code === '42703')) {
            try {
                await ensureWhatsAppContactsTable();
                const result = await query(
                    'SELECT is_locked FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
                    [sessionName, senderId]
                );
                if (result.rows.length > 0) {
                    return result.rows[0].is_locked === true;
                }
                return false;
            } catch (inner) {
                console.error("Error checking WhatsApp lock status:", inner);
                return false;
            }
        }
        console.error("Error checking WhatsApp lock status:", error);
        return false;
    }
}

// --- FACEBOOK LOCK SYSTEM ---
async function checkFbLockStatus(pageId, senderId) {
    try {
        const result = await query(
            'SELECT is_locked FROM fb_contacts WHERE page_id = $1 AND sender_id = $2 LIMIT 1',
            [pageId, senderId]
        );
        if (result.rows.length > 0) {
            return result.rows[0].is_locked === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking FB lock status:", error);
        return false;
    }
}

async function toggleFbLock(pageId, senderId, isLocked) {
    try {
        // Upsert logic: ensure the contact exists and update its lock status
        // Simplified: We removed 'updated_at' to prevent schema mismatch errors during deployment
        await query(
            `INSERT INTO fb_contacts (page_id, sender_id, is_locked)
             VALUES ($1, $2, $3)
             ON CONFLICT (page_id, sender_id) 
             DO UPDATE SET is_locked = EXCLUDED.is_locked`,
            [pageId, senderId, isLocked]
        );
        
        console.log(`[DB] FB Chat ${isLocked ? 'LOCKED' : 'UNLOCKED'} for ${senderId} on Page ${pageId}`);
        return true;
    } catch (error) {
        console.error("Error toggling FB lock:", error);
        return false;
    }
}

// --- Helper: Get Last N WhatsApp Messages (Raw) for Echo Check ---
async function getLastNWhatsAppMessages(sessionName, recipientId, limit = 20) {
    const { query } = require('./pgClient');
    const result = await query(
        `SELECT * FROM whatsapp_chats
         WHERE session_name = $1
           AND (
                (sender_id = $2 AND recipient_id = $1)
             OR (sender_id = $1 AND recipient_id = $2)
           )
         ORDER BY timestamp DESC
         LIMIT $3`,
        [sessionName, recipientId, limit]
    );
    return result.rows;
}

// 21. Get Active WhatsApp Sessions (For Auto-Repair)
async function getActiveWhatsAppSessions() {
    const { query } = require('./pgClient');
    const result = await query(
        `SELECT * FROM whatsapp_message_database
         WHERE active = true AND status <> 'expired'`,
        []
    );
    return result.rows;
}

// 25. Log API Usage (Unified API)
async function logAiUsage(data) {
    if (!data.user_id) {
        console.warn("[DB] logAiUsage skipped: user_id is missing.");
        return;
    }

    try {
        console.log(`[DB] Saving AI Usage Log for User: ${data.user_id}, Model: ${data.model}`);
        
        await query(
            `INSERT INTO ai_usage_logs 
                (user_id, page_id, model, prompt_tokens, completion_tokens, total_tokens, cost, status, error_message, sender_name, user_message, ai_reply)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                data.user_id,
                data.page_id || null,
                data.model || 'unknown',
                data.prompt_tokens || 0,
                data.completion_tokens || 0,
                data.total_tokens || 0,
                data.cost || 0,
                data.status || 'success',
                data.error_message || null,
                data.sender_name || 'Customer',
                data.user_message || null,
                data.ai_reply || null
            ]
        );
        // console.log("[DB] logAiUsage successful.");
    } catch (error) {
        console.error("[DB] CRITICAL: Failed to log to ai_usage_logs table!", error.message);
        // Log more details for debugging
        console.error("[DB] Data attempted:", JSON.stringify(data));
    }
}

// 25. Log API Usage Stats (Simplified)
async function logApiUsage(userId, model, tokens, cost = 0) {
    if (!userId) return;

    try {
        // Ensure tokens is integer
        const t = Math.round(Number(tokens) || 0);
        const c = Number(cost) || 0;

        await query(
            `INSERT INTO api_usage_stats
                (user_id, model, tokens, cost, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [userId, model, t, c]
        );
        // console.log(`[DB] Logged Usage: ${userId.substring(0,8)}... | ${model} | ${t} tokens | ${c} BDT`);
    } catch (error) {
        console.warn("[DB] Failed to log API usage stats:", error.message);
        // Fallback: If FK fails (user not in users table yet), we might want to log it to error_logs
        logError(error, 'logApiUsage', { userId, model, tokens, cost });
    }
}

// 40. Get All API Keys
async function getAllKeys() {
    try {
        const result = await query('SELECT * FROM api_list');
        return result.rows || [];
    } catch (error) {
        console.error("[DB] getAllKeys Error:", error.message);
        return [];
    }
}

// Add API Key
async function addApiKey({ provider, api, model = 'default', email = null, gmail = null, mode = 'admin', owner_id = null }) {
    try {
        const result = await query(
            `INSERT INTO api_list (provider, api, model, status, email, gmail, mode, owner_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             ON CONFLICT (api) DO UPDATE SET 
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                status = 'active',
                email = EXCLUDED.email,
                gmail = EXCLUDED.gmail,
                mode = EXCLUDED.mode,
                owner_id = EXCLUDED.owner_id
             RETURNING *`,
            [provider, api, model, 'active', email, gmail, mode, owner_id]
        );
        return result.rows[0];
    } catch (error) {
        console.error("[DB] addApiKey Error:", error.message);
        throw error;
    }
}

// Delete API Key
async function deleteApiKey(id) {
    try {
        await query('DELETE FROM api_list WHERE id = $1', [id]);
        return true;
    } catch (error) {
        console.error("[DB] deleteApiKey Error:", error.message);
        throw error;
    }
}

async function deleteApiKeys(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return true;
    try {
        await query('DELETE FROM api_list WHERE id = ANY($1)', [ids]);
        return true;
    } catch (error) {
        console.error("[DB] deleteApiKeys Error:", error.message);
        throw error;
    }
}

async function getApiKeyById(id) {
    try {
        const result = await query('SELECT id, api, provider, status, email FROM api_list WHERE id = $1 LIMIT 1', [id]);
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] getApiKeyById Error:", error.message);
        return null;
    }
}

async function updateApiKeyLimits(id, { rph_limit, rpm_limit, rpd_limit, model, email }) {
    try {
        const updates = [];
        const values = [id];
        let placeholderIdx = 2;

        if (rph_limit !== undefined) {
            updates.push(`rph_limit = $${placeholderIdx++}`);
            values.push(Math.max(0, parseInt(rph_limit) || 0));
        }
        if (rpm_limit !== undefined) {
            updates.push(`rpm_limit = $${placeholderIdx++}`);
            values.push(Math.max(0, parseInt(rpm_limit) || 0));
        }
        if (rpd_limit !== undefined) {
            updates.push(`rpd_limit = $${placeholderIdx++}`);
            values.push(Math.max(0, parseInt(rpd_limit) || 0));
        }
        if (model !== undefined) {
            updates.push(`model = $${placeholderIdx++}`);
            values.push(model);
        }
        if (email !== undefined) {
            updates.push(`email = $${placeholderIdx++}`);
            values.push(email);
        }

        if (updates.length === 0) return null;

        const queryText = `UPDATE api_list SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await query(queryText, values);
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] updateApiKeyLimits Error:", error.message);
        return null;
    }
}

async function updateApiKeyStatus(id, status) {
    try {
        const statusValue = String(status || '').trim() || 'disabled';
        const result = await query(
            'UPDATE api_list SET status = $2, last_used_at = NOW() WHERE id = $1 RETURNING id, status',
            [id, statusValue]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] updateApiKeyStatus Error:", error.message);
        return null;
    }
}

// 26. Calculate Cost for Usage Stats
function calculateCost(model, tokens) {
    if (!tokens || tokens <= 0) return 0;
    
    // Pricing per 1 Million Tokens (in BDT)
    // Same as externalApiController.js for consistency
    const PRICING = {
        PRO: 250,
        FLASH: 100,
        LITE: 40
    };

    let rate = PRICING.PRO;
    const modelLower = (model || '').toLowerCase();
    
    if (modelLower.includes('flash')) rate = PRICING.FLASH;
    else if (modelLower.includes('lite')) rate = PRICING.LITE;
    
    const costPerToken = rate / 1000000;
    return tokens * costPerToken;
}

function calculateRequestCost(model, requests = 1) {
    const req = Number(requests) || 0;
    if (req <= 0) return 0;

    const PRICING = {
        PRO: 150,
        FLASH: 100,
        LITE: 80
    };

    let rate = PRICING.PRO;
    const modelLower = (model || '').toLowerCase();
    
    if (modelLower.includes('flash')) rate = PRICING.FLASH;
    else if (modelLower.includes('lite')) rate = PRICING.LITE;
    
    const costPerRequest = rate / 1000;
    return req * costPerRequest;
}

// --- Semantic Cache Utilities ---
async function getEmbeddingGlobalConfig() {
    try {
        const envModel = String(process.env.EMBEDDING_MODEL || process.env.VECTOR_EMBEDDING_MODEL || '').trim();
        const envApiKey = String(process.env.EMBEDDING_API_KEY || process.env.VECTOR_EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
        const envBaseUrl = String(process.env.EMBEDDING_BASE_URL || process.env.VECTOR_EMBEDDING_BASE_URL || '').trim();
        const envProviderRaw = String(process.env.EMBEDDING_PROVIDER || process.env.VECTOR_EMBEDDING_PROVIDER || '').trim().toLowerCase();
        const envAccessMode = String(process.env.EMBEDDING_ACCESS_MODE || process.env.VECTOR_EMBEDDING_ACCESS_MODE || '').trim().toLowerCase();

        if (envModel || envApiKey || envBaseUrl || envProviderRaw) {
            const envProvider = (envProviderRaw === 'openrouter' || envAccessMode === 'openai_compatible')
                ? 'openai'
                : (envProviderRaw || ((envModel.toLowerCase().includes('gemini') || envModel.toLowerCase().includes('embedding-001')) ? 'google' : 'openai'));
            return {
                model: envModel || 'text-embedding-3-small',
                base_url: envBaseUrl || (envApiKey.startsWith('sk-or-v1') ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'),
                api_key: envApiKey,
                provider: envProvider
            };
        }

        const result = await query(
            `SELECT text_model, text_model_details
             FROM openrouter_engine_config
             WHERE config_type = $1
             LIMIT 1`,
            ['embedding_global']
        );

        const row = result.rows[0] || null;
        const details = (row && row.text_model_details) || {};
        const configuredProvider = String(details.provider || '').trim().toLowerCase();
        const accessMode = String(details.access_mode || '').trim().toLowerCase();
        const modelLower = String(row?.text_model || '').toLowerCase();

        // Honor explicit provider/access mode first. Some OpenRouter embedding models
        // include "gemini" in the model name but still require OpenAI-compatible calls.
        let provider = 'openai';
        if (configuredProvider === 'openrouter' || accessMode === 'openai_compatible') {
            provider = 'openai';
        } else if (configuredProvider) {
            provider = configuredProvider;
        } else if (modelLower.includes('gemini') || modelLower.includes('embedding-001')) {
            provider = 'google';
        }

        return {
            model: (row && row.text_model) || 'text-embedding-3-small',
            base_url: details.base_url || 'https://api.openai.com/v1',
            api_key: details.api_key || '',
            provider: provider
        };
    } catch (e) {
        console.warn(`[DB] Failed to fetch embedding config: ${e.message}`);
        return null;
    }
}

async function ensureSemanticCacheTables() {
    const { query } = require('./pgClient');
    try {
        await query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await query(`
            CREATE TABLE IF NOT EXISTS semantic_cache (
                id BIGSERIAL PRIMARY KEY,
                page_id TEXT,
                session_name TEXT,
                context_id TEXT,
                question_norm TEXT NOT NULL,
                response_text TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        
        // Ensure column exists individually for extra safety
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='semantic_cache' AND column_name='context_id') THEN
                    ALTER TABLE semantic_cache ADD COLUMN context_id TEXT;
                END IF;
            END $$;
        `);

        await query(`CREATE INDEX IF NOT EXISTS idx_semcache_question_trgm ON semantic_cache USING gin (question_norm gin_trgm_ops)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_semcache_page ON semantic_cache (page_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_semcache_session ON semantic_cache (session_name)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_semcache_context ON semantic_cache (context_id)`);
    } catch (e) {
        console.warn(`[DB] Failed to ensure semantic_cache tables: ${e.message}`);
    }
}

async function saveSemanticCacheEntry({ page_id = null, session_name = null, context_id = null, question, response, vector = null }) {
    const { query } = require('./pgClient');
    try {
        await ensureSemanticCacheTables();
        const norm = (question || '').toString().toLowerCase().replace(/[^\w\s\u0980-\u09FF]/g, '').trim();
        if (!norm || !response) return;
        
        const cleanPageId = page_id ? String(page_id).trim() : null;
        const cleanSessionName = session_name ? String(session_name).trim() : null;
        const cleanContextId = context_id ? String(context_id).trim() : null;

        // --- DUPLICATE CHECK ---
        // Check if exact same question and response already exists for this page/session
        const existing = await query(
            `SELECT id FROM semantic_cache 
             WHERE (page_id = $1 OR session_name = $2) 
             AND question_norm = $3 
             AND response_text = $4
             LIMIT 1`,
            [cleanPageId, cleanSessionName, norm, response]
        );

        if (existing.rows.length > 0) {
            // console.log(`[DB Cache] Duplicate entry skipped for: "${norm}"`);
            return;
        }

        await query(
            `INSERT INTO semantic_cache (page_id, session_name, context_id, question_norm, response_text, question_vector)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [cleanPageId, cleanSessionName, cleanContextId, norm, response, vector ? JSON.stringify(vector) : null]
        );
    } catch (e) {
        console.error(`[DB] saveSemanticCacheEntry failed: ${e.message}`);
    }
}

async function getSemanticCacheEntries({ page_id = null, session_name = null, limit = 50, offset = 0 }) {
    const { query } = require('./pgClient');
    try {
        const conditions = [];
        const params = [];
        
        const searchId = (page_id || session_name || '').toString().trim();
        
        if (searchId) {
            params.push(searchId);
            // Using a more flexible matching that handles potential TEXT vs BIGINT or hidden whitespace
            conditions.push(`(page_id = $1 OR session_name = $1 OR page_id LIKE '%' || $1 || '%' OR session_name LIKE '%' || $1 || '%')`);
        }
        
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';
        
        const limitVal = parseInt(limit) || 50;
        const offsetVal = parseInt(offset) || 0;
        
        params.push(limitVal, offsetVal);
        
        const sql = `
            SELECT id, page_id, session_name, context_id, question_norm, response_text, created_at
            FROM semantic_cache
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;
        
        console.log(`[DB Debug] getSemanticCacheEntries SearchID: "${searchId}" | SQL: ${sql.replace(/\s+/g, ' ')}`);
        
        const res = await query(sql, params);
        
        // If no entries found with specific ID, let's check total entries in table to diagnose DB connection
        if (res.rows.length === 0) {
            const totalCount = await query("SELECT COUNT(*) FROM semantic_cache");
            console.log(`[DB Debug] No entries for ${searchId}. Total entries in table: ${totalCount.rows[0].count}`);
        }

        return res.rows || [];
    } catch (e) {
        console.error(`[DB Error] getSemanticCacheEntries failed: ${e.message}`);
        throw e; // Throw instead of returning empty array so controller can report it
    }
}

async function deleteSemanticCacheEntry(id) {
    const { query } = require('./pgClient');
    try {
        await query('DELETE FROM semantic_cache WHERE id = $1', [id]);
        return true;
    } catch (e) {
        console.warn(`[DB] deleteSemanticCacheEntry failed: ${e.message}`);
        return false;
    }
}

async function clearSemanticCache({ page_id = null, session_name = null }) {
    const { query } = require('./pgClient');
    try {
        const conditions = [];
        const params = [];
        
        const searchId = (page_id || session_name || '').toString().trim();
        
        if (searchId) {
            params.push(searchId);
            conditions.push(`(page_id = $1 OR session_name = $1)`);
        }

        if (conditions.length === 0) return false;

        const sql = `DELETE FROM semantic_cache WHERE ${conditions.join(' OR ')}`;
        console.log(`[DB Debug] clearSemanticCache SQL: ${sql} | ID: ${searchId}`);
        await query(sql, params);
        return true;
    } catch (e) {
        console.error(`[DB Error] clearSemanticCache failed: ${e.message}`);
        return false;
    }
}

async function updateSemanticCacheEntry(id, { question, response }) {
    const { query } = require('./pgClient');
    try {
        const norm = (question || '').toString().toLowerCase().replace(/[^\w\s\u0980-\u09FF]/g, '').trim();
        await query(
            `UPDATE semantic_cache 
             SET question_norm = $1, response_text = $2 
             WHERE id = $3`,
            [norm, response, id]
        );
        return true;
    } catch (e) {
        console.warn(`[DB] updateSemanticCacheEntry failed: ${e.message}`);
        return false;
    }
}

async function findSemanticCache({ page_id = null, session_name = null, context_id = null, question, threshold = 0.94, vector = null }) {
    const { query } = require('./pgClient');
    try {
        await ensureSemanticCacheTables();
        const norm = (question || '').toString().toLowerCase().replace(/[^\w\s\u0980-\u09FF]/g, '').trim();
        if (!norm) return null;

        const conditions = [];
        const params = [norm, threshold];
        
        const searchId = (page_id || session_name || '').toString().trim();
        if (searchId) {
            params.push(searchId);
            conditions.push(`(CAST(page_id AS TEXT) = CAST($${params.length} AS TEXT) OR CAST(session_name AS TEXT) = CAST($${params.length} AS TEXT))`);
        }
        
        const scopeWhere = conditions.length > 0 ? `AND (${conditions.join(' OR ')})` : '';

        // Context Logic
        let contextWhere = '';
        let contextSortClause = '1';
        
        if (context_id) {
            contextWhere = `AND (CAST(context_id AS TEXT) = CAST($${params.length + 1} AS TEXT) OR context_id IS NULL)`;
            contextSortClause = `(CASE WHEN CAST(context_id AS TEXT) = CAST($${params.length + 1} AS TEXT) THEN 1 ELSE 2 END)`;
            params.push(String(context_id).trim());
        } else {
            // If no context, prioritize global entries (NULL) but allow any match for the question
            contextWhere = ''; 
            contextSortClause = `(CASE WHEN context_id IS NULL THEN 1 ELSE 2 END)`;
        }

        let sql = '';
        if (vector && Array.isArray(vector)) {
            // Combined Search Logic: Prefer Vector (Meaning), Fallback to Text Similarity (Words)
            params.push(JSON.stringify(vector));
            const vectorIdx = params.length;
            
            // --- FIX: We use a slightly more relaxed threshold for vector matching (0.05 bonus)
            // to ensure 'delivary time' matches 'koi din time lagbe' better.
            sql = `
                SELECT response_text, context_id, 
                    (CASE 
                        WHEN question_vector IS NOT NULL 
                        THEN (1 - (question_vector <=> $${vectorIdx}::vector)) + 0.05
                        ELSE similarity(question_norm, $1) 
                    END) as final_similarity
                FROM semantic_cache
                WHERE 
                    (
                        (question_vector IS NOT NULL AND (1 - (question_vector <=> $${vectorIdx}::vector)) >= ($2 - 0.05))
                        OR 
                        (similarity(question_norm, $1) >= $2)
                    )
                    ${scopeWhere}
                    ${contextWhere}
                ORDER BY 
                    ${contextSortClause} ASC,
                    final_similarity DESC, 
                    created_at DESC
                LIMIT 1
            `;
        } else {
            // Standard Text Search (Similarity)
            sql = `
                SELECT response_text, context_id, similarity(question_norm, $1) as similarity
                FROM semantic_cache
                WHERE similarity(question_norm, $1) >= $2
                ${scopeWhere}
                ${contextWhere}
                ORDER BY 
                    ${contextSortClause} ASC,
                    similarity(question_norm, $1) DESC, 
                    created_at DESC
                LIMIT 1
            `;
        }
        
        const res = await query(sql, params);
        if (res.rows.length > 0) {
            console.log(`[DB Cache] HIT! Similarity: ${res.rows[0].final_similarity || res.rows[0].similarity}`);
            return res.rows[0].response_text;
        }
        return null;
    } catch (e) {
        console.error(`[DB] findSemanticCache failed: ${e.message}`);
        return null;
    }
}

async function deleteAdContext(adId, pageId) {
    try {
        await query(
            'DELETE FROM ads_library WHERE ad_id = $1 AND page_id = $2',
            [adId, pageId]
        );
        return true;
    } catch (error) {
        console.error("Error deleting ad context:", error.message);
        throw error;
    }
}

module.exports = {
  checkAndExpirePlan,
  getModelPricing,
  getCostForModel,
  logApiUsage,
  deductUserBalance,
  getAllKeys,
    addApiKey,
    deleteApiKey,
    deleteApiKeys,
    getApiKeyById,
    updateApiKeyLimits,
    updateApiKeyStatus,
    logApiUsage,
    logAiUsage,
    calculateCost,
    calculateRequestCost,
    getPageConfig,
    getPagePrompts,
    saveLead,
    getConversationState,
    setConversationState,
    updateConversationState,
    checkDuplicate,
    deductCredit,
    getChatHistory,
    saveChatMessage,
    saveFbChat,
    getFbChatHistory,
    checkN8nDebounce,
    saveFbComment,
    logMessage,
    getFbChatById,
    getWhatsAppChatById,
    getMessageById,
    saveOrderTracking,
    checkLockStatus,
    getAllActivePages,
    updatePageToken,
    markPageTokenInvalid,
    createWhatsAppEntry,
    getWhatsAppConfig,
    saveWhatsAppChat,
    getWhatsAppChatHistory,
    checkWhatsAppDuplicate,
    saveWhatsAppOrderTracking,
    deductWhatsAppCredit,
    saveWhatsAppContact,
    updateWhatsAppEntry,
    updateWhatsAppEntryByName,
    saveOrder,
    updateContactPhone,
    getLastWhatsAppMessage,
    getLastNWhatsAppMessages,
    toggleWhatsAppLock,
    getWhatsAppContact,
    getWhatsAppContactByLid,
    renewWhatsAppSession,
    getExpiredWhatsAppSessions,
    deductUserBalance,
    deleteWhatsAppEntry,
    deleteMessengerPage,
    checkWhatsAppLockStatus,
    checkWhatsAppEmojiLock,
    createWhatsAppSessionEntry,
    getActiveWhatsAppSessions,
    getWhatsAppDailyAICount,
    checkFbLockStatus,
    toggleFbLock,
    getAdContext,
    saveAdContext,
    getAdsByUserId,
    deleteAdContext,
    getModelUsage,
    saveModelUsage,
    clearExpiredModelLocks,
    getAllModelUsagesForKey,
    hasFbAdminReplySince,
    hasWhatsAppAdminReplySince,
    getLastFbUserMessageTimestamp,
    getLastWhatsAppUserMessageTimestamp,

    // --- PRODUCT MANAGEMENT ---
    createProduct,
    // --- Semantic Cache ---
    findSemanticCache,
    saveSemanticCacheEntry,
    getSemanticCacheEntries,
    deleteSemanticCacheEntry,
    updateSemanticCacheEntry,
    clearSemanticCache,
    getEmbeddingGlobalConfig,
    getProducts,
    getProductById,
    getProductByImageUrl,
    getResourceProductsWithMedia,
    updateProduct,
    deleteProduct,
    searchProductByImageVector,
    searchProducts,
    searchProductsForResource,
    getProductsByNames,
    checkProductFeatureAccess,
    updateProductEmbedding,
    refreshProductEmbeddingsNow,
    upsertProductImageEmbedding,
    backfillGeneratedSkuMatrixForLegacyProducts,
    normalizeProductRecord,
    resolveProductSkuSelection,
    buildProductSearchBlob,

    // --- ADMIN TOOLS ---
    addBalanceByEmail,
    approveDepositTransaction,
    logError
};

// --- PRODUCT MANAGEMENT IMPLEMENTATION ---

// 32. Check Product Feature Access (Unlock Check)
async function checkProductFeatureAccess(userId) {
    const userConfigResult = await query(
        'SELECT message_credit, balance FROM user_configs WHERE user_id::text = $1::text LIMIT 1',
        [String(userId)]
    );

    if (userConfigResult.rows.length > 0) {
        const uc = userConfigResult.rows[0];
        if ((uc.message_credit && Number(uc.message_credit) > 0) ||
            (uc.balance && Number(uc.balance) > 0)) {
            return true;
        }
    }

    const waResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM whatsapp_sessions
         WHERE user_id::text = $1::text
           AND expires_at > NOW()`,
        [String(userId)]
    );

    if (waResult.rows.length > 0 && waResult.rows[0].cnt > 0) {
        return true;
    }

    const fbResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM page_access_token_message
         WHERE user_id::text = $1::text
           AND subscription_status IN ('active','trial','active_trial','active_paid')`,
        [String(userId)]
    );

    if (fbResult.rows.length > 0 && fbResult.rows[0].cnt > 0) {
        return true;
    }

    return true;
}

function safeParseJson(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
}

function normalizeProductMode(mode) {
    const value = String(mode || 'simple').trim().toLowerCase();
    if (['simple', 'option-list', 'sku-matrix'].includes(value)) return value;
    return 'simple';
}

function normalizeAttributeName(name, index = 0) {
    const cleaned = String(name || `attribute_${index + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || `attribute_${index + 1}`;
}

function formatAttributeLabel(name) {
    return String(name || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeTextToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const SEARCH_STOP_TOKENS = new Set([
    'amar', 'amr', 'ami', 'lagbe', 'lagbo', 'lage', 'ta', 'ti', 'eta', 'eita', 'ei',
    'ase', 'ache', 'achi', 'koto', 'dam', 'price', 'please', 'plz', 'want', 'need',
    'chai', 'lagbey', 'den', 'diben', 'diben', 'tai', 'sizeer', 'er', 'টা', 'দাম', 'আছে'
]);

function extractSearchTokens(value) {
    return Array.from(new Set(
        normalizeTextToken(value)
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token && !SEARCH_STOP_TOKENS.has(token))
    ));
}

function normalizeAttributeSchema(schema, skuMatrix = []) {
    const parsed = safeParseJson(schema, []);
    const base = Array.isArray(parsed) ? parsed : [];
    const normalized = [];

    base.forEach((item, index) => {
        if (!item) return;
        const rawName = typeof item === 'string' ? item : (item.name || item.key || item.label);
        const name = normalizeAttributeName(rawName, index);
        const label = String((typeof item === 'object' ? item.label : '') || formatAttributeLabel(name)).trim();
        const rawValues = typeof item === 'object' ? (item.values || item.options || []) : [];
        const values = Array.from(new Set((Array.isArray(rawValues) ? rawValues : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)));
        normalized.push({ name, label, values });
    });

    if (Array.isArray(skuMatrix) && skuMatrix.length > 0) {
        skuMatrix.forEach((sku) => {
            const attrs = sku?.attributes && typeof sku.attributes === 'object' ? sku.attributes : {};
            Object.entries(attrs).forEach(([rawName, rawValue]) => {
                const name = normalizeAttributeName(rawName);
                const value = String(rawValue || '').trim();
                if (!value) return;
                let target = normalized.find((item) => item.name === name);
                if (!target) {
                    target = { name, label: formatAttributeLabel(name), values: [] };
                    normalized.push(target);
                }
                if (!target.values.includes(value)) {
                    target.values.push(value);
                }
            });
        });
    }

    return normalized;
}

function buildSkuKey(attributes = {}) {
    const pairs = Object.entries(attributes)
        .map(([key, value]) => [normalizeAttributeName(key), String(value || '').trim()])
        .filter(([, value]) => value)
        .sort(([a], [b]) => a.localeCompare(b));
    return pairs.map(([key, value]) => `${key}:${value.toLowerCase()}`).join('|');
}

function summarizeAttributes(attributes = {}) {
    return Object.entries(attributes)
        .map(([key, value]) => `${formatAttributeLabel(key)}: ${value}`)
        .join(', ');
}

function buildSkuName(attributes = {}) {
    const values = Object.values(attributes)
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    return values.join(' / ') || 'Standard';
}

function encodeSkuSegment(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/(\d)\s*[.,]\s*(\d)/g, '$1P$2')
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 8);
}

function buildSkuCodeFromAttributes(attributes = {}, index = 0, schema = []) {
    const orderedValues = (Array.isArray(schema) && schema.length > 0
        ? schema.map((item) => attributes[item.name])
        : Object.values(attributes))
        .filter(Boolean)
        .slice(0, 3)
        .map((value) => encodeSkuSegment(value));
    return orderedValues.length > 0 ? orderedValues.join('-') : `SKU-${index + 1}`;
}

function generateSkuCombinations(attributeSchema = []) {
    const normalizedSchema = (Array.isArray(attributeSchema) ? attributeSchema : [])
        .map((item, index) => {
            const name = normalizeAttributeName(item?.name || item?.label, index);
            const values = Array.from(new Set((Array.isArray(item?.values) ? item.values : [])
                .map((value) => String(value || '').trim())
                .filter(Boolean)));
            return { name, values };
        })
        .filter((item) => item.values.length > 0);

    if (normalizedSchema.length === 0) return [];

    let combinations = [{}];
    normalizedSchema.forEach((attribute) => {
        const next = [];
        combinations.forEach((base) => {
            attribute.values.forEach((value) => {
                next.push({ ...base, [attribute.name]: value });
            });
        });
        combinations = next;
    });

    return combinations;
}

function buildAutoSkuMatrix(attributeSchema = [], productDefaults = {}) {
    const schema = normalizeAttributeSchema(attributeSchema, []);
    const combinations = generateSkuCombinations(schema);
    if (combinations.length === 0) return [];

    return combinations.map((attributes, index) => ({
        sku_id: null,
        sku_code: buildSkuCodeFromAttributes(attributes, index, schema),
        name: buildSkuName(attributes),
        key: buildSkuKey(attributes) || `sku:${index + 1}`,
        attributes,
        price: productDefaults.price !== undefined && productDefaults.price !== null && productDefaults.price !== ''
            ? Number(productDefaults.price)
            : 0,
        currency: String(productDefaults.currency || 'BDT').trim() || 'BDT',
        available: productDefaults.available === undefined ? true : !!productDefaults.available,
        image_url: null,
        image_urls: [],
        video_url: null,
        bulk_price: '',
        aliases: []
    }));
}

function normalizeSkuMatrix(rawSkuMatrix, productDefaults = {}, attributeSchema = []) {
    const parsed = safeParseJson(rawSkuMatrix, []);
    const source = Array.isArray(parsed) ? parsed : [];
    const normalized = source.map((item, index) => {
        const attributes = item && typeof item.attributes === 'object' ? item.attributes : {};
        const cleanedAttributes = {};
        Object.entries(attributes).forEach(([key, value]) => {
            const normalizedName = normalizeAttributeName(key);
            const cleanedValue = String(value || '').trim();
            if (cleanedValue) cleanedAttributes[normalizedName] = cleanedValue;
        });

        const fallbackName = summarizeAttributes(cleanedAttributes) || `SKU ${index + 1}`;
        const key = buildSkuKey(cleanedAttributes) || `sku:${index + 1}`;
        const aliases = Array.from(new Set((Array.isArray(item?.aliases) ? item.aliases : [])
            .map((alias) => String(alias || '').trim())
            .filter(Boolean)));
        return {
            sku_id: item?.sku_id ? String(item.sku_id) : null,
            sku_code: item?.sku_code ? String(item.sku_code).trim() : '',
            name: String(item?.name || fallbackName).trim(),
            key,
            attributes: cleanedAttributes,
            price: item?.price !== undefined && item?.price !== null && item?.price !== '' ? Number(item.price) : Number(productDefaults.price || 0),
            currency: String(item?.currency || productDefaults.currency || 'BDT').trim() || 'BDT',
            available: item?.available === undefined ? true : !!item.available,
            image_url: item?.image_url ? String(item.image_url).trim() : null,
            image_urls: Array.isArray(item?.image_urls) ? item.image_urls.map(u => String(u || '').trim()).filter(Boolean) : (item?.image_url ? [String(item.image_url).trim()] : []),
            video_url: item?.video_url ? String(item.video_url).trim() : null,
            bulk_price: item?.bulk_price ? String(item.bulk_price).trim() : '',
            aliases
        };
    });

    const schema = normalizeAttributeSchema(attributeSchema, normalized);
    if (
        normalized.length === 0 &&
        normalizeProductMode(productDefaults?.product_mode) === 'sku-matrix' &&
        schema.some((item) => Array.isArray(item.values) && item.values.length > 0)
    ) {
        return buildAutoSkuMatrix(schema, productDefaults);
    }

    normalized.forEach((sku, index) => {
        if (!sku.sku_code) {
            sku.sku_code = buildSkuCodeFromAttributes(sku.attributes, index, schema);
        }
    });

    return normalized;
}

function buildLegacyVariantsFromProduct(product) {
    const skuMatrix = Array.isArray(product?.sku_matrix) ? product.sku_matrix : [];
    if (skuMatrix.length > 0) {
        return skuMatrix.map((sku, index) => ({
            name: sku.name || summarizeAttributes(sku.attributes) || `Option ${index + 1}`,
            price: String(sku.price ?? product?.price ?? 0),
            currency: sku.currency || product?.currency || 'BDT',
            available: sku.available !== false,
            image_url: sku.image_url || null,
            video_url: sku.video_url || null,
            sku_code: sku.sku_code || null,
            attributes: sku.attributes || {}
        }));
    }

    const parsedVariants = safeParseJson(product?.variants, []);
    return Array.isArray(parsedVariants) ? parsedVariants : [];
}

function buildProductSearchBlob(product) {
    let keywordText = product?.keywords;
    if (typeof keywordText === 'string') {
        try {
            const parsed = JSON.parse(keywordText);
            if (Array.isArray(parsed)) {
                keywordText = parsed.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
            }
        } catch {}
    } else if (Array.isArray(keywordText)) {
        keywordText = keywordText.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    }

    let visualText = product?.visual_tags;
    if (typeof visualText === 'string') {
        try {
            const parsed = JSON.parse(visualText);
            if (Array.isArray(parsed)) {
                visualText = parsed.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
            }
        } catch {}
    } else if (Array.isArray(visualText)) {
        visualText = visualText.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    }

    const parts = [
        product?.name,
        product?.description,
        keywordText,
        visualText,
        product?.product_mode,
        Array.isArray(product?.combo_items) ? product.combo_items.join(' ') : ''
    ];

    const schema = normalizeAttributeSchema(product?.attribute_schema, product?.sku_matrix);
    schema.forEach((attribute) => {
        parts.push(attribute.label);
        parts.push((attribute.values || []).join(' '));
    });

    const skuMatrix = normalizeSkuMatrix(product?.sku_matrix, product, schema);
    skuMatrix.forEach((sku) => {
        parts.push(sku.name);
        parts.push(sku.sku_code);
        parts.push(String(sku.price ?? ''));
        parts.push((sku.aliases || []).join(' '));
        parts.push(Object.values(sku.attributes || {}).join(' '));
    });

    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
}

function normalizeProductRecord(rawProduct) {
    if (!rawProduct) return rawProduct;
    const product = { ...rawProduct };
    delete product.stock;
    product.product_mode = normalizeProductMode(product.product_mode || (Array.isArray(product.variants) && product.variants.length > 1 ? 'option-list' : 'simple'));
    product.combo_items = safeParseJson(product.combo_items, []);
    product.additional_images = safeParseJson(product.additional_images, []);
    product.allowed_messenger_ids = safeParseJson(product.allowed_messenger_ids, []);
    product.allowed_wa_sessions = safeParseJson(product.allowed_wa_sessions, []);
    product.attribute_schema = normalizeAttributeSchema(product.attribute_schema, safeParseJson(product.sku_matrix, []));
    product.sku_matrix = normalizeSkuMatrix(product.sku_matrix, product, product.attribute_schema);
    product.variants = buildLegacyVariantsFromProduct(product);
    product.searchable_text = String(product.searchable_text || buildProductSearchBlob(product)).trim();
    return product;
}

function resolveProductSkuSelection(product, inputText = '', preferredSkuKey = null) {
    const normalizedProduct = normalizeProductRecord(product);
    const skuMatrix = Array.isArray(normalizedProduct?.sku_matrix) ? normalizedProduct.sku_matrix : [];
    if (skuMatrix.length === 0) {
        return { product: normalizedProduct, selectedSku: null, matches: [], missingAttributes: [], mentionedValues: [] };
    }

    const normalizedInput = normalizeTextToken(inputText);
    const candidates = [];
    const mentionedValues = [];

    skuMatrix.forEach((sku) => {
        let score = 0;
        let strongSignalCount = 0;
        const attrEntries = Object.entries(sku.attributes || {});
        attrEntries.forEach(([attrName, rawValue]) => {
            const value = normalizeTextToken(rawValue);
            if (value && normalizedInput.includes(value)) {
                score += 4;
                strongSignalCount++;
                mentionedValues.push(rawValue);
            }
            const compactValue = value.replace(/\s+/g, '');
            if (compactValue && compactValue.length > 2 && normalizedInput.replace(/\s+/g, '').includes(compactValue)) {
                score += 2;
                strongSignalCount++;
            }
        });

        const aliases = [sku.name, sku.sku_code, ...(sku.aliases || [])]
            .map((item) => normalizeTextToken(item))
            .filter(Boolean);
        aliases.forEach((alias) => {
            if (alias && normalizedInput.includes(alias)) {
                score += 2;
                strongSignalCount++;
            }
        });

        if (preferredSkuKey && sku.key === preferredSkuKey) {
            score += normalizedInput ? 1 : 4;
            strongSignalCount++;
        }

        candidates.push({ sku, score, strongSignalCount });
    });

    const scored = candidates
        .filter((item) => item.score > 0 && item.strongSignalCount > 0)
        .sort((a, b) => b.score - a.score);

    let matches = scored.map((item) => item.sku);
    if (matches.length === 0 && preferredSkuKey) {
        matches = skuMatrix.filter((sku) => sku.key === preferredSkuKey);
    }
    if (matches.length === 0 && !normalizedInput) {
        matches = skuMatrix;
    }

    let selectedSku = null;
    if (matches.length === 1) {
        selectedSku = matches[0];
    } else if (scored.length > 0 && scored[0].score >= (scored[1]?.score || 0) + 2) {
        selectedSku = scored[0].sku;
    }

    const missingAttributes = [];
    normalizedProduct.attribute_schema.forEach((attribute) => {
        const distinctValues = Array.from(new Set(matches
            .map((sku) => sku.attributes?.[attribute.name])
            .filter(Boolean)));
        if (distinctValues.length > 1) {
            missingAttributes.push({
                name: attribute.name,
                label: attribute.label,
                values: distinctValues
            });
        }
    });

    return {
        product: normalizedProduct,
        selectedSku,
        matches,
        missingAttributes,
        mentionedValues: Array.from(new Set(mentionedValues))
    };
}

// 28. Create Product
async function createProduct(productData) {
    const normalizedProduct = normalizeProductRecord(productData);
    normalizedProduct.searchable_text = buildProductSearchBlob(normalizedProduct);
    const fields = [
        'user_id',
        'name',
        'description',
        'image_url',
        'video_url',
        'additional_images',
        'variants',
        'is_active',
        'price',
        'currency',
        'allowed_messenger_ids',
        'allowed_wa_sessions',
        'platform',
        'keywords',
        'is_combo',
        'combo_items',
        'allow_description',
        'isolate_sku_images',
        'product_mode',
        'attribute_schema',
        'sku_matrix',
        'searchable_text'
    ];

    const values = [];
    const placeholders = [];

    fields.forEach((field, index) => {
        let p = `$${index + 1}`;
        placeholders.push(p);
        
        let val = normalizedProduct[field];
        
        // --- CLEAN PLAN: Ensure JSON/Array fields are strings for DB safety ---
        const jsonFields = ['variants', 'allowed_messenger_ids', 'allowed_wa_sessions', 'combo_items', 'additional_images', 'attribute_schema', 'sku_matrix'];
        if (jsonFields.includes(field)) {
            if (val && typeof val === 'object') {
                val = JSON.stringify(val);
            } else if (!val) {
                val = (field === 'additional_images' ? '[]' : '[]');
            }
        } else if (val === undefined) {
            val = null;
        }
        
        values.push(val);
    });

    const result = await query(
        `INSERT INTO products (${fields.join(',')})
         VALUES (${placeholders.join(',')})
         RETURNING *`,
        values
    );

    // Background Embedding Update
    if (result.rows.length > 0) {
        const product = normalizeProductRecord(result.rows[0]);
        queueProductEmbeddingRefresh(product);
    }

    return normalizeProductRecord(result.rows[0]);
}

async function resolvePageContextType(pageId) {
    if (!pageId) return null;
    const sId = String(pageId);
    
    // 1. Check common WA session prefixes/patterns
    if (sId.startsWith('bottow_') || sId.includes('wa_') || sId.startsWith('session_') || sId.startsWith('waba_') || sId.includes('_wa')) return 'whatsapp';
    
    // 2. Check Database for WhatsApp Resource Existence
    try {
        const waRes = await query(
            'SELECT 1 FROM whatsapp_message_database WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1 LIMIT 1',
            [sId]
        );
        if (waRes.rows.length > 0) return 'whatsapp';
        
        const waRes2 = await query('SELECT 1 FROM whatsapp_sessions WHERE session_name = $1 LIMIT 1', [sId]);
        if (waRes2.rows.length > 0) return 'whatsapp';
    } catch (e) {
        console.warn("[DB] resolvePageContextType DB check failed:", e.message);
    }
    
    // 3. Check for FB Page IDs (usually all numeric and > 10 digits)
    if (/^\d{10,}$/.test(sId)) return 'messenger';
    
    // 4. Check if this ID exists in ANY product's allowed_wa_sessions column
    try {
        const productCheck = await query(
            "SELECT 1 FROM products WHERE allowed_wa_sessions::jsonb @> jsonb_build_array($1::text) LIMIT 1",
            [sId]
        );
        if (productCheck.rows.length > 0) return 'whatsapp';
    } catch (e) {}

    // 5. Final Fallback: Check if it's in FB table
    try {
        const fbRes = await query('SELECT 1 FROM page_access_token_message WHERE page_id = $1 LIMIT 1', [sId]);
        if (fbRes.rows.length > 0) return 'messenger';
    } catch (e) {}

    // Default to messenger for legacy reasons, but log it
    console.log(`[DB] resolvePageContextType defaulted to messenger for ID: ${sId}`);
    return 'messenger';
}

async function getProducts(userId, page = 1, limit = 20, searchQuery = null, pageId = null, allowedPageIds = null) {
    console.log(`[DB] getProducts - User: ${userId}, Page: ${pageId}`);
    if (!pageId || pageId === 'null' || pageId === 'undefined') {
        return { data: [], count: 0 };
    }
    const offset = (page - 1) * limit;

    // USE CASTING TO TEXT FOR POSTGRES COMPATIBILITY (Handles both TEXT and UUID schemas)
    let params = [String(userId)]; // $1
    let whereClause = 'user_id::text = $1::text';

    // 1. Context Filtering (ID Array based)
    // If pageId is provided, show products assigned to THIS pageId.
    const contextType = await resolvePageContextType(pageId);
    const isWhatsapp = contextType === 'whatsapp';
    // #region debug-point F:db-get-products-context
    (()=>{const fs=require('fs');let u='',s='product-scope-leak';try{const e=fs.readFileSync('.dbg/product-scope-leak.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}if(u)fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'F',location:'dbService.js:getProducts:context',msg:'[DEBUG] db context resolved',data:{userId,pageId,contextType,isWhatsapp,searchQuery,allowedPageIdsCount:Array.isArray(allowedPageIds)?allowedPageIds.length:null},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    
    params.push(String(pageId));
    const pIdx = params.length;

    if (isWhatsapp) {
        whereClause += ` AND (allowed_wa_sessions::jsonb @> jsonb_build_array($${pIdx}::text))`;
    } else {
        whereClause += ` AND (allowed_messenger_ids::jsonb @> jsonb_build_array($${pIdx}::text))`;
    }

    // 2. Search Query
    if (searchQuery) {
        params.push(`%${searchQuery}%`);
        const sIdx = params.length;
        whereClause += ` AND (name ILIKE $${sIdx} OR description ILIKE $${sIdx} OR keywords ILIKE $${sIdx} OR searchable_text ILIKE $${sIdx})`;
    }

    // 3. Permission Filter (for Team Members)
    // Team members should see products assigned to a page/session they have access to.
    if (allowedPageIds !== null && allowedPageIds.length > 0) {
        const perms = allowedPageIds.map(String);
        params.push(perms);
        const pIdx = params.length;
        
        whereClause += ` AND (
            EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(allowed_messenger_ids, '[]'::jsonb)) AS elem WHERE elem = ANY($${pIdx}::text[])
            )
            OR
            EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(allowed_wa_sessions, '[]'::jsonb)) AS elem WHERE elem = ANY($${pIdx}::text[])
            )
        )`;
    }

    // 4. Get Total Count
    const countResult = await query(
        `SELECT COUNT(*)::int AS cnt FROM products WHERE ${whereClause}`,
        params
    );
    const totalCount = countResult.rows[0]?.cnt || 0;

    // 5. Get Paginated Data
    const dataResult = await query(
        `SELECT *
         FROM products
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const data = (dataResult.rows || []).map(normalizeProductRecord);
    // #region debug-point F:db-get-products-result
    (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='product-scope-leak';try{const e=fs.readFileSync('.dbg/product-scope-leak.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'F',location:'dbService.js:getProducts:result',msg:'[DEBUG] db products selected',data:{userId,pageId,contextType,count:data.length,firstProducts:data.slice(0,5).map(p=>({id:p.id,name:p.name,allowed_messenger_ids:p.allowed_messenger_ids,allowed_wa_sessions:p.allowed_wa_sessions,platform:p.platform}))},ts:Date.now()})}).catch(()=>{})})();
    // #endregion

    return { data, count: totalCount };
}

// 28. Get Product By ID
async function getProductById(id) {
    const result = await query(
        'SELECT * FROM products WHERE id = $1 LIMIT 1',
        [id]
    );
    
    if (result.rows.length === 0) return null;
    return normalizeProductRecord(result.rows[0]);
}

/**
 * Find a product by its main image URL (used for resolving additional images)
 * @param {string} userId 
 * @param {string} imageUrl 
 * @returns {Promise<Object|null>}
 */
async function getProductByImageUrl(userId, imageUrl) {
    try {
        const result = await query(
            'SELECT * FROM products WHERE user_id::text = $1::text AND (image_url = $2 OR additional_images::text LIKE $3) LIMIT 1',
            [String(userId), imageUrl, `%${imageUrl}%`]
        );
        return result.rows.length > 0 ? normalizeProductRecord(result.rows[0]) : null;
    } catch (error) {
        console.error("[DB] getProductByImageUrl Error:", error.message);
        return null;
    }
}

async function getResourceProductsWithMedia(pageId) {
    try {
        if (!pageId) return [];

        try {
            await query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='isolate_sku_images') THEN
                        ALTER TABLE products ADD COLUMN isolate_sku_images BOOLEAN DEFAULT false;
                    END IF;
                END $$;
            `);
        } catch (e) {
            console.warn("[DB] products migration failed:", e.message);
        }

        const { isWhatsapp, resourceIds } = await resolveResourceSearchContext(pageId);
        if (resourceIds.length === 0) return [];

        let sql = `
            SELECT id, name, description, image_url, additional_images, video_url, variants, product_mode, attribute_schema, sku_matrix
            FROM products
            WHERE is_active = true
        `;
        let params = [];
        ({ sql, params } = appendAssignmentFilter(sql, params, isWhatsapp, resourceIds));
        sql += ` ORDER BY id DESC`;

        const result = await query(sql, params);
        return (result.rows || []).map(normalizeProductRecord);
    } catch (error) {
        console.error("[DB] getResourceProductsWithMedia Error:", error.message);
        return [];
    }
}

// 29. Update Product
async function updateProduct(id, userId, updates) {
    // #region debug-point D:update-product-entry
    (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='auto-extract-500';try{const e=fs.readFileSync('.dbg/auto-extract-500.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'dbService.js:updateProduct:entry',msg:'[DEBUG] updateProduct entered',data:{userId,userIdType:typeof userId,id,idType:typeof id,updateKeys:Object.keys(updates||{}),keywordsType:typeof updates?.keywords},ts:Date.now()})}).catch(()=>{})})();
    // #endregion
    const normalizedUpdates = { ...(updates || {}) };
    if (normalizedUpdates.product_mode !== undefined || normalizedUpdates.attribute_schema !== undefined || normalizedUpdates.sku_matrix !== undefined || normalizedUpdates.variants !== undefined) {
        const existing = await getProductById(id);
        const merged = normalizeProductRecord({
            ...(existing || {}),
            ...normalizedUpdates,
            user_id: existing?.user_id || userId
        });
        normalizedUpdates.product_mode = merged.product_mode;
        normalizedUpdates.attribute_schema = merged.attribute_schema;
        normalizedUpdates.sku_matrix = merged.sku_matrix;
        normalizedUpdates.variants = merged.variants;
        normalizedUpdates.searchable_text = buildProductSearchBlob(merged);
    } else if (normalizedUpdates.searchable_text === undefined) {
        const existing = await getProductById(id);
        if (existing) {
            normalizedUpdates.searchable_text = buildProductSearchBlob({ ...existing, ...normalizedUpdates });
        }
    }
    const keys = Object.keys(normalizedUpdates || {});
    
    if (keys.length === 0) {
        const existing = await getProductById(id);
        if (!existing || existing.user_id !== userId) {
            throw new Error('Product not found or not owned by user');
        }
        return existing;
    }

    const setFragments = [];
    const values = [];
    let idx = 1;

    for (const key of keys) {
        setFragments.push(`${key} = $${idx}`);
        
        let val = normalizedUpdates[key];
        const jsonFields = ['variants', 'allowed_messenger_ids', 'allowed_wa_sessions', 'combo_items', 'additional_images', 'attribute_schema', 'sku_matrix'];
        if (jsonFields.includes(key) && val !== undefined) {
            // Ensure JSONB fields are strings for Postgres
            if (typeof val === 'object') {
                val = JSON.stringify(val);
            }
        }
        
        values.push(val);
        idx++;
    }

    values.push(String(userId));
    values.push(id);

    try {
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='isolate_sku_images') THEN
                    ALTER TABLE products ADD COLUMN isolate_sku_images BOOLEAN DEFAULT false;
                END IF;
            END $$;
        `);
    } catch (e) {
        console.warn("[DB] products migration failed during update:", e.message);
    }

    const sql = `
        UPDATE products
        SET ${setFragments.join(', ')}
        WHERE user_id::text = $${idx}::text AND id = $${idx + 1}
        RETURNING *`;
    // #region debug-point D:update-product-sql
    (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='auto-extract-500';try{const e=fs.readFileSync('.dbg/auto-extract-500.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'dbService.js:updateProduct:sql',msg:'[DEBUG] updateProduct sql prepared',data:{sql,valuesLength:values.length,lastTwoValues:values.slice(-2),setFragments},ts:Date.now()})}).catch(()=>{})})();
    // #endregion

    const result = await query(sql, values);

    if (result.rows.length === 0) {
        throw new Error('Product not found or not owned by user');
    }

    // Background Embedding Update
    const product = normalizeProductRecord(result.rows[0]);
    queueProductEmbeddingRefresh(product);

    return normalizeProductRecord(result.rows[0]);
}

async function updateProductEmbedding(productId, vector) {
    try {
        await query(
            'UPDATE products SET embedding = $1 WHERE id = $2',
            [JSON.stringify(vector), productId]
        );
        return true;
    } catch (e) {
        console.error(`[DB] updateProductEmbedding error: ${e.message}`);
        return false;
    }
}

async function upsertProductImageEmbedding({ productId, userId, pageId, imageUrl, imageRole, vector, visualTags }) {
    try {
        if (!vector) return false;
        // #region debug-point C:upsert-entry
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='auto-extract-500';try{const e=fs.readFileSync('.dbg/auto-extract-500.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'dbService.js:upsertProductImageEmbedding:entry',msg:'[DEBUG] upsertProductImageEmbedding entered',data:{productId,productIdType:typeof productId,userId,userIdType:typeof userId,pageId:pageId||null,imageRole:imageRole||'primary',imageUrlLength:String(imageUrl||'').length,vectorLength:Array.isArray(vector)?vector.length:0,visualTagsType:Array.isArray(visualTags)?'array':typeof visualTags},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        // First delete any existing entry for same product_id and image_url
        await query(
            `DELETE FROM product_image_embeddings WHERE product_id = $1 AND image_url = $2`,
            [productId, imageUrl]
        );
        // Then insert the new one
        await query(
            `INSERT INTO product_image_embeddings 
             (product_id, user_id, page_id, image_url, image_role, embedding, visual_tags)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                productId, 
                String(userId), 
                pageId ? String(pageId) : null, 
                imageUrl, 
                imageRole || 'primary', 
                JSON.stringify(vector),
                visualTags ? JSON.stringify(visualTags) : '[]'
            ]
        );
        // #region debug-point C:upsert-success
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='auto-extract-500';try{const e=fs.readFileSync('.dbg/auto-extract-500.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'dbService.js:upsertProductImageEmbedding:success',msg:'[DEBUG] upsertProductImageEmbedding completed',data:{productId,imageUrlLength:String(imageUrl||'').length},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        return true;
    } catch (e) {
        // #region debug-point C:upsert-error
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='auto-extract-500';try{const x=fs.readFileSync('.dbg/auto-extract-500.env','utf8');u=x.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=x.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'dbService.js:upsertProductImageEmbedding:catch',msg:'[DEBUG] upsertProductImageEmbedding failed',data:{message:e?.message||String(e),stack:e?.stack||null,productId,userId,pageId:pageId||null,imageRole:imageRole||'primary'},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        console.error(`[DB] upsertProductImageEmbedding error: ${e.message}`);
        return false;
    }
}

function getPrimaryProductResourceId(product) {
    if (Array.isArray(product?.allowed_messenger_ids) && product.allowed_messenger_ids[0]) {
        return product.allowed_messenger_ids[0];
    }
    if (Array.isArray(product?.allowed_wa_sessions) && product.allowed_wa_sessions[0]) {
        return product.allowed_wa_sessions[0];
    }
    return null;
}

async function refreshProductEmbeddingsNow(product, options = {}) {
    if (!product?.id) return { textUpdated: false, imageUpdated: 0 };

    const aiService = require('./aiService');
    const normalizedProduct = normalizeProductRecord(product);
    const embedText = buildProductSearchBlob(normalizedProduct);
    const resourceId = getPrimaryProductResourceId(normalizedProduct);
    let textUpdated = false;
    let imageUpdated = 0;

    try {
        const vector = await aiService.getEmbedding(embedText, options.customApiKey || null);
        if (vector) {
            textUpdated = await updateProductEmbedding(normalizedProduct.id, vector);
        }
    } catch (e) {
        console.warn(`[DB] refreshProductEmbeddingsNow text embedding failed for ${normalizedProduct.id}: ${e.message}`);
    }

    const imageUrls = [
        normalizedProduct.image_url,
        ...(Array.isArray(normalizedProduct.additional_images) ? normalizedProduct.additional_images : [])
    ].filter(Boolean);

    for (let idx = 0; idx < imageUrls.length; idx++) {
        const imgUrl = imageUrls[idx];
        try {
            const imgVector = await aiService.getImageEmbedding(imgUrl, options.customApiKey || null, options.pageConfig || {});
            if (imgVector) {
                const saved = await upsertProductImageEmbedding({
                    productId: normalizedProduct.id,
                    userId: normalizedProduct.user_id,
                    pageId: resourceId,
                    imageUrl: imgUrl,
                    imageRole: idx === 0 ? 'primary' : 'additional',
                    vector: imgVector
                });
                if (saved) imageUpdated++;
            }
        } catch (e) {
            console.warn(`[DB] refreshProductEmbeddingsNow image embedding failed for ${normalizedProduct.id}: ${e.message}`);
        }
    }

    return { textUpdated, imageUpdated };
}

function queueProductEmbeddingRefresh(product) {
    if (!product?.id) return;
    const aiService = require('./aiService');
    const embedText = buildProductSearchBlob(product);
    // #region debug-point A:embedding-refresh-start
    (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const e=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'dbService.js:queueProductEmbeddingRefresh:start',msg:'[DEBUG] queueProductEmbeddingRefresh invoked',data:{productId:product.id,name:product.name,hasPrimaryImage:Boolean(product.image_url),additionalImageCount:Array.isArray(product.additional_images)?product.additional_images.length:0,hasAllowedWa:Array.isArray(product.allowed_wa_sessions)&&product.allowed_wa_sessions.length>0,hasAllowedMessenger:Array.isArray(product.allowed_messenger_ids)&&product.allowed_messenger_ids.length>0,searchableTextLength:embedText?.length||0},ts:Date.now()})}).catch(()=>{})})();
    // #endregion

    // 1. Text Embedding
    aiService.getEmbedding(embedText).then((vector) => {
        // #region debug-point B:text-embedding-result
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const e=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'B',location:'dbService.js:queueProductEmbeddingRefresh:text',msg:'[DEBUG] text embedding resolved',data:{productId:product.id,hasVector:Boolean(vector),vectorLength:Array.isArray(vector)?vector.length:0},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        if (vector) {
            updateProductEmbedding(product.id, vector).catch((e) => console.warn(`[DB] Background embedding update failed: ${e.message}`));
        }
    }).catch((e) => {
        // #region debug-point B:text-embedding-error
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const x=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=x.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=x.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'B',location:'dbService.js:queueProductEmbeddingRefresh:text-error',msg:'[DEBUG] text embedding failed',data:{productId:product.id,error:e?.message||String(e)},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        console.warn(`[DB] Embedding generation failed: ${e.message}`);
    });

    // 2. Image Embeddings
    const imageUrls = [
        product.image_url,
        ...(Array.isArray(product.additional_images) ? product.additional_images : [])
    ].filter(Boolean);

    imageUrls.forEach((imgUrl, idx) => {
        aiService.getImageEmbedding(imgUrl).then(imgVector => {
            // #region debug-point C:image-embedding-result
            (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const e=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'dbService.js:queueProductEmbeddingRefresh:image',msg:'[DEBUG] image embedding resolved',data:{productId:product.id,imageRole:idx===0?'primary':'additional',imageUrl:imgUrl,hasVector:Boolean(imgVector),vectorLength:Array.isArray(imgVector)?imgVector.length:0,pageId:Array.isArray(product.allowed_messenger_ids)&&product.allowed_messenger_ids[0]?product.allowed_messenger_ids[0]:null},ts:Date.now()})}).catch(()=>{})})();
            // #endregion
            if (imgVector) {
                upsertProductImageEmbedding({
                    productId: product.id,
                    userId: product.user_id,
                    pageId: getPrimaryProductResourceId(product),
                    imageUrl: imgUrl,
                    imageRole: idx === 0 ? 'primary' : 'additional',
                    vector: imgVector
                });
            }
        }).catch((e) => {
            // #region debug-point C:image-embedding-error
            (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const x=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=x.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=x.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'dbService.js:queueProductEmbeddingRefresh:image-error',msg:'[DEBUG] image embedding failed',data:{productId:product.id,imageRole:idx===0?'primary':'additional',imageUrl:imgUrl,error:e?.message||String(e)},ts:Date.now()})}).catch(()=>{})})();
            // #endregion
        });
    });
}

async function backfillGeneratedSkuMatrixForLegacyProducts(limit = 200) {
    try {
        const result = await query(
            `SELECT *
             FROM products
             WHERE product_mode = 'sku-matrix'
               AND COALESCE(jsonb_array_length(sku_matrix), 0) = 0
               AND COALESCE(jsonb_array_length(attribute_schema), 0) > 0
             ORDER BY id DESC
             LIMIT $1`,
            [limit]
        );

        let repairedCount = 0;
        for (const row of result.rows || []) {
            const normalized = normalizeProductRecord(row);
            if (!Array.isArray(normalized?.sku_matrix) || normalized.sku_matrix.length === 0) {
                continue;
            }

            const nextSearchableText = buildProductSearchBlob(normalized);
            await query(
                `UPDATE products
                 SET sku_matrix = $1,
                     variants = $2,
                     searchable_text = $3
                 WHERE id = $4`,
                [
                    JSON.stringify(normalized.sku_matrix),
                    JSON.stringify(normalized.variants || []),
                    nextSearchableText,
                    row.id
                ]
            );

            normalized.searchable_text = nextSearchableText;
            queueProductEmbeddingRefresh(normalized);
            repairedCount++;
        }

        if (repairedCount > 0) {
            console.log(`[DB] Legacy sku-matrix backfill repaired ${repairedCount} product(s).`);
        }
        return repairedCount;
    } catch (error) {
        console.warn(`[DB] Legacy sku-matrix backfill skipped: ${error.message}`);
        return 0;
    }
}

// 30. Delete Product
async function deleteProduct(id, userId) {
    const result = await query(
        'DELETE FROM products WHERE id = $1 AND user_id::text = $2::text RETURNING id',
        [id, String(userId)]
    );

    if (result.rows.length === 0) {
        throw new Error('Product not found or not owned by user');
    }

    return true;
}

// 30.5 Get Products by Exact Names (For System Prompt Injection)
async function getProductsByNames(userId, productNames, pageId = null) {
    if (!productNames || productNames.length === 0) return [];
    
    let sql = `
        SELECT * FROM products 
        WHERE user_id::text = $1::text 
        AND is_active = true 
        AND name ILIKE ANY($2)
    `;
    
    const params = [String(userId), productNames];

    if (pageId) {
        const contextType = await resolvePageContextType(pageId);
        const isWhatsapp = contextType === 'whatsapp';
        
        params.push(String(pageId));
        const pIdx = params.length;

        if (isWhatsapp) {
            sql += ` AND (allowed_wa_sessions::jsonb @> jsonb_build_array($${pIdx}::text))`;
        } else {
            // FOR MESSENGER: Only check allowed_messenger_ids (Modern Standard)
            sql += ` AND (allowed_messenger_ids::jsonb @> jsonb_build_array($${pIdx}::text))`;
        }
    }
    
    try {
        const result = await query(sql, params);
        return (result.rows || []).map(normalizeProductRecord);
    } catch (err) {
        console.warn("[DB] Failed to fetch products by names:", err.message);
        return [];
    }
}

async function resolveResourceSearchContext(pageId) {
    if (!pageId) {
        return { contextType: null, isWhatsapp: false, resourceIds: [] };
    }

    const resourceId = String(pageId);
    const contextType = await resolvePageContextType(resourceId);
    const isWhatsapp = contextType === 'whatsapp';

    if (!isWhatsapp) {
        return { contextType, isWhatsapp, resourceIds: [resourceId] };
    }

    try {
        const result = await query(
            `SELECT session_name, waba_id, phone_number_id
             FROM whatsapp_message_database
             WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1
             ORDER BY
                CASE
                    WHEN session_name = $1 THEN 0
                    WHEN waba_id = $1 THEN 1
                    WHEN phone_number_id = $1 THEN 2
                    ELSE 3
                END
             LIMIT 1`,
            [resourceId]
        );

        const row = result.rows[0];
        const resourceIds = Array.from(new Set(
            [resourceId, row?.session_name, row?.waba_id, row?.phone_number_id]
                .map(value => String(value || '').trim())
                .filter(Boolean)
        ));

        return { contextType, isWhatsapp, resourceIds };
    } catch (err) {
        console.warn(`[DB] resolveResourceSearchContext failed for ${resourceId}: ${err.message}`);
        return { contextType, isWhatsapp, resourceIds: [resourceId] };
    }
}

function appendAssignmentFilter(sql, params, isWhatsapp, resourceIds) {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(resourceIds) ? resourceIds : [])
            .map(id => String(id || '').trim())
            .filter(Boolean)
    ));

    if (normalizedIds.length === 0) {
        return { sql, params };
    }

    const column = isWhatsapp ? 'allowed_wa_sessions' : 'allowed_messenger_ids';

    if (normalizedIds.length === 1) {
        params.push(normalizedIds[0]);
        const pIdx = params.length;
        sql += ` AND (${column}::jsonb @> jsonb_build_array($${pIdx}::text))`;
        return { sql, params };
    }

    params.push(normalizedIds);
    const pIdx = params.length;
    sql += ` AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${column}, '[]'::jsonb)) AS elem
        WHERE elem = ANY($${pIdx}::text[])
    )`;

    return { sql, params };
}

async function searchProductsForResource(queryText, pageId = null) {
    try {
        if (!pageId) return [];

        const { isWhatsapp, resourceIds } = await resolveResourceSearchContext(pageId);
        if (resourceIds.length === 0) return [];

        const cleanQuery = (queryText || '').trim();
        const queryTokens = extractSearchTokens(cleanQuery);
        const queryNumberTokens = queryTokens.filter((token) => /^\d+$/.test(token));
        const applyExactNumberPreference = (products = []) => {
            return (Array.isArray(products) ? products : [])
                .filter((product) => {
                    if (queryNumberTokens.length === 0) return true;
                    const productTokens = extractSearchTokens([
                        product?.name,
                        product?.description,
                        product?.searchable_text
                    ].join(' '));
                    const productNumberTokens = productTokens.filter((token) => /^\d+$/.test(token));
                    if (productNumberTokens.length === 0) return true;
                    return queryNumberTokens.some((token) => productNumberTokens.includes(token));
                })
                .sort((a, b) => Number(a?.distance ?? 999) - Number(b?.distance ?? 999));
        };

        const lexicalFallback = async () => {
            let fallbackSql = `
                SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, additional_images, product_mode, attribute_schema, sku_matrix, searchable_text
                FROM products
                WHERE is_active = true
            `;
            let fallbackParams = [];
            ({ sql: fallbackSql, params: fallbackParams } = appendAssignmentFilter(fallbackSql, fallbackParams, isWhatsapp, resourceIds));
            fallbackSql += ` ORDER BY id DESC LIMIT 100`;

            const fallbackRes = await query(fallbackSql, fallbackParams);
            const normalizedProducts = (fallbackRes.rows || []).map(normalizeProductRecord);
            const ranked = normalizedProducts
                .map((product) => {
                    const haystack = normalizeTextToken([
                        product.name,
                        product.description,
                        product.keywords,
                        product.visual_tags,
                        product.searchable_text
                    ].join(' '));
                    let score = 0;
                    const productTokens = extractSearchTokens(haystack);
                    const productTokenSet = new Set(productTokens);
                    const productNumberTokens = productTokens.filter((token) => /^\d+$/.test(token));

                    if (!haystack) return null;
                    if (haystack.includes(normalizeTextToken(cleanQuery))) score += 60;
                    queryTokens.forEach((token) => {
                        if (token.length < 2) return;
                        if (haystack.includes(token)) {
                            score += product.name && normalizeTextToken(product.name).includes(token) ? 16 : 8;
                        }
                    });

                    if (queryNumberTokens.length > 0) {
                        // Strict Number Matching logic
                        const matchedNumberCount = queryNumberTokens.filter((token) => productTokenSet.has(token)).length;
                        score += matchedNumberCount * 40; // Increase weight
                        
                        // Critical fix: If a number was searched but NOT matched, penalize heavily
                        if (matchedNumberCount < queryNumberTokens.length && productNumberTokens.length > 0) {
                            score -= 80;
                        }
                    }

                    const resolved = resolveProductSkuSelection(product, cleanQuery);
                    if (resolved.selectedSku) score += 40; // Increase priority for exact SKU matches
                    else if (resolved.matches.length > 0) score += 20;

                    if (normalizeTextToken(product.name) === normalizeTextToken(cleanQuery)) score += 30;
                    return score > 0 ? { ...product, distance: Math.max(0, 1 - (Math.min(score, 100) / 100)) } : null;
                })
                .filter(Boolean);

            const preferred = applyExactNumberPreference(ranked).slice(0, 5);

            if (preferred.length > 0) {
                console.log(`[DB] searchProductsForResource lexical fallback matched ${preferred.length} product(s) for "${cleanQuery}"`);
            }
            return preferred;
        };

        if (!cleanQuery) {
            let sql = `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, additional_images, product_mode, attribute_schema, sku_matrix, searchable_text, 0 as distance FROM products WHERE is_active = true`;
            let params = [];
            ({ sql, params } = appendAssignmentFilter(sql, params, isWhatsapp, resourceIds));
            sql += ` ORDER BY id DESC LIMIT 5`;
            const res = await query(sql, params);
            return (res.rows || []).map(normalizeProductRecord);
        }

        const aiService = require('./aiService');
        let queryVector = null;
        try {
            queryVector = await aiService.getEmbedding(cleanQuery);
        } catch (embeddingError) {
            console.warn(`[DB] Embedding generation failed for "${cleanQuery}", using lexical fallback: ${embeddingError.message}`);
        }

        if (!queryVector) {
            return await lexicalFallback();
        }

        let sql = `
            SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, additional_images, product_mode, attribute_schema, sku_matrix, searchable_text,
                   (embedding <=> $1::vector) as distance
            FROM products
            WHERE is_active = true
              AND embedding IS NOT NULL
        `;

        let params = [JSON.stringify(queryVector)];
        ({ sql, params } = appendAssignmentFilter(sql, params, isWhatsapp, resourceIds));
        sql += ` ORDER BY distance ASC LIMIT 5`;

        const start = Date.now();
        const result = await query(sql, params);
        const end = Date.now();

        if (end - start > 1000) {
            console.warn(`[DB] searchProductsForResource SLOW query: ${end - start}ms for "${cleanQuery}"`);
        }

        let filtered = (result.rows || [])
            .map(normalizeProductRecord)
            .filter((p) => {
                const numericDistance = Number(p.distance);
                return Number.isFinite(numericDistance) && numericDistance < 0.4;
            });
        filtered = applyExactNumberPreference(filtered);

        if (filtered.length < 3) {
            const lexicalMatches = await lexicalFallback();
            if (lexicalMatches.length > 0) {
                const seen = new Set(filtered.map((item) => String(item.id)));
                lexicalMatches.forEach((item) => {
                    if (!seen.has(String(item.id))) {
                        filtered.push(item);
                        seen.add(String(item.id));
                    }
                });
                filtered = applyExactNumberPreference(filtered).slice(0, 5);
            }
        }
        
        // --- FALLBACK: If semantic results are weak or missing, try lexical ranking over searchable text ---
        if (filtered.length === 0) {
            const lexicalMatches = await lexicalFallback();
            if (lexicalMatches.length > 0) {
                return lexicalMatches;
            }

            const genericTerms = ['ki ki', 'product', 'item', 'list', 'show', 'ase', 'details', 'picture', 'photo', 'দাম', 'ছবি', 'প্রোডাক্ট'];
            const isGeneric = genericTerms.some(term => cleanQuery.toLowerCase().includes(term)) || cleanQuery.length < 10;
            
            if (isGeneric) {
                console.log(`[DB] No semantic matches but query is generic. Fetching latest 5 products as fallback.`);
                let fallbackSql = `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, additional_images, product_mode, attribute_schema, sku_matrix, searchable_text, 0.5 as distance FROM products WHERE is_active = true`;
                let fallbackParams = [];
                ({ sql: fallbackSql, params: fallbackParams } = appendAssignmentFilter(fallbackSql, fallbackParams, isWhatsapp, resourceIds));
                fallbackSql += ` ORDER BY id DESC LIMIT 5`;
                const fallbackRes = await query(fallbackSql, fallbackParams);
                return (fallbackRes.rows || []).map(normalizeProductRecord);
            }
        }

        return filtered;
    } catch (error) {
        console.error("[DB] searchProductsForResource Error:", error.message);
        throw error;
    }
}

// 31. Search Products (For AI) - Enhanced with Vector Search (Pure Vector Mode)
async function searchProducts(userId, queryText, pageId = null) {
    try {
        if (!userId) return [];
        const cleanQuery = (queryText || '').trim();
        
        // --- FALLBACK: If query is empty, return latest products for this user/page ---
        if (!cleanQuery) {
            const contextType = pageId ? await resolvePageContextType(pageId) : null;
            const isWhatsapp = contextType === 'whatsapp';
            let sql = `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, product_mode, attribute_schema, sku_matrix, searchable_text, 0 as distance FROM products WHERE user_id::text = $1::text AND is_active = true`;
            const params = [String(userId)];
            if (pageId) {
                params.push(String(pageId));
                if (isWhatsapp) sql += ` AND (allowed_wa_sessions::jsonb @> jsonb_build_array($2::text))`;
                else sql += ` AND (allowed_messenger_ids::jsonb @> jsonb_build_array($2::text))`;
            }
            sql += ` ORDER BY id DESC LIMIT 5`;
            const res = await query(sql, params);
            return (res.rows || []).map(normalizeProductRecord);
        }

        const aiService = require('./aiService');
        const queryVector = await aiService.getEmbedding(cleanQuery);
        
        if (!queryVector) {
            throw new Error("Vector search failed: Embedding generation returned null.");
        }

        const contextType = pageId ? await resolvePageContextType(pageId) : null;
        const isWhatsapp = contextType === 'whatsapp';
        const pageColumn = isWhatsapp ? 'allowed_wa_sessions' : 'allowed_messenger_ids';

        let sql = `
            SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description, product_mode, attribute_schema, sku_matrix, searchable_text,
                   (embedding <=> $1::vector) as distance
            FROM products
            WHERE user_id::text = $2::text AND is_active = true
              AND embedding IS NOT NULL
        `;
        
        const params = [JSON.stringify(queryVector), String(userId)];

        if (pageId) {
            params.push(String(pageId));
            const pIdx = params.length;

            if (isWhatsapp) {
                sql += ` AND (allowed_wa_sessions::jsonb @> jsonb_build_array($${pIdx}::text))`;
            } else {
                sql += ` AND (allowed_messenger_ids::jsonb @> jsonb_build_array($${pIdx}::text))`;
            }
        }

        sql += ` ORDER BY distance ASC LIMIT 5`;

        const start = Date.now();
        const result = await query(sql, params);
        const end = Date.now();
        
        if (end - start > 1000) {
            console.warn(`[DB] searchProducts SLOW query: ${end - start}ms for "${cleanQuery}"`);
        } else {
            // console.log(`[DB] searchProducts FAST query: ${end - start}ms`);
        }
        
        // Return products only if they are reasonably similar (threshold check)
        // distance < 0.4 is usually a good match for cosine similarity
        return (result.rows || [])
            .map(normalizeProductRecord)
            .filter((p) => {
                const numericDistance = Number(p.distance);
                return Number.isFinite(numericDistance) && numericDistance < 0.4;
            });
        
    } catch (error) {
        console.error("[DB] searchProducts Vector Error:", error.message);
        throw error; // Throw error so controller can handle it (Status: 503)
    }
}

// 31.5 Search Products by Image Vector
async function searchProductByImageVector(imageVector, pageId) {
    try {
        if (!imageVector || !pageId) return [];

        const { isWhatsapp, resourceIds } = await resolveResourceSearchContext(pageId);
        // #region debug-point D:image-vector-search-input
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const e=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'dbService.js:searchProductByImageVector:start',msg:'[DEBUG] image vector search invoked',data:{pageId,isWhatsapp,resourceIds,hasVector:Boolean(imageVector),vectorLength:Array.isArray(imageVector)?imageVector.length:0},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        if (resourceIds.length === 0) return [];

        let sql = `
            SELECT p.id, p.name, p.description, p.image_url, p.price, p.currency, p.variants, p.is_combo, p.combo_items, p.allow_description, p.product_mode, p.attribute_schema, p.sku_matrix,
                   (pie.embedding <=> $1::vector) as distance
            FROM product_image_embeddings pie
            JOIN products p ON p.id = pie.product_id
            WHERE p.is_active = true
              AND pie.embedding IS NOT NULL
        `;

        let params = [JSON.stringify(imageVector)];
        
        // Use existing appendAssignmentFilter which handles resource IDs for p.allowed_xx correctly
        // We alias products as 'p' in the query, but appendAssignmentFilter doesn't know about aliases.
        // We'll manually append the filter with the 'p.' alias here for safety.
        
        const normalizedIds = Array.from(new Set(
            (Array.isArray(resourceIds) ? resourceIds : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)
        ));

        if (normalizedIds.length > 0) {
            const column = isWhatsapp ? 'p.allowed_wa_sessions' : 'p.allowed_messenger_ids';
            if (normalizedIds.length === 1) {
                params.push(normalizedIds[0]);
                sql += ` AND (${column}::jsonb @> jsonb_build_array($${params.length}::text))`;
            } else {
                params.push(normalizedIds);
                sql += ` AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(COALESCE(${column}, '[]'::jsonb)) AS elem WHERE elem = ANY($${params.length}::text[])
                )`;
            }
        }

        sql += ` ORDER BY distance ASC LIMIT 5`;

        const result = await query(sql, params);
        // #region debug-point D:image-vector-search-output
        (()=>{const fs=require('fs');let u='http://127.0.0.1:7777/event',s='image-match-stability';try{const e=fs.readFileSync('.dbg/image-match-stability.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'dbService.js:searchProductByImageVector:result',msg:'[DEBUG] image vector search completed',data:{pageId,rowCount:(result.rows||[]).length,topMatches:(result.rows||[]).slice(0,3).map(r=>({id:r.id,name:r.name,distance:r.distance,price:r.price}))},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        
        return (result.rows || [])
            .filter(row => row.distance !== null && row.distance !== undefined)
            .map(row => {
                const product = normalizeProductRecord(row);
                return { ...product, distance: row.distance };
            });
            
    } catch (error) {
        console.error("[DB] searchProductByImageVector Error:", error.message);
        return [];
    }
}

// 45. Get Ad Context from Ads Library
async function getAdContext(adId, pageId) {
    const { query } = require('./pgClient');
    try {
        const result = await query(
            'SELECT * FROM ads_library WHERE ad_id = $1 AND page_id = $2 LIMIT 1',
            [adId, pageId]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        // Silently fail if table doesn't exist yet to avoid crashing
        if (error.code === '42P01') {
            console.warn(`[DB] ads_library table does not exist. Skipping ad context fetch for ad_id: ${adId}`);
            return null;
        }
        console.error(`Error fetching ad context for ad_id ${adId}:`, error.message);
        return null;
    }
}

// 46. Save or Update Ad Context (Team Member Compatible)
async function saveAdContext(data) {
    const { ad_id, page_id, user_id, description, linked_product_ids } = data;
    try {
        const result = await query(
            `INSERT INTO ads_library (ad_id, page_id, user_id, description, linked_product_ids)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (ad_id, page_id) 
             DO UPDATE SET 
                description = EXCLUDED.description,
                linked_product_ids = EXCLUDED.linked_product_ids,
                user_id = EXCLUDED.user_id
             RETURNING *`,
            [ad_id, page_id, user_id, description, JSON.stringify(linked_product_ids || [])]
        );
        return result.rows[0];
    } catch (error) {
        console.error("Error saving ad context:", error.message);
        throw error;
    }
}

// 47. Get All Ads for a User/Team (Team Member Compatible)
async function getAdsByUserId(userId, allowedPageIds = null) {
    try {
        let sql = 'SELECT * FROM ads_library WHERE user_id::text = $1::text';
        const params = [userId];

        if (allowedPageIds && allowedPageIds.length > 0) {
            sql += ' AND page_id = ANY($2)';
            params.push(allowedPageIds);
        }

        const result = await query(sql, params);
        return result.rows;
    } catch (error) {
        console.error("Error fetching ads by user ID:", error.message);
        return [];
    }
}

// 49. Get Model Usage for an API Key
async function getModelUsage(apiKeyId, modelName) {
    try {
        const result = await query(
            'SELECT * FROM api_key_model_usage WHERE api_key_id = $1 AND model_name = $2 LIMIT 1',
            [apiKeyId, modelName]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] getModelUsage error:", error.message);
        return null;
    }
}

// 50. Save or Update Model Usage
async function saveModelUsage(data) {
    const { api_key_id, model_name, usage_delta, status, cooldown_until } = data;
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await query(
            `INSERT INTO api_key_model_usage (api_key_id, model_name, usage_today, status, cooldown_until, last_date_checked, last_used_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (api_key_id, model_name) 
             DO UPDATE SET 
                usage_today = CASE WHEN api_key_model_usage.last_date_checked = EXCLUDED.last_date_checked THEN api_key_model_usage.usage_today + EXCLUDED.usage_today ELSE EXCLUDED.usage_today END,
                status = COALESCE(EXCLUDED.status, api_key_model_usage.status),
                cooldown_until = COALESCE(EXCLUDED.cooldown_until, api_key_model_usage.cooldown_until),
                last_date_checked = EXCLUDED.last_date_checked,
                last_used_at = NOW(),
                updated_at = NOW()
             RETURNING *`,
            [api_key_id, model_name, usage_delta || 0, status || null, cooldown_until || null, today]
        );
        return result.rows[0];
    } catch (error) {
        console.error("[DB] saveModelUsage error:", error.message);
        throw error;
    }
}

// 51. Clear Expired Model Locks
async function clearExpiredModelLocks() {
    try {
        const result = await query(
            `UPDATE api_key_model_usage 
             SET status = 'active', cooldown_until = NULL 
             WHERE status = 'locked' AND (cooldown_until < NOW() OR (cooldown_until IS NULL AND last_used_at < (NOW() - interval '24 hours')))`
        );
        return result.rowCount;
    } catch (error) {
        console.error("[DB] clearExpiredModelLocks error:", error.message);
        return 0;
    }
}

// 52. Get All Model Usages for a Key
async function getAllModelUsagesForKey(apiKeyId) {
    try {
        const result = await query(
            'SELECT * FROM api_key_model_usage WHERE api_key_id = $1',
            [apiKeyId]
        );
        return result.rows;
    } catch (error) {
        console.error("[DB] getAllModelUsagesForKey error:", error.message);
        return [];
    }
}

// 53. Check if admin replied in fb_chats after a certain timestamp
async function hasFbAdminReplySince(pageId, recipientId, sinceTs) {
    try {
        const result = await query(
            `SELECT * FROM fb_chats 
             WHERE page_id = $1 
               AND (sender_id = $2 OR recipient_id = $2) 
               AND reply_by = 'admin' 
               AND timestamp > $3 
             ORDER BY timestamp DESC LIMIT 1`,
            [pageId, recipientId, sinceTs]
        );
        return result.rows.length > 0;
    } catch (error) {
        console.error("[DB] hasFbAdminReplySince error:", error.message);
        return false;
    }
}

// 54. Check if admin replied in whatsapp_chats after a certain timestamp
async function hasWhatsAppAdminReplySince(sessionName, senderId, sinceTs) {
    try {
        const result = await query(
            `SELECT * FROM whatsapp_chats 
             WHERE session_name = $1 
               AND (sender_id = $2 OR recipient_id = $2) 
               AND reply_by = 'admin' 
               AND timestamp > $3 
             ORDER BY timestamp DESC LIMIT 1`,
            [sessionName, senderId, sinceTs]
        );
        return result.rows.length > 0;
    } catch (error) {
        console.error("[DB] hasWhatsAppAdminReplySince error:", error.message);
        return false;
    }
}

// 55. Get timestamp of last user message in fb_chats
async function getLastFbUserMessageTimestamp(pageId, senderId) {
    try {
        const result = await query(
            `SELECT timestamp FROM fb_chats 
             WHERE page_id = $1 
               AND sender_id = $2 
               AND reply_by = 'user' 
             ORDER BY timestamp DESC LIMIT 1`,
            [pageId, senderId]
        );
        if (result.rows.length > 0) {
            return Number(result.rows[0].timestamp);
        }
        return null;
    } catch (error) {
        console.error("[DB] getLastFbUserMessageTimestamp error:", error.message);
        return null;
    }
}

// 56. Get timestamp of last user message in whatsapp_chats
async function getLastWhatsAppUserMessageTimestamp(sessionName, senderId) {
    try {
        const result = await query(
            `SELECT timestamp FROM whatsapp_chats 
             WHERE session_name = $1 
               AND sender_id = $2 
               AND reply_by = 'user' 
             ORDER BY timestamp DESC LIMIT 1`,
            [sessionName, senderId]
        );
        if (result.rows.length > 0) {
            return Number(result.rows[0].timestamp);
        }
        return null;
    } catch (error) {
        console.error("[DB] getLastWhatsAppUserMessageTimestamp error:", error.message);
        return null;
    }
}
