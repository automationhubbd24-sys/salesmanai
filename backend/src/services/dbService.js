const { query } = require('./pgClient');

// 1. Get Page Config (Multi-Tenant Rule - Step 7)
async function getPageConfig(pageId) {
  try {
    const result = await query(
      'SELECT * FROM page_access_token_message WHERE page_id = $1 LIMIT 1',
      [pageId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const data = result.rows[0];

    // Fallback: If user_id is missing but email exists, find user_id from user_configs
    if (!data.user_id && data.email) {
      const userResult = await query(
        'SELECT user_id, message_credit FROM user_configs WHERE email = $1 LIMIT 1',
        [data.email]
      );
      if (userResult.rows.length > 0) {
        data.user_id = userResult.rows[0].user_id;
        data.message_credit = userResult.rows[0].message_credit || 0;
        data.credit_source = 'shared_user_balance';
      }
    } else if (data.user_id) {
      const creditResult = await query(
        'SELECT message_credit FROM user_configs WHERE user_id = $1 LIMIT 1',
        [data.user_id]
      );

      if (creditResult.rows.length > 0) {
        data.message_credit = creditResult.rows[0].message_credit || 0;
        data.credit_source = 'shared_user_balance';
      } else {
        await query(
          'INSERT INTO user_configs (user_id, email, message_credit, balance) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING',
          [data.user_id, data.email || null, 100, 0]
        );
        data.message_credit = 100;
        data.credit_source = 'shared_user_balance';
      }
    }

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
    if (needsAiUpdate) {
      await query(
        'UPDATE page_access_token_message SET ai = $1, chat_model = $2, cheap_engine = $3 WHERE page_id = $4',
        [data.ai, data.chat_model, data.cheap_engine, pageId]
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

// 5. Credit Deduction (Centralized User Balance)
async function deductCredit(pageId, currentCredit) {
    try {
        const pageResult = await query(
            'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 LIMIT 1',
            [pageId]
        );

        if (pageResult.rows.length === 0 || !pageResult.rows[0].user_id) {
            console.warn(`[Credit] Page ${pageId} not linked to any user.`);
            return false;
        }

        const pageData = pageResult.rows[0];

        const userConfigResult = await query(
            'SELECT message_credit FROM user_configs WHERE user_id = $1 LIMIT 1',
            [pageData.user_id]
        );

        if (userConfigResult.rows.length === 0) {
            console.warn(`[Credit] User config not found for ${pageData.user_id}.`);
            return false;
        }

        const credit = userConfigResult.rows[0].message_credit || 0;
        if (credit <= 0) {
            console.warn(`[Credit] Insufficient credits for User ${pageData.user_id}. Balance: ${credit}`);
            return false;
        }

        await query(
            'UPDATE user_configs SET message_credit = $2 WHERE user_id = $1',
            [pageData.user_id, credit - 1]
        );

        console.log(`[Credit] Deducted 1 credit from User ${pageData.user_id}`);
        return true;
    } catch (err) {
        console.error("Error in manual user credit deduction:", err);
        return false;
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
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='allow_description') THEN
                    ALTER TABLE fb_message_database ADD COLUMN allow_description BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        `);
        console.log("[DB] 'fb_message_database.allow_description' column checked.");

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
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allowed_wa_sessions') THEN
                    ALTER TABLE products ADD COLUMN allowed_wa_sessions JSONB DEFAULT '[]'::jsonb;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allowed_page_ids') THEN
                    ALTER TABLE products ALTER COLUMN allowed_page_ids SET DEFAULT '[]'::jsonb;
                END IF;
            END $$;
        `);
        await query(`UPDATE products SET allowed_wa_sessions = '[]'::jsonb WHERE allowed_wa_sessions IS NULL`);
        await query(`UPDATE products SET allowed_page_ids = '[]'::jsonb WHERE allowed_page_ids IS NULL`);
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

        // Ensure 'api_list' has unique constraint on 'api'
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
            'SELECT balance FROM user_configs WHERE user_id = $1 LIMIT 1',
            [userId]
        );
        if (balanceResult.rows.length === 0) {
            throw new Error("User config not found");
        }

        const currentBalance = balanceResult.rows[0].balance || 0;
        const newBalance = currentBalance + Number(amount);

        await query(
            'UPDATE user_configs SET balance = $2 WHERE user_id = $1',
            [userId, newBalance]
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

    try {
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
    } catch (error) {
        console.error(`Error saving to fb_chats (msg: ${data.message_id}, page: ${data.page_id}):`, error.message);
    }
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

    const mainResult = await query(
        'SELECT * FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
        [sessionName]
    );
    if (mainResult.rows.length === 0) return null;

    const data = mainResult.rows[0];

    if (data.user_id) {
        const creditResult = await query(
            'SELECT message_credit FROM user_configs WHERE user_id = $1 LIMIT 1',
            [data.user_id]
        );
        if (creditResult.rows.length > 0) {
            data.message_credit = creditResult.rows[0].message_credit;
        } else {
            await query(
                'INSERT INTO user_configs (user_id, email, message_credit, balance) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING',
                [data.user_id, data.email || null, 100, 0]
            );
            data.message_credit = 100;
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
    if (needsAiUpdate) {
        await query(
            'UPDATE whatsapp_message_database SET ai_provider = $1, chat_model = $2, voice_model = $3, cheap_engine = $4 WHERE session_name = $5',
            [data.ai_provider || data.ai, data.chat_model, data.voice_model || null, data.cheap_engine, sessionName]
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
    let { session_name, sender_id, product_name, number, location, product_quantity, price } = orderData;
    const { query } = require('./pgClient');

    // Clean product name
    if (product_name) {
        if (product_name.includes('|')) product_name = product_name.split('|')[0].trim();
        product_name = product_name.replace(/Item \d+:/gi, '').replace(/##product/gi, '').replace(/"/g, '').replace(/\[.*?\]/g, '').trim();
        if (!product_name) product_name = 'Recovered Lead';
    }

    try {
        // SMART MERGE: Last 1 hour
        const recentOrder = await query(
            `SELECT id, product_name, number, location, product_quantity, price 
             FROM whatsapp_order_tracking 
             WHERE session_name = $1 AND sender_id = $2 
             AND created_at >= NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC LIMIT 1`,
            [session_name, sender_id]
        );

        if (recentOrder.rows.length > 0) {
            const existing = recentOrder.rows[0];
            const updates = [];
            const values = [];
            let idx = 1;

            if (product_name && product_name !== 'Recovered Lead' && (!existing.product_name || existing.product_name === 'Recovered Lead')) {
                updates.push(`product_name = $${idx++}`);
                values.push(product_name);
            }
            if (number && !existing.number) {
                updates.push(`number = $${idx++}`);
                values.push(number);
            }
            if (location && location !== 'N/A' && (!existing.location || existing.location === 'N/A' || existing.location === '')) {
                updates.push(`location = $${idx++}`);
                values.push(location);
            }
            if (product_quantity && product_quantity !== '1' && (!existing.product_quantity || existing.product_quantity === '1')) {
                updates.push(`product_quantity = $${idx++}`);
                values.push(product_quantity);
            }
            if (price && !existing.price) {
                updates.push(`price = $${idx++}`);
                values.push(price);
            }

            if (updates.length > 0) {
                values.push(existing.id);
                const updateResult = await query(
                    `UPDATE whatsapp_order_tracking SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
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

        if (!number && (!product_name || product_name === 'Recovered Lead')) return null;

        const result = await query(
            `INSERT INTO whatsapp_order_tracking
                (session_name, sender_id, product_name, number, location, product_quantity, price)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [session_name, sender_id, product_name, number, location, product_quantity, price]
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

// 18. Deduct WhatsApp Credit (Shared User Balance)
async function deductWhatsAppCredit(sessionName, amount = 1) {
    const { query } = require('./pgClient');

    const sessionResult = await query(
        'SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1',
        [sessionName]
    );
    if (sessionResult.rows.length === 0 || !sessionResult.rows[0].user_id) {
        console.error(`[WA Credit] Session ${sessionName} not linked to user or not found.`);
        return false;
    }

    const userId = sessionResult.rows[0].user_id;

    const configResult = await query(
        'SELECT message_credit FROM user_configs WHERE user_id = $1 LIMIT 1',
        [userId]
    );
    if (configResult.rows.length === 0) {
        console.error(`[WA Credit] User config not found for ${userId}.`);
        return false;
    }

    const currentCredit = configResult.rows[0].message_credit || 0;
    if (currentCredit < amount) {
        console.warn(`[WA Credit] Insufficient credits for User ${userId}. Balance: ${currentCredit}`);
        return false;
    }

    await query(
        'UPDATE user_configs SET message_credit = $2 WHERE user_id = $1',
        [userId, currentCredit - amount]
    );

    console.log(`[WA Credit] Deducted ${amount} credit from User ${userId}`);
    return true;
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

        // Pre-normalize config emojis
        const normLock = lockEmojis.map(normalize);
        const normUnlock = unlockEmojis.map(normalize);

        for (const msg of result.rows) {
            const rawText = (msg.text || '').trim();
            if (!rawText) continue;

            const normText = normalize(rawText);

            // Check Lock Emojis
            for (const emoji of normLock) {
                if (normText.includes(emoji)) {
                    console.log(`[WA Lock] Found Lock Emoji (Normalized) in message: "${rawText}"`);
                    return { locked: true, timestamp: msg.timestamp };
                }
            }

            // Check Unlock Emojis
            for (const emoji of normUnlock) {
                if (normText.includes(emoji)) {
                    console.log(`[WA Lock] Found Unlock Emoji (Normalized) in message: "${rawText}"`);
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
    try {
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
    } catch (error) {
        console.error("Error saving comment:", error);
    }
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

// 12. Save Order Tracking (Messenger)
async function saveOrderTracking(orderData) {
    let { page_id, sender_id, product_name, number, location, product_quantity, price, sender_number } = orderData;
    
    // Robust Product Name Cleaning
    if (product_name) {
        // Remove internal instruction blocks like Item 1: ... | Price: ... | Image URL: ...
        if (product_name.includes('|')) {
            product_name = product_name.split('|')[0].trim();
        }
        // Remove common AI markers
        product_name = product_name
            .replace(/Item \d+:/gi, '')
            .replace(/##product/gi, '')
            .replace(/"/g, '')
            .replace(/\[.*?\]/g, '') // Remove [SAVE_ORDER] or other tags
            .trim();
        
        // If it's still empty or too long/junk, use a fallback
        if (!product_name) product_name = 'Recovered Lead';
    }

    console.log(`[Order] Attempting to save/update order for ${sender_id}...`);

    try {
        // 1. Try to find a recent order (last 1 hour) for this user to update missing info (Smart Merge)
        const recentOrder = await query(
            `SELECT id, product_name, number, location, product_quantity, price 
             FROM fb_order_tracking 
             WHERE page_id = $1 AND sender_id = $2 
             AND created_at >= NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC LIMIT 1`,
            [page_id, sender_id]
        );

        if (recentOrder.rows.length > 0) {
            const existing = recentOrder.rows[0];
            const updates = [];
            const values = [];
            let idx = 1;

            // SMART MERGE: Only update if the new value is NOT empty and either the existing is missing or generic
            if (product_name && product_name !== 'Recovered Lead' && (!existing.product_name || existing.product_name === 'Recovered Lead')) {
                updates.push(`product_name = $${idx++}`);
                values.push(product_name);
            }
            if (number && !existing.number) {
                updates.push(`number = $${idx++}`);
                values.push(number);
            }
            if (location && location !== 'N/A' && (!existing.location || existing.location === 'N/A' || existing.location === '')) {
                updates.push(`location = $${idx++}`);
                values.push(location);
            }
            if (product_quantity && product_quantity !== '1' && (!existing.product_quantity || existing.product_quantity === '1')) {
                updates.push(`product_quantity = $${idx++}`);
                values.push(product_quantity);
            }
            if (price && !existing.price) {
                updates.push(`price = $${idx++}`);
                values.push(price);
            }

            if (updates.length > 0) {
                values.push(existing.id);
                const updateResult = await query(
                    `UPDATE fb_order_tracking SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
                    values
                );
                console.log(`[Order] Smart Merged data into existing order ID ${existing.id} for user ${sender_id}`);
                return updateResult.rows[0];
            }
            
            // If we have a number but it's DIFFERENT from the existing one, 
            // and the existing one already has a number, we create a NEW row.
            if (number && existing.number && number !== existing.number) {
                console.log(`[Order] New number detected for ${sender_id}. Creating new row.`);
            } else {
                console.log(`[Order] No new info to merge for ${sender_id}. Skipping duplicate.`);
                return existing;
            }
        }

        // 2. If no recent order found or no updates were needed, perform a new INSERT
        // But only if we have at least a number or a product name that isn't just "Recovered Lead"
        if (!number && (!product_name || product_name === 'Recovered Lead')) {
             console.log(`[Order] Skipping insert: No phone number and no specific product found.`);
             return null;
        }

        const result = await query(
            `INSERT INTO fb_order_tracking
                (page_id, sender_id, product_name, number, location, product_quantity, price, sender_number)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
                page_id,
                sender_id,
                product_name,
                number,
                location,
                product_quantity,
                price,
                sender_number
            ]
        );
        const row = result.rows[0];
        console.log(`[Order] New order saved successfully: ID ${row.id}`);
        return row;
    } catch (error) {
        console.error("[Order] Failed to save/update order:", error.message);
        return null;
    }
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
             WHERE subscription_status IN ('active','trial','active_trial','active_paid')`,
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
                 WHERE user_id = ANY($1::text[])`,
                [userIds]
            );
            configsResult.rows.forEach(c => {
                userCredits[c.user_id] = c.message_credit || 0;
            });
        }

        const allowedPageIds = pages
            .filter(p => {
                const status = p.subscription_status;
                const isActive = ['active', 'trial', 'active_trial', 'active_paid'].includes(status);
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
        timestamp: new Date(),
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
        'SELECT balance FROM user_configs WHERE user_id = $1 LIMIT 1',
        [userId]
    );

    if (result.rows.length === 0) {
        throw new Error("User config not found");
    }

    const balance = result.rows[0].balance || 0;
    if (balance < amount) {
        throw new Error("Insufficient balance");
    }

    await query(
        'UPDATE user_configs SET balance = $2 WHERE user_id = $1',
        [userId, balance - amount]
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
async function addApiKey({ provider, api, model = 'default' }) {
    try {
        const result = await query(
            'INSERT INTO api_list (provider, api, model, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [provider, api, model, 'active']
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

async function getApiKeyById(id) {
    try {
        const result = await query('SELECT id, api, provider, status FROM api_list WHERE id = $1 LIMIT 1', [id]);
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] getApiKeyById Error:", error.message);
        return null;
    }
}

async function updateApiKeyRphLimit(id, rphLimit) {
    try {
        const limitValue = Math.max(0, parseInt(rphLimit) || 0);
        const result = await query(
            'UPDATE api_list SET rph_limit = $2 WHERE id = $1 RETURNING id, rph_limit',
            [id, limitValue]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error("[DB] updateApiKeyRphLimit Error:", error.message);
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

module.exports = {
    getAllKeys,
    addApiKey,
    deleteApiKey,
    getApiKeyById,
    updateApiKeyRphLimit,
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

    // --- PRODUCT MANAGEMENT ---
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct,
    searchProducts,
    getProductsByNames,
    checkProductFeatureAccess,

    // --- ADMIN TOOLS ---
    addBalanceByEmail,
    approveDepositTransaction,
    logError
};

// --- PRODUCT MANAGEMENT IMPLEMENTATION ---

// 32. Check Product Feature Access (Unlock Check)
async function checkProductFeatureAccess(userId) {
    const userConfigResult = await query(
        'SELECT message_credit, balance FROM user_configs WHERE user_id = $1 LIMIT 1',
        [userId]
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
         WHERE user_id = $1
           AND expires_at > NOW()`,
        [userId]
    );

    if (waResult.rows.length > 0 && waResult.rows[0].cnt > 0) {
        return true;
    }

    const fbResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM page_access_token_message
         WHERE user_id = $1
           AND subscription_status IN ('active','trial','active_trial','active_paid')`,
        [userId]
    );

    if (fbResult.rows.length > 0 && fbResult.rows[0].cnt > 0) {
        return true;
    }

    return true;
}

// 26. Create Product
async function createProduct(productData) {
    const fields = [
        'user_id',
        'name',
        'description',
        'image_url',
        'additional_images',
        'variants',
        'is_active',
        'price',
        'currency',
        'stock',
        'allowed_page_ids',
        'allowed_wa_sessions',
        'keywords',
        'is_combo',
        'combo_items',
        'allow_description'
    ];

    const values = [];
    const placeholders = [];

    fields.forEach((field, index) => {
        placeholders.push(`$${index + 1}`);
        values.push(
            field === 'variants' || field === 'allowed_page_ids' || field === 'allowed_wa_sessions' || field === 'combo_items' || field === 'additional_images'
                ? (productData[field] || (field === 'additional_images' ? '[]' : '[]'))
                : (productData[field] ?? null)
        );
    });

    const result = await query(
        `INSERT INTO products (${fields.join(',')})
         VALUES (${placeholders.join(',')})
         RETURNING *`,
        values
    );

    return result.rows[0];
}

async function resolvePageContextType(pageId) {
    if (!pageId) return null;
    try {
        const waRes = await query('SELECT 1 FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1', [String(pageId)]);
        if (waRes.rows.length > 0) return 'whatsapp';
    } catch (e) {}
    try {
        const waRes2 = await query('SELECT 1 FROM whatsapp_sessions WHERE session_name = $1 LIMIT 1', [String(pageId)]);
        if (waRes2.rows.length > 0) return 'whatsapp';
    } catch (e) {}
    return 'messenger';
}

async function getProducts(userId, page = 1, limit = 20, searchQuery = null, pageId = null, allowedPageIds = null, strictMode = false) {
    console.log(`[DB] getProducts Called - User: ${userId}, PageID: ${pageId}, AllowedPages: ${JSON.stringify(allowedPageIds)}`);
    const offset = (page - 1) * limit;

    let params = [userId]; // $1 always userId
    let whereClause = 'user_id = $1';

    // 1. Base Filter: Page/Session Context
    if (pageId) {
        const contextType = await resolvePageContextType(pageId);
        const isWhatsapp = contextType === 'whatsapp';
        // Check if user owns this page/session
        let isOwner = false;
        try {
            const fbCheck = await query('SELECT 1 FROM page_access_token_message WHERE page_id = $1 AND user_id = $2', [String(pageId), userId]);
            if (fbCheck.rows.length > 0) isOwner = true;
            else {
                const waCheck = await query('SELECT 1 FROM whatsapp_message_database WHERE session_name = $1 AND user_id = $2', [String(pageId), userId]);
                if (waCheck.rows.length > 0) isOwner = true;
            }
        } catch (e) { console.error("[DB] Owner check failed", e); }

        if (strictMode) {
            params.push(String(pageId));
            const idx = params.length;
            if (isWhatsapp) {
                whereClause += ` AND (allowed_wa_sessions::jsonb @> jsonb_build_array($${idx}::text))`;
            } else {
                whereClause += ` AND (allowed_page_ids::jsonb @> jsonb_build_array($${idx}::text))`;
            }
        }

        if (!isOwner && allowedPageIds && allowedPageIds.length > 0) {
            // TEAM MEMBER RESTRICTED VIEW
            params.push(String(pageId)); // $2
            const perms = allowedPageIds.map(String);
            params.push(perms); // $3
            
            if (isWhatsapp) {
                whereClause += ` AND (
                    (allowed_wa_sessions IS NULL OR allowed_wa_sessions::jsonb = '[]'::jsonb)
                    OR
                    (allowed_wa_sessions::jsonb @> jsonb_build_array($2::text) AND allowed_wa_sessions::jsonb ?| $3::text[] )
                )`;
            } else {
                whereClause += ` AND (
                    (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb)
                    OR
                    (allowed_page_ids::jsonb @> jsonb_build_array($2::text) AND allowed_page_ids::jsonb ?| $3::text[] )
                )`;
            }
        }
    }

    // 2. Global Permission Filter (for Team Members)
    if (allowedPageIds !== null && allowedPageIds.length > 0) {
        const contextType = await resolvePageContextType(pageId);
        const isWhatsapp = contextType === 'whatsapp';
        const perms = allowedPageIds.map(String);
        params.push(perms);
        const pIdx = params.length;
        
        if (isWhatsapp) {
            whereClause += ` AND (
                (allowed_wa_sessions IS NULL OR allowed_wa_sessions::jsonb = '[]'::jsonb)
                OR 
                EXISTS (
                    SELECT 1 
                    FROM jsonb_array_elements_text(COALESCE(allowed_wa_sessions, '[]'::jsonb)) AS elem 
                    WHERE elem = ANY($${pIdx}::text[])
                )
            )`;
        } else {
            whereClause += ` AND (
                (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb)
                OR 
                EXISTS (
                    SELECT 1 
                    FROM jsonb_array_elements_text(COALESCE(allowed_page_ids, '[]'::jsonb)) AS elem 
                    WHERE elem = ANY($${pIdx}::text[])
                )
            )`;
        }
    }

    // 3. Search Filter
    if (searchQuery) {
        params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        const idx1 = params.length - 1;
        const idx2 = params.length;
        whereClause += ` AND (name ILIKE $${idx1} OR description ILIKE $${idx2})`;
    }

    console.log(`[DBDebug] getProducts Final: WHERE ${whereClause} | Params: ${JSON.stringify(params)}`);

    const countResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM products
         WHERE ${whereClause}`,
        params
    );

    const totalCount = countResult.rows.length > 0 ? countResult.rows[0].cnt : 0;
    console.log(`[DB] Found ${totalCount} products for query. WhereClause: ${whereClause} Params: ${JSON.stringify(params)}`);

    const dataResult = await query(
        `SELECT *
         FROM products
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const data = dataResult.rows || [];

    return { data, count: totalCount };
}

// 28. Get Product By ID
async function getProductById(id) {
    const result = await query(
        'SELECT * FROM products WHERE id = $1 LIMIT 1',
        [id]
    );
    
    if (result.rows.length === 0) return null;
    return result.rows[0];
}

// 29. Update Product
async function updateProduct(id, userId, updates) {
    const keys = Object.keys(updates || {});
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
        values.push(updates[key]);
        idx++;
    }

    values.push(userId);
    values.push(id);

    const sql = `
        UPDATE products
        SET ${setFragments.join(', ')}
        WHERE user_id = $${idx} AND id = $${idx + 1}
        RETURNING *`;

    const result = await query(sql, values);

    if (result.rows.length === 0) {
        throw new Error('Product not found or not owned by user');
    }

    return result.rows[0];
}

// 30. Delete Product
async function deleteProduct(id, userId) {
    const result = await query(
        'DELETE FROM products WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
    );

    if (result.rows.length === 0) {
        throw new Error('Product not found or not owned by user');
    }

    return true;
}

// 30.5 Get Products by Exact Names (For System Prompt Injection)
async function getProductsByNames(userId, productNames, pageId = null) {
    if (!productNames || productNames.length === 0) return [];
    
    // Normalize names to lowercase for comparison if needed, 
    // but ILIKE ANY handles case insensitivity.
    
    let sql = `
        SELECT * FROM products 
        WHERE user_id = $1 
        AND is_active = true 
        AND name ILIKE ANY($2)
    `;
    
    const params = [userId, productNames];

    if (pageId) {
        const contextType = await resolvePageContextType(pageId);
        const isWhatsapp = contextType === 'whatsapp';
        params.push(String(pageId));
        if (isWhatsapp) {
            sql += ` AND (allowed_wa_sessions IS NULL OR allowed_wa_sessions::jsonb = '[]'::jsonb OR allowed_wa_sessions::jsonb @> jsonb_build_array($${params.length}::text))`;
        } else {
            sql += ` AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb OR allowed_page_ids::jsonb @> jsonb_build_array($${params.length}::text))`;
        }
    }
    
    try {
        const result = await query(sql, params);
        return result.rows;
    } catch (err) {
        console.warn("[DB] Failed to fetch products by names:", err.message);
        return [];
    }
}

    // 31. Search Products (For AI) - Enhanced with Smart Fallback & Visual Search
async function searchProducts(userId, queryText, pageId = null) {
    console.log(`[DB] searchProducts called for User: ${userId}, Page: ${pageId}, Query: "${queryText}"`);
    try {
        if (!userId) {
            console.warn("[DB] searchProducts aborted: No User ID provided.");
            return [];
        }
        if (!queryText) return [];

        const cleanQuery = queryText.trim();
        if (!cleanQuery) return [];

        const contextType = pageId ? await resolvePageContextType(pageId) : null;
        const isWhatsapp = contextType === 'whatsapp';
        const pageColumn = isWhatsapp ? 'allowed_wa_sessions' : 'allowed_page_ids';

        const normalize = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');

        const computeRelevance = (product) => {
            const qNorm = normalize(cleanQuery);
            const nameNorm = normalize(product.name);
            const descNorm = normalize(product.description);
            const kwNorm = normalize(product.keywords);
            const visualNorm = normalize(product.visual_tags);
            const comboNorm = product.is_combo && Array.isArray(product.combo_items) 
                ? normalize(product.combo_items.join(' ')) 
                : '';

            let score = 0;

            if (nameNorm === qNorm) score += 120;
            if (kwNorm === qNorm) score += 110;
            if (comboNorm && comboNorm.includes(qNorm)) score += 105; // High score for combo item match

            if (nameNorm.includes(qNorm)) score += 80;
            if (kwNorm.includes(qNorm)) score += 70;
            if (qNorm.includes(nameNorm) && nameNorm.length > 0) score += 60;
            if (visualNorm.includes(qNorm)) score += 50;

            const tokens = qNorm.split(/\s+/).filter(Boolean);
            tokens.forEach((t) => {
                if (nameNorm.includes(t)) score += 12;
                else if (kwNorm.includes(t)) score += 10;
                else if (comboNorm && comboNorm.includes(t)) score += 15; // Combo token match is valuable
                else if (descNorm.includes(t)) score += 4;
                else if (visualNorm.includes(t)) score += 8;
            });

            const lenDiff = Math.abs((product.name || '').length - cleanQuery.length);
            score -= Math.min(lenDiff, 10);

            return score;
        };

        // Helper to get base query context (params and where clause)
        const getBaseContext = () => {
            const params = [userId];
            let where = 'user_id = $1 AND is_active = true';

            if (pageId) {
                params.push(String(pageId));
                where += ` AND (${pageColumn} IS NULL OR ${pageColumn}::jsonb = '[]'::jsonb OR ${pageColumn}::jsonb @> jsonb_build_array($${params.length}::text))`;
            }
            return { where, params };
        };

        const ctx0 = getBaseContext();
        const exactNameParams = [...ctx0.params, cleanQuery];
        const exactNameResult = await query(
            `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description
             FROM products
             WHERE ${ctx0.where} AND lower(name) = lower($${exactNameParams.length})
             LIMIT 1`,
            exactNameParams
        );
        if (exactNameResult.rows && exactNameResult.rows.length > 0) {
            return exactNameResult.rows;
        }

        // 1. Exact Match (Now includes visual_tags and combo_items)
        const ctx1 = getBaseContext();
        const pStart1 = ctx1.params.length;
        const exactWhere = `${ctx1.where} AND (name ILIKE $${pStart1 + 1} OR description ILIKE $${pStart1 + 2} OR keywords ILIKE $${pStart1 + 3} OR visual_tags ILIKE $${pStart1 + 4} OR combo_items::text ILIKE $${pStart1 + 5})`;
        ctx1.params.push(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`);

        const exactResult = await query(
            `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description
             FROM products
             WHERE ${exactWhere}
             LIMIT 5`,
            ctx1.params
        );

        const exactData = exactResult.rows || [];

        if (exactData.length > 0) {
            return [...exactData].sort((a, b) => computeRelevance(b) - computeRelevance(a));
        }

        const tokens = cleanQuery.split(/\s+/).filter(w => w.length > 2);
        
        if (tokens.length > 0) {
            // 2. Fuzzy Token Match
            const ctx2 = getBaseContext();
            const conditions = [];
            
            tokens.forEach(token => {
                const idx = ctx2.params.length + 1;
                conditions.push(`name ILIKE $${idx}`);
                ctx2.params.push(`%${token}%`);
                
                conditions.push(`description ILIKE $${idx + 1}`);
                ctx2.params.push(`%${token}%`);
                
                conditions.push(`keywords ILIKE $${idx + 2}`);
                ctx2.params.push(`%${token}%`);
                
                conditions.push(`visual_tags ILIKE $${idx + 3}`);
                ctx2.params.push(`%${token}%`);

                conditions.push(`combo_items::text ILIKE $${idx + 4}`);
                ctx2.params.push(`%${token}%`);
            });

            const cond = conditions.join(' OR ');
            const fuzzyWhere = `${ctx2.where} AND (${cond})`;

            const fuzzyResult = await query(
                `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items, allow_description
                 FROM products
                 WHERE ${fuzzyWhere}
                 LIMIT 5`,
                ctx2.params
            );

            const fuzzyData = fuzzyResult.rows || [];

            if (fuzzyData.length > 0) {
                return [...fuzzyData].sort((a, b) => computeRelevance(b) - computeRelevance(a));
            }

            // 3. Stem Match
            const stems = [];
            tokens.forEach(token => {
                const lower = token.toLowerCase();
                if (lower.length > 4) {
                    const cut = Math.max(3, Math.min(6, Math.floor(lower.length * 0.6)));
                    const stem = lower.slice(0, cut);
                    if (!stems.includes(stem)) stems.push(stem);
                }
            });

            if (stems.length > 0) {
                const ctx3 = getBaseContext();
                const stemConditions = [];
                
                stems.forEach(stem => {
                    const idx = ctx3.params.length + 1;
                    stemConditions.push(`name ILIKE $${idx}`);
                    ctx3.params.push(`%${stem}%`);
                    
                    stemConditions.push(`description ILIKE $${idx + 1}`);
                    ctx3.params.push(`%${stem}%`);
                    
                    stemConditions.push(`keywords ILIKE $${idx + 2}`);
                    ctx3.params.push(`%${stem}%`);
                    
                    stemConditions.push(`visual_tags ILIKE $${idx + 3}`);
                    ctx3.params.push(`%${stem}%`);

                    stemConditions.push(`combo_items::text ILIKE $${idx + 4}`);
                    ctx3.params.push(`%${stem}%`);
                });

                const stemCond = stemConditions.join(' OR ');
                const stemWhere = `${ctx3.where} AND (${stemCond})`;

                const stemResult = await query(
                    `SELECT id, name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items
                 FROM products
                 WHERE ${stemWhere}
                 LIMIT 5`,
                    ctx3.params
                );

                const stemData = stemResult.rows || [];

                if (stemData.length > 0) {
                    return [...stemData].sort((a, b) => computeRelevance(b) - computeRelevance(a));
                }
            }
        }

        // --- 4. Levenshtein Fallback (Super Fuzzy - Token Based) ---
        const baseSql = getBaseContext();
        const scanResult = await query(
            `SELECT name, description, image_url, variants, is_active, price, currency, keywords, visual_tags, is_combo, combo_items
             FROM products
             WHERE ${baseSql.where}
             ORDER BY id DESC
             LIMIT 100`,
            baseSql.params
        );

        const allProducts = scanResult.rows || [];

        if (allProducts.length > 0) {
            const queryTokens = cleanQuery.toLowerCase().split(/\s+/).filter(t => t.length > 2);
            // If query is too short, just return empty
            if (queryTokens.length === 0) return [];

            // Optimized Levenshtein (Memory Efficient & Faster)
            const getDistance = (a, b) => {
                if (a === b) return 0;
                if (a.length === 0) return b.length;
                if (b.length === 0) return a.length;

                // Swap to ensure we use the shorter string for columns (less memory)
                if (a.length > b.length) [a, b] = [b, a];

                let row = new Array(a.length + 1);
                for (let i = 0; i <= a.length; i++) row[i] = i;

                for (let i = 1; i <= b.length; i++) {
                    let prev = i;
                    for (let j = 1; j <= a.length; j++) {
                        let val;
                        if (b.charAt(i - 1) === a.charAt(j - 1)) {
                            val = row[j - 1];
                        } else {
                            val = Math.min(row[j - 1], prev, row[j]) + 1;
                        }
                        row[j - 1] = prev;
                        prev = val;
                    }
                    row[a.length] = prev;
                }
                return row[a.length];
            };

            const scored = allProducts.map(p => {
                const comboItemsStr = (p.is_combo && Array.isArray(p.combo_items)) ? p.combo_items.join(" ") : "";
                const productTokens = (p.name + " " + (p.keywords || "") + " " + comboItemsStr).toLowerCase().split(/[\s,]+/).filter(Boolean);
                
                // Find the best match for ANY query token in the product tokens
                let matchCount = 0;
                let totalScore = 0;

                queryTokens.forEach(qt => {
                    let localMin = 100;
                    productTokens.forEach(pt => {
                        const dist = getDistance(qt, pt);
                        if (dist < localMin) localMin = dist;
                    });
                    
                    // Allow fuzzy match: distance <= 40% of length or absolute 2 chars
                    const threshold = Math.max(2, Math.floor(qt.length * 0.4));
                    
                    if (localMin <= threshold) {
                        matchCount++;
                        // Score is better if distance is lower
                        totalScore += (10 - localMin);
                    }
                });

                return { product: p, score: matchCount > 0 ? (matchCount * 20 + totalScore) : -1 };
            });

            const bestMatches = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
            
            return bestMatches.slice(0, 5).map(s => s.product);
        }
        
    } catch (error) {
        console.error("[DB] searchProducts Error:", error.message);
        return [];
    }
    
    return [];
}
