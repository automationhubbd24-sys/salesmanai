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
      }
    }

    if (!data.credit_source) {
      data.credit_source = 'page_balance';
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
async function saveChatMessage(sessionId, role, content) {
    console.log(`[DB] Saving chat for ${sessionId}: [${role}] ${content.substring(0, 50)}...`);
    try {
        await query(
            `INSERT INTO backend_chat_histories (session_id, message)
             VALUES ($1,$2)`,
            [sessionId, { role, content }]
        );
    } catch (error) {
        console.error("Error saving chat message:", error);
    }
}

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
            (session_name, user_id, email, active, status, reply_message, order_tracking, subscription_status, text_prompt, expires_at, plan_days)
         VALUES ($1,$2,$3,true,$4,true,true,'active',
                 'You are a helpful assistant for this store. Reply in a friendly manner.',
                 $5,$6)
         RETURNING *`,
        [sessionName, userId, userEmail, initialStatus, expiresAt.toISOString(), parseInt(planDays)]
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
        }
    }

    if (data.message_credit === undefined) data.message_credit = 0;

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
    await query(
        `INSERT INTO whatsapp_chats
            (session_name, sender_id, recipient_id, message_id, text, timestamp, status, reply_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (message_id) DO UPDATE SET
            text = EXCLUDED.text,
            timestamp = EXCLUDED.timestamp,
            status = EXCLUDED.status,
            reply_by = EXCLUDED.reply_by`,
        [
            data.session_name,
            data.sender_id,
            data.recipient_id,
            data.message_id,
            data.text,
            data.timestamp,
            data.status,
            data.reply_by
        ]
    );
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
        // Try exact match first in auth.users (Supabase Auth)
        try {
            await client.query('SAVEPOINT auth_lookup');
            const userRes = await client.query('SELECT id FROM auth.users WHERE email = $1', [txn.user_email]);
            if (userRes.rows.length > 0) {
                userId = userRes.rows[0].id;
            }
            await client.query('RELEASE SAVEPOINT auth_lookup');
        } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT auth_lookup');
            console.warn("[ApproveTxn] Failed to query auth.users (permission issue?), falling back to user_configs:", e.message);
        }

        if (!userId) {
            // Fallback 1: Check user_configs if email exists there
            const configRes = await client.query('SELECT user_id FROM user_configs WHERE email = $1', [txn.user_email]);
            if (configRes.rows.length > 0) {
                userId = configRes.rows[0].user_id;
            } else {
                // Fallback 2: Try case-insensitive search in auth.users
                try {
                    await client.query('SAVEPOINT auth_lookup_case');
                    const userResCase = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1)', [txn.user_email]);
                    if (userResCase.rows.length > 0) {
                        userId = userResCase.rows[0].id;
                    }
                    await client.query('RELEASE SAVEPOINT auth_lookup_case');
                } catch (e) {
                    await client.query('ROLLBACK TO SAVEPOINT auth_lookup_case');
                }
            }
        }

        if (!userId) {
            // Last Resort: Check if public.users exists and try there
             try {
                await client.query('SAVEPOINT public_lookup');
                const publicUserRes = await client.query('SELECT id FROM public.users WHERE email = $1', [txn.user_email]);
                if (publicUserRes.rows.length > 0) {
                    userId = publicUserRes.rows[0].id;
                }
                await client.query('RELEASE SAVEPOINT public_lookup');
            } catch (e) {
                await client.query('ROLLBACK TO SAVEPOINT public_lookup');
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
    const { query } = require('./pgClient');
    const { session_name, sender_id, product_name, number, location, product_quantity, price } = orderData;

    const result = await query(
        `INSERT INTO whatsapp_order_tracking
            (session_name, sender_id, product_name, number, location, product_quantity, price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [session_name, sender_id, product_name, number, location, product_quantity, price]
    );

    return result.rows[0];
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
        role: msg.reply_by === 'user' ? 'user' : 'assistant',
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

    const existingResult = await query(
        'SELECT name FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
        [data.session_name, data.phone_number]
    );

    const updates = {
        session_name: data.session_name,
        phone_number: data.phone_number,
        last_interaction: new Date().toISOString()
    };

    if (data.name && data.name !== 'Unknown' && data.name.trim() !== '') {
        updates.name = data.name;
    } else if (existingResult.rows.length === 0) {
        updates.name = 'Unknown';
    }

    const params = [
        updates.session_name,
        updates.phone_number,
        updates.name || null,
        updates.last_interaction
    ];

    await query(
        `INSERT INTO whatsapp_contacts
            (session_name, phone_number, name, last_interaction)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_name, phone_number) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, whatsapp_contacts.name),
            last_interaction = EXCLUDED.last_interaction`,
        params
    );
}

// 20. Toggle WhatsApp Lock (Handover)
async function toggleWhatsAppLock(sessionName, phoneNumber, isLocked) {
    const { query } = require('./pgClient');
    console.log(`[WA Lock] Toggling lock for ${sessionName} - User: ${phoneNumber} -> ${isLocked}`);

    if (!sessionName || !phoneNumber) {
        console.error("[WA Lock] Missing sessionName or phoneNumber");
        return false;
    }

    try {
        await query(
            `INSERT INTO whatsapp_contacts
                (session_name, phone_number, is_locked, name, last_interaction)
             VALUES ($1,$2,$3,'Unknown',$4)
             ON CONFLICT (session_name, phone_number) DO UPDATE SET
                is_locked = EXCLUDED.is_locked,
                last_interaction = EXCLUDED.last_interaction`,
            [sessionName, phoneNumber, isLocked, new Date().toISOString()]
        );
        console.log(`[WA Lock] Upsert successful for ${phoneNumber}`);
        return true;
    } catch (err) {
        console.error(`[WA Lock] Unexpected error: ${err.message}`);
        return false;
    }
}

// 27. Check WhatsApp Emoji Lock (History Scan)
async function checkWhatsAppEmojiLock(sessionName, phoneNumber, lockEmojis, unlockEmojis) {
    const { query } = require('./pgClient');
    try {
        const result = await query(
            `SELECT text, reply_by, timestamp
             FROM whatsapp_chats
             WHERE session_name = $1
               AND recipient_id = $2
               AND reply_by IN ('admin','bot')
             ORDER BY timestamp DESC
             LIMIT 10`,
            [sessionName, phoneNumber]
        );

        if (result.rows.length === 0) return null;

        for (const msg of result.rows) {
            const text = (msg.text || '').trim();
            if (!text) continue;

            for (const emoji of lockEmojis) {
                if (text.includes(emoji)) {
                    console.log(`[WA Lock] Found Lock Emoji '${emoji}' in message: "${text}"`);
                    return { locked: true, timestamp: msg.timestamp };
                }
            }

            for (const emoji of unlockEmojis) {
                if (text.includes(emoji)) {
                    console.log(`[WA Lock] Found Unlock Emoji '${emoji}' in message: "${text}"`);
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
    const result = await query(
        'SELECT * FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
        [sessionName, phoneNumber]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
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
    const { page_id, sender_id, product_name, number, location, product_quantity, price } = orderData;
    
    console.log(`[Order] Attempting to save order for ${sender_id}...`);

    try {
        const result = await query(
            `INSERT INTO fb_order_tracking
                (page_id, sender_id, product_name, number, location, product_quantity, price)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
                page_id,
                sender_id,
                product_name,
                number,
                location,
                product_quantity,
                price
            ]
        );
        const row = result.rows[0];
        console.log(`[Order] Order saved successfully: ID ${row.id}`);
        return row;
    } catch (error) {
        console.error("[Order] Failed to save order:", error.message);
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
        const result = await query(
            'SELECT is_locked FROM whatsapp_contacts WHERE session_name = $1 AND phone_number = $2 LIMIT 1',
            [sessionName, senderId]
        );
        if (result.rows.length > 0) {
            return result.rows[0].is_locked === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking WhatsApp lock status:", error);
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
async function logApiUsage(userId, model, tokens, cost = 0) {
    try {
        await query(
            `INSERT INTO api_usage_stats
                (user_id, model, tokens, cost, created_at)
             VALUES ($1,$2,$3,$4,now())`,
            [userId, model, tokens, cost]
        );
    } catch (error) {
        console.warn("[DB] Failed to log API usage:", error.message);
    }
}

module.exports = {
    logApiUsage,
    getPageConfig,
    getPagePrompts,
    saveLead,
    checkDuplicate,
    deductCredit,
    getChatHistory,
    saveChatMessage,
    saveFbChat,
    getFbChatHistory,
    checkN8nDebounce,
    saveFbComment,
    logMessage,
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
    approveDepositTransaction
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
        'variants',
        'is_active',
        'price',
        'currency',
        'stock',
        'allowed_page_ids',
        'keywords'
    ];

    const values = [];
    const placeholders = [];

    fields.forEach((field, index) => {
        placeholders.push(`$${index + 1}`);
        values.push(
            field === 'variants' || field === 'allowed_page_ids'
                ? (productData[field] || null)
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

async function getProducts(userId, page = 1, limit = 20, searchQuery = null, pageId = null) {
    const offset = (page - 1) * limit;

    const params = [userId];
    let whereClause = 'user_id = $1';

    if (searchQuery) {
        params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        whereClause += ` AND (name ILIKE $2 OR description ILIKE $3)`;
    }

    const countResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM products
         WHERE ${whereClause}`,
        params
    );

    const totalCount = countResult.rows.length > 0 ? countResult.rows[0].cnt : 0;

    const dataResult = await query(
        `SELECT *
         FROM products
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
    );

    const data = dataResult.rows || [];

    if (!pageId) {
        return { data, count: totalCount };
    }

    const pid = String(pageId);
    const filtered = data.filter((p) => {
        const arr = Array.isArray(p.allowed_page_ids) ? p.allowed_page_ids.map((v) => String(v)) : null;
        if (!arr || arr.length === 0) return true;
        return arr.includes(pid);
    });

    return { data: filtered, count: filtered.length };
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
async function getProductsByNames(userId, productNames) {
    if (!productNames || productNames.length === 0) return [];
    
    // Normalize names to lowercase for comparison if needed, 
    // but ILIKE ANY handles case insensitivity.
    
    const sql = `
        SELECT * FROM products 
        WHERE user_id = $1 
        AND is_active = true 
        AND name ILIKE ANY($2)
    `;
    
    try {
        const result = await query(sql, [userId, productNames]);
        return result.rows;
    } catch (err) {
        console.warn("[DB] Failed to fetch products by names:", err.message);
        return [];
    }
}

    // 31. Search Products (For AI) - Enhanced with Smart Fallback
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

        const normalize = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');

        const computeRelevance = (product) => {
            const qNorm = normalize(cleanQuery);
            const nameNorm = normalize(product.name);
            const descNorm = normalize(product.description);
            const kwNorm = normalize(product.keywords);

            let score = 0;

            if (nameNorm === qNorm) score += 120;
            if (kwNorm === qNorm) score += 110;

            if (nameNorm.includes(qNorm)) score += 80;
            if (kwNorm.includes(qNorm)) score += 70;
            if (qNorm.includes(nameNorm) && nameNorm.length > 0) score += 60;

            const tokens = qNorm.split(/\s+/).filter(Boolean);
            tokens.forEach((t) => {
                if (nameNorm.includes(t)) score += 12;
                else if (kwNorm.includes(t)) score += 10;
                else if (descNorm.includes(t)) score += 4;
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
                where += ` AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb OR allowed_page_ids::jsonb @> jsonb_build_array($${params.length}::text))`;
            }
            return { where, params };
        };

        // 1. Exact Match
        const ctx1 = getBaseContext();
        const pStart1 = ctx1.params.length;
        const exactWhere = `${ctx1.where} AND (name ILIKE $${pStart1 + 1} OR description ILIKE $${pStart1 + 2} OR keywords ILIKE $${pStart1 + 3})`;
        ctx1.params.push(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`);

        const exactResult = await query(
            `SELECT name, description, image_url, variants, is_active, price, currency, keywords
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
            });

            const cond = conditions.join(' OR ');
            const fuzzyWhere = `${ctx2.where} AND (${cond})`;

            const fuzzyResult = await query(
                `SELECT name, description, image_url, variants, is_active, price, currency, keywords
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
                });

                const stemCond = stemConditions.join(' OR ');
                const stemWhere = `${ctx3.where} AND (${stemCond})`;

                const stemResult = await query(
                    `SELECT name, description, image_url, variants, is_active, price, currency, keywords
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
            `SELECT name, description, image_url, variants, is_active, price, currency, keywords
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
                const productTokens = (p.name + " " + (p.keywords || "")).toLowerCase().split(/[\s,]+/).filter(Boolean);
                
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
