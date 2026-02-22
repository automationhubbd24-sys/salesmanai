const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const dbService = require('../services/dbService');
const fs = require('fs');
const path = require('path');

function logDebug(msg) {
    try {
        const logDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        fs.appendFileSync(path.join(logDir, 'whatsapp.log'), new Date().toISOString() + ' [WA] ' + msg + '\n');
    } catch (e) {
        console.error("Failed to write debug log:", e);
    }
}

// Helper to log to file
function logToFile(message) {
    logDebug(message);
}

// Global Debounce Map (In-Memory)
// Key: sessionId (session_chatId)
const debounceMap = new Map();
// Last user message guard (avoid reprocessing identical short texts)
const lastUserMessageMap = new Map();
// Admin handover map (stop AI after admin label or intervention)
const handoverMap = new Map();
// Session Start Time Map (for n8n-style backlog filtering)
const sessionStartTimeMap = new Map();
// In-memory duplicate check (faster than DB)
const recentMessageIds = new Set();
// Bot Message IDs (to distinguish Bot vs Admin replies)
const botMessageIds = new Set();
// Recent Bot Replies (Text-based Echo Guard)
// Key: recipientId, Value: Array of { text, timestamp }
const recentBotReplies = new Map();

// --- MEMORY GARBAGE COLLECTOR (Safety for 100+ Users) ---
// Runs every 5 minutes to clean stale data and prevent memory leaks.
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    // 1. Clean recentBotReplies (Older than 3 mins)
    for (const [key, replies] of recentBotReplies.entries()) {
        // Filter out old replies
        const validReplies = replies.filter(r => now - r.timestamp < 3 * 60 * 1000);
        if (validReplies.length === 0) {
            recentBotReplies.delete(key);
            cleaned++;
        } else if (validReplies.length !== replies.length) {
            recentBotReplies.set(key, validReplies);
        }
    }

    // 2. Clean handoverMap (Expired entries)
    for (const [key, expiry] of handoverMap.entries()) {
        if (now > expiry) {
            handoverMap.delete(key);
            cleaned++;
        }
    }

    // 3. Clean debounceMap (Stuck entries > 5 mins)
    for (const [key, val] of debounceMap.entries()) {
         // debounceMap stores { timer, resolve }
         // We can't easily check age unless we stored it. 
         // Assuming standard flow clears it. If not, it's a small object.
    }

    if (cleaned > 0) {
        console.log(`[WA GC] Cleaned ${cleaned} stale memory entries.`);
    }
}, 5 * 60 * 1000); // 5 Minutes Interval

// Helper to normalize text for comparison
const normalizeText = (text) => {
    // Remove all whitespace and special characters to ensure robust matching
    // Update: Support Unicode (Bengali) by using unicode property escapes
    // Removes whitespace and punctuation, BUT KEEPS SYMBOLS/EMOJIS to prevent "🌸" becoming ""
    return (text || '').toLowerCase().replace(/[\s\p{P}]/gu, '');
};

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    logDebug("Webhook Hit!");
    const body = req.body;
    // console.log('WAHA Webhook:', JSON.stringify(body, null, 2));

    // WAHA sends different events. We care about 'message' or 'message.any'
    const event = body.event;
    const session = body.session; // This acts as 'session_name'
    const payload = body.payload;

    if (!session || !payload) {
        return res.sendStatus(400);
    }

    // --- AUTO-REGISTER SESSION (If Missing) ---
    // Fix for "Unknown Session" causing bot failure.
    // If a session connects via WAHA but isn't in our DB, auto-create it.
    try {
        // We use a lightweight check first to avoid heavy DB hits on every message?
        // Actually, getWhatsAppConfig is cached or fast enough.
        // But to be safe, we can check if it's in our local sessionStartTimeMap (implies we know it?)
        // No, sessionStartTimeMap is just runtime.
        
        // We will check DB. If this adds too much latency, we can optimize later (e.g. cache known sessions).
        // For now, robustness is priority.
        const existingConfig = await dbService.getWhatsAppConfig(session);
        if (!existingConfig) {
            console.log(`[WA] Session '${session}' detected but missing in DB. Auto-registering...`);
            // Create with NULL user_id (Orphaned). Admin must claim it or we assign to default.
            // Status: 'connected' (since we are receiving webhooks)
            await dbService.createWhatsAppEntry(session, null, 30, 'connected');
            console.log(`[WA] Session '${session}' auto-registered successfully.`);
        }
    } catch (e) {
        console.error(`[WA] Session Auto-Registration Failed: ${e.message}`);
        // We continue processing, but AI might fail later due to missing config.
    }

    // NORMALIZE MESSAGE ID (Critical for Upsert & Duplicate Check)
    // WAHA sometimes returns id as object { fromMe: ..., remote: ..., id: ..., _serialized: ... }
    // We ALWAYS want the string version (_serialized)
    let messageIdRaw = payload.id;
    if (typeof messageIdRaw === 'object' && messageIdRaw !== null) {
        messageIdRaw = messageIdRaw._serialized || messageIdRaw.id; // Fallback
    }
    
    // [DEBUG] Log fromMe status and sender details for "Bot vs User" debugging
    const senderIdDebug = payload.from;
    console.log(`[WA Debug] Message ${messageIdRaw} | From: ${senderIdDebug} | FromMe: ${payload.fromMe} | Body: "${(payload.body || '').substring(0, 20)}..."`);
    // Update payload.id to be the string version for downstream consistency
    if (payload.id && typeof payload.id === 'object') {
        payload.id = messageIdRaw;
    }

    // Acknowledge immediately
    res.send('OK');

    if (event === 'message' || event === 'message.any') {
        // --- n8n-style Backlog Filtering ---
        // 1. Establish Baseline (Processing Start Time) for this session
        if (!sessionStartTimeMap.has(session)) {
            // Check for x-webhook-timestamp header (if available from WAHA/Reverse Proxy)
            // Otherwise default to current server time
            const headerTime = req.headers['x-webhook-timestamp'];
            const startTime = headerTime ? Math.floor(Number(headerTime) / 1000) : Math.floor(Date.now() / 1000);
            sessionStartTimeMap.set(session, startTime);
            console.log(`[WA] Session ${session} connected. Baseline Time: ${startTime}`);
        }

        const msgTimestamp = payload.timestamp || Math.floor(Date.now() / 1000);
        const baselineTime = sessionStartTimeMap.get(session);

        // 2. Filter Backlog Messages (Sent BEFORE we started processing)
        // User Instruction: "sender realtime message korle setar ans jak"
        // Allow 2 minutes (120s) tolerance for "realtime" definition
        if (msgTimestamp < (baselineTime - 120)) {
            console.log(`[WA] Ignoring BACKLOG message from ${payload.from}. MsgTime: ${msgTimestamp}, Baseline: ${baselineTime}`);
            return;
        }
        // -----------------------------------

    // --- IGNORE @lid (Linked Devices / Internal) ---
    // User Update: Removed per user instruction "eta wpp r number system".
    // Previously blocked 124532744531973@lid, but user says this blocks legitimate replies.
    // if (payload.from && payload.from.includes('@lid')) {
    //    console.log(`[WA] Ignoring @lid message (Internal/Linked Device): ${payload.from}`);
    //    return;
    // }
    // -----------------------------------------------

    // --- HANDLE ADMIN/BOT MESSAGES (fromMe) ---
        if (payload.fromMe) {
            // Check if this is a BOT message we just sent (ID Match)
            // Uses Normalized ID
            // [DEBUG] Log IDs to debug the mismatch issue
            console.log(`[WA Debug] Checking fromMe ID: ${messageIdRaw}. BotIDs count: ${botMessageIds.size}`);

            // 1. Strict ID Match (Fastest)
            if (botMessageIds.has(messageIdRaw)) {
                console.log(`[WA] Ignoring fromMe message (BotID Match): ${messageIdRaw}`);
                botMessageIds.delete(messageIdRaw);
                return;
            }

            // 2. Text-Based Echo Guard (In-Memory)
            const recipient = payload.to || payload.from;
            
            if (!recipient) {
                 console.log('[WA] Skipping Echo Guard: No recipient/sender info found.');
                 return;
            }
            
            // Check keys with and without suffix to handle WAHA format variations
            const keysToCheck = [recipient];
            if (recipient.includes('@')) keysToCheck.push(recipient.split('@')[0]);
            
            let recentReplies = [];
            for (const k of keysToCheck) {
                const found = recentBotReplies.get(k);
                if (found && Array.isArray(found)) {
                    recentReplies = found;
                    break;
                }
            }

            if (recentReplies && recentReplies.length > 0) {
                const incomingText = (payload.body || '').trim();
                const normalizedIncoming = normalizeText(incomingText);
                
                // Check against ALL recent replies in the window
                const match = recentReplies.find(reply => {
                    const timeDiff = Date.now() - reply.timestamp;
                    if (timeDiff >= 20000) return false; // 20s Window (Increased)
                    
                    const normalizedStored = reply.text;
                    // Robust Check: Exact, Includes, or 80% Similarity
                    // If normalized text is empty (e.g. all symbols), fall back to raw length check or loose match
                    if (!normalizedIncoming && !normalizedStored) return true; // Both empty -> Match
                    
                    return normalizedIncoming === normalizedStored || 
                           (normalizedIncoming.length > 5 && normalizedIncoming.includes(normalizedStored)) || 
                           (normalizedStored.length > 5 && normalizedStored.includes(normalizedIncoming));
                });

                if (match) {
                    console.log(`[WA] Ignoring fromMe message (Text Match): "${incomingText.substring(0,30)}..."`);
                    return;
                }
            }

                // 4. TERTIARY CHECK: DB-Based Echo Guard (1.5s Wait + 20 Msg Check)
                // User Instruction: Wait 1.5s (Reduced from 3s), then check last 20 messages in DB
                const targetRecipient = payload.to;
                const targetBody = normalizeText(payload.body);
                
                // Wait 1.5 seconds to ensure any concurrent bot reply is saved to DB via its own flow
                await new Promise(resolve => setTimeout(resolve, 1500));

                try {
                    // Fetch last 20 messages from DB
                    const lastMessages = await dbService.getLastNWhatsAppMessages(session, targetRecipient, 20);
                    
                    // Check if ANY of them match our current message AND were sent by 'bot'
                    const isEcho = lastMessages.some(msg => {
                        if (msg.reply_by !== 'bot') return false;
                        const dbBody = normalizeText(msg.text);
                        // Debug log for potential mismatches
                        // console.log(`[WA Echo Debug] DB: ${dbBody} vs Incoming: ${targetBody}`);
                        return dbBody === targetBody;
                    });

                    if (isEcho) {
                        console.log(`[WA] Ignoring fromMe message (DB Echo Match): "${targetBody.substring(0, 30)}..."`);
                        return;
                    } else {
                        console.log(`[WA Debug] Echo Check Failed. Incoming: "${targetBody}". Last 5 DB: ${lastMessages.slice(0, 5).map(m => m.reply_by + ':' + normalizeText(m.text)).join(' | ')}`);
                    }
                } catch (err) {
                    console.warn(`[WA] DB Echo check failed: ${err.message}`);
                }

                // 5. Fallback: If still not identified as bot, assume Admin
                
                const messageText = payload.body || '';
                const sessionName = session;
                
                // In-memory duplicate check
                if (recentMessageIds.has(messageIdRaw)) return;
                recentMessageIds.add(messageIdRaw);
                setTimeout(() => recentMessageIds.delete(messageIdRaw), 10 * 60 * 1000); // Clear after 10 mins

                const isDuplicate = await dbService.checkWhatsAppDuplicate(messageIdRaw);
                if (!isDuplicate) {
                    // Prevent saving empty messages (avoids blank rows in UI)
                    // Check for Reactions, Protocol messages, etc.
                    const msgType = payload.type || payload.subtype || 'chat';
                    if (['reaction', 'e2e_notification', 'protocol', 'ciphertext', 'revoked'].includes(msgType)) {
                        console.log(`[WA] Ignoring Admin message of type: ${msgType}`);
                        return;
                    }

                    const hasText = messageText && messageText.trim().length > 0;
                    const hasMedia = payload.hasMedia || (payload.media && Object.keys(payload.media).length > 0) || (payload._data && (payload._data.jpegThumbnail || payload._data.thumbnail));

                    if (!hasText && !hasMedia) {
                        console.log('[WA] Ignoring empty Admin message (no text/media).');
                        return;
                    }
                    
                    const textToSave = messageText.trim() || '[Media Sent]';

                    // --- NOTE TO SELF CHECK (Testing Mode) ---
                    // Improved extraction for robustness
                    const senderNum = (payload.from || '').split('@')[0];
                    let recipientNum = (payload.to || '').split('@')[0];
                    
                    // Fallback for recipient if payload.to is missing (happens in some WAHA versions)
                    if (!recipientNum && payload._data && payload._data.to) {
                         recipientNum = (payload._data.to.remote || payload._data.to || '').split('@')[0];
                    }

                    const isNoteToSelf = senderNum && recipientNum && senderNum === recipientNum;

                    // [DEBUG] Log Note-to-Self Check details
                    if (payload.fromMe) {
                        console.log(`[WA Debug] Note-to-Self Check: Sender=${senderNum}, Recipient=${recipientNum}, Match=${isNoteToSelf}`);
                    }

                    if (isNoteToSelf) {
                         console.log(`[WA] Note-to-Self Detected (${senderNum}). Treating as User Message.`);
                         console.log(`[WA Debug] Note-to-Self: Skipping Admin Logic. Proceeding to Queue.`);
                    } else {
                    
                    // --- ECHO GUARD START (Prevent Bot Replies from being saved as Admin) ---
                    // Check if this "Admin" message is actually a Bot Echo
                    // Uses 'recentBotReplies' populated in processAI
                    const recentReplies = recentBotReplies.get(payload.to);
                    if (recentReplies && Array.isArray(recentReplies)) {
                         const incomingText = normalizeText(textToSave); // Uses Global normalizeText
                         
                         const match = recentReplies.find(reply => {
                             const timeDiff = Date.now() - reply.timestamp;
                             if (timeDiff >= 10000) return false; // Check last 10s
                             
                             const sentText = reply.text; // already normalized
                             return incomingText === sentText;
                         });

                         if (match) {
                             console.log(`[WA] Ignoring Bot Echo (fromMe=true): "${(textToSave || '').substring(0,30)}..."`);
                             return; // SKIP SAVING & HANDOVER
                         }
                    }
                    // --- ECHO GUARD END ---

                    console.log(`[WA] Admin Message Detected: "${textToSave}"`);
                    
                    // RE-ENABLED PER USER INSTRUCTION (Duplicate Fix: Check DB first?)
                    // For now, we enable it because the lock logic and history depend on it.
                    // To avoid duplicates, we rely on the fact that this is 'fromMe' handling
                    // and 'bot' messages are handled separately or filtered by ID.
                    
                    try {
                        await dbService.saveWhatsAppChat({
                            session_name: sessionName,
                            sender_id: sessionName, // Admin is the sender (Session Name/Page Number)
                            recipient_id: payload.to, // User is the recipient
                            message_id: messageIdRaw,
                            text: textToSave,
                            timestamp: Date.now(),
                            status: 'sent',
                            reply_by: 'admin' // Trigger stop logic
                        });
                        console.log(`[WA] Saved Admin Message: ${messageIdRaw}`);
                    } catch (e) {
                        console.error(`[WA] Failed to save Admin Message: ${e.message}`);
                    }

                    // --- EMOJI HANDOVER LOGIC (Admin) ---
                    // Fetch Config for Dynamic Emojis
                    let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
                    let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];
                    
                    try {
                        const config = await dbService.getWhatsAppConfig(sessionName);
                        if (config) {
                            // Support both Messenger-style (single emoji) and List-style (comma separated)
                            const locks = [];
                            const unlocks = [];

                            // 1. Messenger Style (block_emoji / unblock_emoji)
                            if (config.block_emoji) locks.push(config.block_emoji);
                            if (config.unblock_emoji) unlocks.push(config.unblock_emoji);

                            // 2. List Style (lock_emojis / unlock_emojis)
                            if (config.lock_emojis && config.lock_emojis.trim()) {
                                locks.push(...config.lock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e));
                            }
                            if (config.unlock_emojis && config.unlock_emojis.trim()) {
                                unlocks.push(...config.unlock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e));
                            }

                            // Update if we found any
                            if (locks.length > 0) LOCK_EMOJIS = locks;
                            if (unlocks.length > 0) UNLOCK_EMOJIS = unlocks;
                        }
                        console.log(`[WA Handover] Config Loaded. Lock: ${LOCK_EMOJIS.join('|')}, Unlock: ${UNLOCK_EMOJIS.join('|')}`);
                    } catch (e) {
                        console.warn(`[WA] Failed to fetch config for emoji check: ${e.message}`);
                    }
                    
                    // Helper to strip variation selectors (VS16) and normalize
                    // Renamed to avoid shadowing Global normalizeText
                    const normalizeEmojiText = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');

                    let command = null;
                    // Check if textToSave contains any of the emojis
                    // Use standard includes, but debug what we are checking
                    console.log(`[WA Handover] Checking text: "${textToSave}"`);
                    
                    const cleanText = normalizeEmojiText(textToSave);

                    for (const e of LOCK_EMOJIS) {
                        if (cleanText.includes(normalizeEmojiText(e))) {
                            command = 'LOCK';
                            console.log(`[WA Handover] Matched Lock Emoji: ${e}`);
                            break;
                        }
                    }
                    if (!command) {
                        for (const e of UNLOCK_EMOJIS) {
                            if (cleanText.includes(normalizeEmojiText(e))) {
                                command = 'UNLOCK';
                                console.log(`[WA Handover] Matched Unlock Emoji: ${e}`);
                                break;
                            }
                        }
                    }
                    
                    if (command) {
                        const isLocked = command === 'LOCK';
                        console.log(`[WA] Emoji Command Detected (${command}) from Admin. Updating Lock Status...`);
                        
                        // Use payload.to (User's Phone Number) for the lock
                        const targetUser = payload.to; 
                        await dbService.toggleWhatsAppLock(sessionName, targetUser, isLocked);
                        
                        // Update Memory Map
                        const chatKey = `${sessionName}_${targetUser}`;
                        if (isLocked) {
                            handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000); // 24h Lock
                        } else {
                            handoverMap.delete(chatKey);
                        }
                    } else {
                        // Default Handover (5 mins) if no command
                        const chatKey = `${sessionName}_${payload.to || payload.chatId || 'unknown'}`;
                        handoverMap.set(chatKey, Date.now() + 5 * 60 * 1000);
                    }
                }
                return; // STOP Processing
            } // End else
        }

        // Ignore Status Updates (broadcasts)
        if (payload.from === 'status@broadcast') return;

        // --- TIMESTAMP CHECK (Ignore Old Messages > 2 Mins) ---
        // Keeps the "Realtime" sanity check even if baseline was set long ago
        const nowSeconds = Math.floor(Date.now() / 1000);
        const ageSeconds = nowSeconds - msgTimestamp;
        
        if (ageSeconds > 120) { // 2 Minutes Tolerance
            console.log(`[WA] Ignoring old message from ${payload.from}. Age: ${ageSeconds}s`);
            return;
        }
        // -----------------------------------------------------

        // --- FAILSAFE ECHO GUARD (Even if fromMe is false) ---
        // Checks if we just sent this exact text to this user.
        // Solves "Infinite Loop" if WAHA echoes bot messages as incoming user messages.
        const sender = payload.from;
        const recentReplies = recentBotReplies.get(sender);
        
        if (recentReplies && Array.isArray(recentReplies)) {
             const incomingText = normalizeText(payload.body || '');
             
             // Check against ALL recent replies
             const match = recentReplies.find(reply => {
                 const timeDiff = Date.now() - reply.timestamp;
                 if (timeDiff >= 20000) return false;
                 
                 const sentText = reply.text;
                 return incomingText && sentText && (incomingText === sentText || incomingText.includes(sentText) || sentText.includes(incomingText));
             });

             if (match) {
                 console.log(`[WA] Ignoring INCOMING message (Failsafe Echo Match): "${(payload.body || '').substring(0,30)}..." from ${sender}`);
                 return;
             }
        }

        await queueMessage(session, payload);
    } else if (event === 'state.change') {
        // Handle State Changes (WORKING, STOPPED, SCAN_QR_CODE, etc.)
        const status = payload.body || payload.status; // WAHA payload format varies
        console.log(`[WA Webhook] State Change for ${session}: ${status}`);
        
        let dbStatus = 'unknown';
        let isActive = false;

        // Map WAHA statuses to DB statuses (Consistency with IntegrationPage.tsx)
        if (status === 'WORKING' || status === 'CONNECTED') {
            dbStatus = 'WORKING';
            isActive = true;
        } else if (status === 'STOPPED') {
            dbStatus = 'STOPPED';
            isActive = false;
        } else if (status === 'SCAN_QR_CODE' || status === 'SCAN_QR') {
            dbStatus = 'scanned'; // Use 'scanned' to indicate QR is ready/needed
            isActive = false;
        } else if (status === 'STARTING') {
            dbStatus = 'STARTING';
            isActive = false;
        } else {
            dbStatus = (status || 'unknown');
        }

        try {
            await dbService.updateWhatsAppEntryByName(session, {
                status: dbStatus,
                active: isActive
            });
            console.log(`[WA Webhook] DB Updated for ${session} -> Status: ${dbStatus}, Active: ${isActive}`);
        } catch (err) {
            console.error(`[WA Webhook] Failed to update DB status for ${session}:`, err.message);
        }
    } else if (event && String(event).toLowerCase().includes('label')) {
        // Admin updated labels in WAHA UI -> treat as human handover
        console.log(`[WA Debug] Label Event Detected: ${event}. Payload: ${JSON.stringify(payload || {})}`);
        
        // --- SMART LABEL HANDLING ---
        // User Requirement: "Off er dorkar nai jodi lebel na pai se create korbe auto"
        // Interpretation: Don't disable the handler. If label is missing (unknown), maybe create it?
        // Logic: 
        // 1. Identify the label from payload.
        // 2. If it's a known "Stop" label (admin, stop, human), PAUSE AI.
        // 3. If it's unknown/new, Log it (or create in DB if we tracked labels), but DO NOT PAUSE AI blindly.
        
        const sessionName = session;
        const chatId = payload?.chatId || payload?.to || payload?.id; // WAHA payload varies
        
        // Extract Label Data (Best Effort)
        // Payload might be { id: "...", labelId: "123", labelName: "Human" } or similar
        const labelName = payload.labelName || payload.label?.name || payload.body || "Unknown Label";
        
        // Check if this label implies STOP
        const hardcodedStops = ['adminhandle', 'admincall', 'stop', 'human', 'manual'];
        const isStopLabel = hardcodedStops.some(s => labelName.toLowerCase().includes(s));
        
        if (isStopLabel) {
            console.log(`[WA] Blocking Label Detected (${labelName}). Pausing AI.`);
            const chatKey = `${sessionName}_${chatId}`;
            handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // 1 Hour
            
            // Log System Message
            try {
                await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: sessionName,
                    recipient_id: chatId || 'unknown',
                    message_id: `label_${Date.now()}`,
                    text: `[SYSTEM] Admin applied label '${labelName}'. AI paused.`,
                    timestamp: Date.now(),
                    status: 'system_notice',
                    reply_by: 'admin'
                });
            } catch (e) {}
        } else {
             console.log(`[WA] Non-blocking Label Detected (${labelName}). AI continues.`);
             // Ensure label exists? (User said "create auto")
             // Since we don't maintain a strict "Labels Table" in our DB (we fetch dynamically),
             // "Create Auto" might mean ensuring it's applied in WAHA? 
             // But this is an event FROM WAHA, so it already exists there.
             // We'll just assume "Create Auto" meant "Handle it automatically without breaking".
        }
    }
};

// Queue Message for Debounce
async function queueMessage(session, messagePayload) {
    let senderId = messagePayload.from; // e.g., 12345678@c.us
    let messageText = messagePayload.body || '';

    // Fix for Linked Devices (@lid)
    // User Update: Do NOT convert @lid to @c.us. Use as is.
    if (senderId && senderId.includes('@lid')) {
        console.log(`[WA] Processing message from Linked Device (@lid): ${senderId}`);

        // --- NOTE TO SELF CHECK (LID) ---
        // If testing from LID to Self, treat as User Message
        const sNum = (senderId || '').split('@')[0];
        const rNum = (messagePayload.to || '').split('@')[0];
        if (sNum && rNum && sNum === rNum) {
             console.log(`[WA] Note-to-Self from LID Detected (${sNum}). Treating as User Message.`);
             // Allow fall-through to normal processing
        } else {
        
        // --- LID ADMIN GUARD (Emoji & Lock Logic) ---
        // Handles case where WAHA reports fromMe=false for Linked Devices
        const msgBody = (messageText || '').trim();
        
        // 1. Fetch Dynamic Config for Emojis
        let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
        let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];
        
        try {
            // Use sessionName (which is passed as 'session' arg)
            const config = await dbService.getWhatsAppConfig(session);
            if (config) {
                 // Support both Messenger-style (single emoji) and List-style (comma separated)
                 const locks = [];
                 const unlocks = [];

                 // 1. Messenger Style (block_emoji / unblock_emoji)
                 if (config.block_emoji) locks.push(config.block_emoji);
                 if (config.unblock_emoji) unlocks.push(config.unblock_emoji);

                 // 2. List Style (lock_emojis / unlock_emojis)
                 if (config.lock_emojis && config.lock_emojis.trim()) {
                     locks.push(...config.lock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e));
                 }
                 if (config.unlock_emojis && config.unlock_emojis.trim()) {
                     unlocks.push(...config.unlock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e));
                 }

                 // Update if we found any
                 if (locks.length > 0) LOCK_EMOJIS = locks;
                 if (unlocks.length > 0) UNLOCK_EMOJIS = unlocks;
            }
        } catch (e) {
            console.warn(`[WA LID] Failed to fetch config for emoji check: ${e.message}`);
        }

        // Helper to strip variation selectors (VS16) and normalize
        const normalizeEmojiText = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');
        const cleanBody = normalizeEmojiText(msgBody);

        let command = null;
        for (const e of LOCK_EMOJIS) {
            if (cleanBody.includes(normalizeEmojiText(e))) {
                command = 'LOCK';
                break;
            }
        }
        if (!command) {
            for (const e of UNLOCK_EMOJIS) {
                if (cleanBody.includes(normalizeEmojiText(e))) {
                    command = 'UNLOCK';
                    break;
                }
            }
        }
        
        if (command) {
             const isLock = command === 'LOCK';
             console.log(`[WA] LID Admin Command Detected: ${command} from ${senderId}`);
             
             // Target is the Recipient (User)
             // CAUTION: messagePayload.to might be the LID itself or the group. 
             // For 1-on-1, 'to' is usually the user if 'from' is LID (wait, if 'from' is LID, 'to' is me? No.)
             // If I send FROM my phone (LID), 'from' is LID. 'to' is the USER.
             // If Note-to-Self, 'to' is ME. But we handled that above.
             const lockTarget = messagePayload.to; 
             
             if (lockTarget && !lockTarget.includes('@lid')) { 
                 try {
                     await dbService.toggleWhatsAppLock(session, lockTarget, isLock);
                     const ck = `${session}_${lockTarget}`;
                     if (isLock) handoverMap.set(ck, Date.now() + 24 * 60 * 60 * 1000);
                     else handoverMap.delete(ck);
                     console.log(`[WA] Lock Status Updated for ${lockTarget}`);
                     
                     // Save this "Admin" action to DB
                     await dbService.saveWhatsAppChat({
                        session_name: session,
                        sender_id: session, // Treat as Admin/Page
                        recipient_id: lockTarget,
                        message_id: messagePayload.id || `lid_${Date.now()}`,
                        text: msgBody,
                        timestamp: Date.now(),
                        status: 'sent',
                        reply_by: 'admin'
                    });

                 } catch (e) {
                     console.error(`[WA] Failed to toggle lock for LID command: ${e.message}`);
                 }
             }
             return; // STOP Processing (Don't Queue)
        }
        
        // 2. Check for Emoji-Only Reaction (e.g. Thumbs Up)
        // Regex for string containing ONLY emojis and whitespace (Includes Extended Pictographics)
        const emojiRegex = /^[\p{Emoji}\p{Extended_Pictographic}\s]+$/u;
        if (emojiRegex.test(msgBody)) {
             console.log(`[WA] Ignoring LID Emoji Reaction: "${msgBody}" from ${senderId}`);
             return; // STOP Processing
        }

        // 3. NORMAL ADMIN CHAT from LID (No Command, Not Reaction)
        
        // CHECK: Is this Note-to-Self / Incoming?
        // If fromMe=false, it means Admin sent message TO the Bot (Note-to-Self/Test).
        // We should treat this as a USER message so the bot replies.
        if (!messagePayload.fromMe) {
             console.log(`[WA] LID Message (Incoming/Note-to-Self): "${msgBody}". Treating as USER Message (Allowing Reply).`);
             // Allow fall-through to User Logic (Do NOT return)
        } else {
            // fromMe=true (Outgoing / Sync)
             // MUST SAVE AS ADMIN MESSAGE to prevent Bot Reply Loop
             console.log(`[WA] LID Message (Normal Admin Chat): "${msgBody}" from ${senderId}`);
             try {
                  await dbService.saveWhatsAppChat({
                     session_name: session,
                     sender_id: senderId, // User Request: Use actual Sender ID (LID) instead of Session Name
                     recipient_id: messagePayload.to,
                     message_id: messagePayload.id || `lid_${Date.now()}`,
                     text: msgBody,
                     timestamp: Date.now(),
                     status: 'sent',
                     reply_by: 'admin'
                 });
            } catch (e) {
                console.error(`[WA] Failed to save LID Admin message: ${e.message}`);
            }
            return; // STOP Processing (Crucial: Don't let it fall through to User Logic)
        }
    }
    }

    // --- FAILSAFE ECHO GUARD (For "Received" messages that are actually echoes) ---
    // Prevents "Ami Ami Ami" Loop / Spam
    const recentReplies = recentBotReplies.get(senderId);
    if (recentReplies && Array.isArray(recentReplies)) {
        const incomingText = normalizeText(messageText);
        
        // Check against ALL recent replies
        const match = recentReplies.find(reply => {
            const timeDiff = Date.now() - reply.timestamp;
            if (timeDiff >= 20000) return false;
            
            const storedText = reply.text;
            return incomingText && storedText && (incomingText === storedText || incomingText.includes(storedText) || storedText.includes(incomingText));
        });

        if (match) {
             console.log(`[WA] Failsafe Echo Guard triggered! Ignoring message from ${senderId} (Matches recent bot reply).`);
             return;
        }
    }

    const sessionName = session; // Using WAHA Session as Session Name
    
    // Normalized ID
    let messageId = messagePayload.id;
    if (typeof messageId === 'object' && messageId !== null) {
        messageId = messageId._serialized || messageId.id;
    }

    // --- DEBUG: LOG FULL PAYLOAD IF TEXT IS EMPTY ---
    if (!messageText || messageText.trim().length === 0) {
        console.log(`[WA DEBUG] Empty Text Detected! Dumping Payload for ${messageId}:`, JSON.stringify(messagePayload, null, 2));
        
        // Try to extract text from other known locations
        if (messagePayload._data && messagePayload._data.body) {
             messageText = messagePayload._data.body;
             console.log(`[WA DEBUG] Recovered text from _data.body: "${messageText}"`);
        } else if (messagePayload.body) {
             // Sometimes body is there but trim failed?
             console.log(`[WA DEBUG] messagePayload.body exists but might be empty string: "${messagePayload.body}"`);
        }

        // NEW: Fallback for Media Messages to prevent "null" save
        const mime = messagePayload.mimetype || messagePayload.media?.mimetype || '';
        if (mime.startsWith('audio/') || mime.includes('audio') || messagePayload.type === 'ptt') {
            if (!messageText) messageText = '[Voice Message - Processing...]';
        } else if (mime.startsWith('image/') || messagePayload.type === 'image') {
            if (!messageText) messageText = '[Image Message - Processing...]';
        }
    }
    // ------------------------------------------------

    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');
    const groupId = messagePayload.chatId || (isGroup ? senderId : null);
    const groupName = messagePayload.chatName || null;

    const logMsg = `[WA Webhook] Received Message. Session: ${sessionName}, Sender: ${senderId}, Text: "${messageText.substring(0, 50)}..."`;
    console.log(logMsg);
    logToFile(logMsg);

    // --- SAVE USER MESSAGE TO whatsapp_chats (Immediate - Raw) ---
    // User Requirement: Save User Messages even if Locked
    try {
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: senderId, // User is the sender (Phone Number)
            recipient_id: messagePayload.to, // Page is the recipient (Page Number)
            message_id: messageId,
            text: messageText,
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user',
            is_group: isGroup,
            group_id: groupId,
            group_name: groupName
        });
        
        // Save Contact/Lead
        // Enhanced Name Extraction
        let pushName = messagePayload.pushName || messagePayload._data?.notifyName || messagePayload.notifyName;
        
        // Deep search for name in various WAHA payload structures
        if (!pushName && messagePayload.sender) {
             pushName = messagePayload.sender.pushname || messagePayload.sender.name || messagePayload.sender.shortName;
        }
        
        if (!pushName) pushName = 'Unknown';

        await dbService.saveWhatsAppContact({
            session_name: sessionName,
            phone_number: senderId,
            name: pushName
        });

    } catch (err) {
        console.error("Error saving to whatsapp_chats:", err.message);
    }

    // Handover guard: if admin takeover active for this chat, skip
    const chatKey = `${sessionName}_${senderId}`;
    
    // 1. Check Memory (Fast) - for temporary pauses after admin reply
    // DISABLED: Defer to processBufferedMessages to allow Early Label Check to run (unlocking logic)
    /*
    const handoverUntil = handoverMap.get(chatKey);
    if (handoverUntil && handoverUntil > Date.now()) {
        console.log(`[WA] Handover active (Memory) for ${chatKey}. Skipping AI.`);
        return;
    } else if (handoverUntil && handoverUntil <= Date.now()) {
        handoverMap.delete(chatKey);
    }
    */

    // 2. Check DB (Persistent Lock) - for manual Lock/Unlock
    // DISABLED: Defer to processBufferedMessages to allow Early Label Check to run
    /*
    try {
        const contact = await dbService.getWhatsAppContact(sessionName, senderId);
        if (contact && contact.is_locked) {
            console.log(`[WA] Handover active (DB Lock) for ${chatKey}. Skipping AI.`);
            return;
        }
    } catch (err) {
        console.warn(`[WA] Failed to check lock status: ${err.message}`);
    }
    */

    const sessionId = `${sessionName}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null, pageId: messagePayload.to });
    }

    const sessionData = debounceMap.get(sessionId);
    
    // --- EXTRACT MEDIA (Fix for ReferenceError & Missing URL) ---
    const imageUrls = [];
    const audioUrls = [];

    // Robust Media Extraction
    let mediaUrl = messagePayload.mediaUrl || messagePayload.media?.url;
    // If mediaUrl is relative (from WAHA local storage), ensure it's absolute if needed, 
    // but usually WAHA sends full URL or filename. 
    // If it's just filename, we might need to construct URL, but let's assume URL for now.
    
    // Fallback: Check body if it's a URL and hasMedia is true (WAHA behavior sometimes)
    if (!mediaUrl && messagePayload.hasMedia && messagePayload.body && messagePayload.body.startsWith('http')) {
        mediaUrl = messagePayload.body;
    }

    if (mediaUrl) {
        const mime = messagePayload.mimetype || messagePayload.media?.mimetype || '';
        if (mime.startsWith('image/') || messagePayload.type === 'image') {
            imageUrls.push(mediaUrl);
        }
        else if (mime.startsWith('audio/') || mime.includes('audio') || messagePayload.type === 'ptt' || messagePayload.type === 'audio') {
            audioUrls.push(mediaUrl);
        }
    }
    // ---------------------------------------------
    
    // Push Object
    // Extract Quoted Message Data (Lightweight System - Webhook Data)
    let quotedContent = null;
    try {
        // Search in multiple possible locations
        const q = messagePayload._data?.quotedMsg || messagePayload.quotedMsg || messagePayload._data?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (q) {
            if (q.body) quotedContent = q.body; // Standard Text
            else if (q.caption) quotedContent = q.caption; // Image/Video with caption
            else if (q.conversation) quotedContent = q.conversation; // Direct conversation text (some payloads)
            else if (q.type === 'ptt' || q.type === 'audio') quotedContent = '[Voice Message]';
            else if (q.type === 'image') quotedContent = '[Image Message]';
            else if (q.type === 'sticker') quotedContent = '[Sticker]';
            else if (q.type === 'video') quotedContent = '[Video Message]';
            // Deep nested text check
            else if (q.extendedTextMessage && q.extendedTextMessage.text) quotedContent = q.extendedTextMessage.text;
        } 
        
        // Fallback to standard replyTo object
        if (!quotedContent && messagePayload.replyTo && messagePayload.replyTo.body) {
             quotedContent = messagePayload.replyTo.body;
        }
        
        if (quotedContent) {
            logDebug(`[WA] Extracted Quoted Content: "${quotedContent.substring(0,30)}..."`);
        }
    } catch (e) {
        console.error('[WA] Failed to extract quoted content:', e);
    }

    // Extract Push Name for AI Context
    let pushName = messagePayload.pushName || messagePayload._data?.notifyName || messagePayload.notifyName;
    if (!pushName && messagePayload.sender) {
         pushName = messagePayload.sender.pushname || messagePayload.sender.name || messagePayload.sender.shortName;
    }

    sessionData.messages.push({
        id: messageId,
        text: messageText,
        reply_to: messagePayload.replyTo?.id || null, // WAHA reply info
        quoted_text: quotedContent, // <-- NEW: Store quoted text from webhook
        sender_name: pushName || 'Unknown', // <-- NEW: Store sender name
        images: imageUrls,
        audios: audioUrls
    });

    console.log(`[WA] Queued message for ${sessionId}. Buffer size: ${sessionData.messages.length}`);
    
    if (sessionData.timer) {
        clearTimeout(sessionData.timer);
    }

    // Dynamic Debounce from Config
    const config = await dbService.getWhatsAppConfig(sessionName);
    let debounceTime = 2000; // Default 2s (Optimized for speed)
    
    if (config) {
        if (config.wait_time) {
             debounceTime = Number(config.wait_time) * 1000;
        } else if (config.wait) {
             debounceTime = Number(config.wait) * 1000;
        }
    }
    
    if (debounceTime < 1000) debounceTime = 1000;

    sessionData.timer = setTimeout(() => {
        const messagesToProcess = [...sessionData.messages];
        const pageId = sessionData.pageId;
        debounceMap.delete(sessionId);
        // Pass config to avoid re-fetching
        processBufferedMessages(sessionId, sessionName, senderId, messagesToProcess, pageId, config);
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, sessionName, senderId, messages, pageId = null, preLoadedConfig = null) {
    let finalReplyText = null; // Hoisted to avoid TDZ errors

    // 1. Resolve Config EARLY (Optimization)
    let pageConfig = preLoadedConfig;
    if (!pageConfig) {
        try {
            pageConfig = await dbService.getWhatsAppConfig(sessionName);
        } catch (e) {
            console.warn(`[WA] Failed to load config for ${sessionName}: ${e.message}`);
        }
    }

    // --- EARLY LABEL CHECK (Zero Cost Strategy) ---
    // User Requirement: Check labels at the very beginning to stop workflow immediately if blocked.
    // "workflow r surutei dila check korbe 3 ta lebel e..."
    try {
        const latestLabels = await whatsappService.getLabels(sessionName, senderId);
        // console.log(`[WA] Early Label Check for ${senderId}:`, JSON.stringify(latestLabels)); // Debug Log

        if (latestLabels && Array.isArray(latestLabels)) {
            const hardcodedStops = ['adminhandle', 'admincall', 'ordertrack'];
            const shouldStop = latestLabels.some(l => {
                const name = (typeof l === 'string' ? l : l.name || '').toLowerCase();
                return hardcodedStops.includes(name);
            });

            const chatKey = `${sessionName}_${senderId}`;

            if (shouldStop) {
                console.log(`[WA] Blocking Label Found at Start (${senderId}). Stopping Workflow.`);
                handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // Ensure Memory Lock
                // Optional: Ensure DB Lock too? 
                // await dbService.toggleWhatsAppLock(sessionName, senderId, true); 
                return; // <--- STOP HERE
            } else {
                // Label Removed -> Unlock MEMORY ONLY
                // User Requirement: "admin remove korle kaj korbe"
                // We clear memory lock so AI can resume.
                // CRITICAL FIX: Do NOT clear DB lock here. DB lock is for Emoji/Manual locks.
                // If we clear DB lock here, it overrides the Emoji Lock system.
                
                if (handoverMap.has(chatKey)) {
                    console.log(`[WA] Blocking label removed (Early Check). Clearing Memory Lock for ${chatKey}.`);
                    handoverMap.delete(chatKey);
                    // We don't track if memory lock was from Label or Emoji, but usually Emoji sets DB lock too.
                    // So if DB lock is active (checked later), it will still block.
                }

                // REMOVED: Automatic DB Unlock. 
                // Reason: This was disabling Emoji Lock because every message without a label triggered an unlock.
                /*
                const contact = await dbService.getWhatsAppContact(sessionName, senderId);
                if (contact && contact.is_locked) {
                     console.log(`[WA] Blocking label removed (Early Check). Clearing DB Lock for ${senderId}.`);
                     await dbService.toggleWhatsAppLock(sessionName, senderId, false);
                }
                */
            }
        }
    } catch (e) {
        console.warn(`[WA] Early Label Check Failed: ${e.message}`);
    }
    // ----------------------------------------------

    let replyToTextFallback = null;
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    let senderName = null;
    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');

    // Handover guard (Memory) - Late Check (Race Condition Fix)
    // User Scenario: Admin replies during the buffer delay. We must catch it here.
    const chatKey = `${sessionName}_${senderId}`;
    const handoverUntil = handoverMap.get(chatKey);
    if (handoverUntil && handoverUntil > Date.now()) {
        console.log(`[WA] Handover active (Memory - Late Check) for ${chatKey}. Skipping AI.`);
        return;
    }

    // --- ENHANCED LOCK SYSTEM (3-Layer Check) ---
    // Config for Emojis
    let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
    let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];
    if (pageConfig) {
         // Fix: Robust Splitting for Space/Comma separated emojis
         if (pageConfig.lock_emojis) {
             const locks = pageConfig.lock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e);
             if (locks.length > 0) LOCK_EMOJIS = locks;
         }
         if (pageConfig.unlock_emojis) {
             const unlocks = pageConfig.unlock_emojis.split(/[, ]+/).map(e => e.trim()).filter(e => e);
             if (unlocks.length > 0) UNLOCK_EMOJIS = unlocks;
         }
    }

    // Layer 3: Message History Scan (Self-Healing) - PRIORITY CHECK
    // Checks last 20 messages for missed Emoji Commands. 
    // This runs BEFORE DB check to catch "Zombie Locks" or "Missed Unlocks".
    try {
        const historyCheck = await dbService.checkWhatsAppEmojiLock(sessionName, senderId, LOCK_EMOJIS, UNLOCK_EMOJIS);
        
        if (historyCheck) {
            if (historyCheck.locked) {
                 console.log(`[WA Lock] Handover active (History Scan - Layer 3) for ${chatKey}. Found Lock Emoji at ${new Date(Number(historyCheck.timestamp)).toISOString()}`);
                 // Sync DB & Memory
                 await dbService.toggleWhatsAppLock(sessionName, senderId, true);
                 handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000);
                 return; // STOP AI
            } else {
                 // Explicit Unlock Found in History
                 console.log(`[WA Lock] Unlock detected (History Scan - Layer 3). Ensuring DB is Unlocked.`);
                 // Self-Heal: If DB was locked, this fixes it.
                 await dbService.toggleWhatsAppLock(sessionName, senderId, false);
                 // Clear Memory Lock too
                 handoverMap.delete(chatKey);
                 // Continue to Layer 2 (which will now see Unlocked) or fall through
            }
        }
    } catch (err) {
        console.warn(`[WA] Failed to check history lock: ${err.message}`);
    }

    // Layer 2: Database Persistence Check
    // If History was silent (null), we fallback to DB state.
    try {
        const contact = await dbService.getWhatsAppContact(sessionName, senderId);
        if (contact && contact.is_locked) {
            console.log(`[WA] Handover active (DB Lock - Layer 2) for ${chatKey}. Skipping AI.`);
            // Sync Memory
            handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000);
            return; // STOP AI
        }
    } catch (err) {
        console.warn(`[WA] Failed to check DB lock: ${err.message}`);
    }

    for (const msg of messages) {
        if (msg.text) combinedText += msg.text + "\n";
        if (msg.reply_to) {
            replyToId = msg.reply_to; 
            if (msg.quoted_text) replyToTextFallback = msg.quoted_text;
        }
        if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
        if (msg.audios && msg.audios.length > 0) allAudios.push(...msg.audios);
        if (msg.sender_name && msg.sender_name !== 'Unknown') senderName = msg.sender_name;
    }
    // --- MERGE LOGIC (Messenger Style) ---
    // User Update: Use simple concatenation like Messenger to fix "merge message not working"
    // Removed complex deduplication/filtering which caused data loss
    console.log(`[WA] Processing buffered. Text: ${combinedText.substring(0,50)}...`);

    // If this is a swipe-reply, fetch quoted message text by ID for context
    if (replyToId) {
        logDebug(`[Swipe] Detected replyToId: ${replyToId}. Fetching context...`);
        try {
            let quotedText = await dbService.getMessageById(replyToId);
            
            // Fallback to Webhook Data (Lightweight System) - Handles Old Messages / Not in DB
            if ((!quotedText || !quotedText.trim()) && replyToTextFallback) {
                logDebug(`[Swipe] DB miss. Using Webhook quoted text: "${replyToTextFallback.substring(0,30)}..."`);
                quotedText = replyToTextFallback;
            }

            logDebug(`[Swipe] Context fetch result: "${quotedText ? quotedText.substring(0,50) : 'null'}"`);
            
            if (quotedText && quotedText.trim()) {
                // Formatting Context like SMS/Messenger style
                combinedText = `[Replying to: "${quotedText.trim()}"]\n${combinedText}`;
            } else {
                logDebug(`[Swipe] Warning: Context was empty or null for ID ${replyToId}`);
            }
        } catch (e) {
            console.warn(`[WA] Failed to fetch quoted message ${replyToId}: ${e.message}`);
            logDebug(`[Swipe] Error fetching context: ${e.message}`);
        }
    }

    // --- AUDIO TRANSCRIPTION (Per-Message) ---
    // Added to fix Voice Message Reply & Swipe Reply Context
    let audioTranscriptText = null;
    let totalAudioTokens = 0; // Track Audio Tokens

    if (messages.some(m => m.audios && m.audios.length > 0)) {
        logDebug(`[WA] Found audio messages. Starting transcription...`);
        let collectedTranscripts = [];
        
        // Fetch Config for API Keys (needed for Transcription)
        // const pageConfig = await dbService.getWhatsAppConfig(sessionName); // Optim: Already loaded

        for (const msg of messages) {
            if (msg.audios && msg.audios.length > 0) {
                for (const audioUrl of msg.audios) {
                    try {
                        // Transcribe
                        const transcriptData = await aiService.transcribeAudio(audioUrl, pageConfig || {});
                        
                        let transcript = "";
                        let usage = 0;

                        if (typeof transcriptData === 'object') {
                            transcript = transcriptData.text;
                            usage = transcriptData.usage || 0;
                        } else {
                            transcript = transcriptData; // Fallback for legacy string return
                        }

                        logDebug(`[WA] Transcribed msg ${msg.id}: ${transcript} (Tokens: ${usage})`);
                        
                        if (transcript) {
                            collectedTranscripts.push(transcript);
                            totalAudioTokens += usage;
                            
                            // SAVE Transcription to DB (Critical for Swipe Reply)
                            await dbService.saveWhatsAppChat({
                                session_name: sessionName,
                                sender_id: senderId,
                                recipient_id: pageId || sessionName,
                                message_id: msg.id,
                                text: transcript, // Update text in DB
                                timestamp: Date.now(),
                                status: 'received',
                                reply_by: 'user',
                                is_group: isGroup,
                                group_id: null,
                                group_name: null
                            });
                        }
                    } catch (e) {
                        console.error(`[WA] Transcription failed for ${msg.id}:`, e.message);
                        logDebug(`[WA] Transcription error: ${e.message}`);
                    }
                }
            }
        }
        audioTranscriptText = collectedTranscripts.join("\n").trim();
    }

    // --- IMAGE ANALYSIS (Per-Message) ---
    let imageAnalyzeText = null;
    let totalVisionTokens = 0;
    if (messages.some(m => m.images && m.images.length > 0)) {
        let productAnalysisPrompt = "";
        try {
            // Use WhatsApp Config which includes page_prompts
            // const pageConfig = await dbService.getWhatsAppConfig(sessionName); // Optim: Already loaded
            if (pageConfig) {
                // Priority 1: page_prompts object (merged in getWhatsAppConfig)
                if (pageConfig.page_prompts && (pageConfig.page_prompts.image_prompt || pageConfig.page_prompts.vision_prompt)) {
                    productAnalysisPrompt = pageConfig.page_prompts.image_prompt || pageConfig.page_prompts.vision_prompt;
                } else if (pageConfig.image_prompt || pageConfig.vision_prompt) {
                    productAnalysisPrompt = pageConfig.image_prompt || pageConfig.vision_prompt;
                }
            }
        } catch (e) {
            console.warn(`[WA] Failed to fetch vision prompt: ${e.message}`);
        }
        let collectedTexts = [];
        for (const msg of messages) {
            if (msg.images && msg.images.length > 0) {
                try {
                    const perMsgResults = await Promise.all(
                        msg.images.map(img =>
                            aiService.processImageWithVision(img, {}, { prompt: productAnalysisPrompt || "" })
                        )
                    );
                    const perMsgText = perMsgResults.map(res => {
                        if (typeof res === 'object') {
                            totalVisionTokens += (res.usage || 0);
                            return res.text;
                        }
                        return res;
                    }).join("\n").trim();

                    if (perMsgText) {
                        collectedTexts.push(perMsgText);
                        // SAVE analysis as TEXT under ORIGINAL message_id for professional swipe-reply
                        try {
                            await dbService.saveWhatsAppChat({
                                session_name: sessionName,
                                sender_id: senderId,
                                recipient_id: pageId || sessionName,
                                message_id: msg.id,
                                text: `[Image Analysis] ${perMsgText}`,
                                timestamp: Date.now(),
                                status: 'received',
                                reply_by: 'user',
                                is_group: isGroup,
                                group_id: null,
                                group_name: null
                            });
                        } catch (e) {
                            console.error(`[WA] Failed to save per-message analysis:`, e.message);
                        }
                    }
                } catch (err) {
                    console.error(`[WA] Image Analysis Failed (msg ${msg.id}):`, err.message);
                }
            }
        }
        imageAnalyzeText = collectedTexts.join("\n").trim();
        if (imageAnalyzeText) {
            console.log(`[WA] Image Analysis Result (collected): ${imageAnalyzeText.substring(0,50)}... Total Tokens: ${totalVisionTokens}`);
        }
    }

    // --- MERGE LOGIC (n8n Style) ---
    // Priority: Combined Text + Image Analysis + Audio Transcripts
    let finalOutput = "";
    
    // 1. Text
    if (combinedText && combinedText.trim() !== "") {
        finalOutput += combinedText.trim();
    }

    // 2. Image Analysis
    if (messages.some(m => m.images && m.images.length > 0) && (!imageAnalyzeText || imageAnalyzeText.trim() === "")) {
         imageAnalyzeText = "[Image Message]"; 
    }

    if (imageAnalyzeText && imageAnalyzeText.trim() !== "") {
        if (finalOutput) finalOutput += "\n\n";
        // Wrap with [Image Analysis Result] tag to match System Prompt instructions
        finalOutput += `[Image Analysis Result]\n${imageAnalyzeText}`;
    }

    // 3. Audio Transcripts (Critical for Voice Notes)
    // Fallback: If audio exists but transcription failed/empty, add placeholder
    if (messages.some(m => m.audios && m.audios.length > 0) && (!audioTranscriptText || audioTranscriptText.trim() === "")) {
        audioTranscriptText = "[Audio Message]"; 
    }

    if (audioTranscriptText && audioTranscriptText.trim() !== "") {
        // If combinedText was empty (typical for voice note), this becomes the MAIN text
        if (finalOutput) finalOutput += "\n\n";
        finalOutput += audioTranscriptText;
    }

    // Remove legacy combined analysis save (we now save per message_id)

    // If finalOutput is empty (no text, no valid image analysis), skip AI
    if (!finalOutput) {
        console.log(`[WA] No content to process (Empty text & No Image Analysis). Skipping.`);
        return;
    }

    try {
        // 1. Fetch Config (WhatsApp Specific) - Already done at top
        // let pageConfig = preLoadedConfig; ...
        
        if (!pageConfig) {
            console.log(`[WA] Session ${sessionName} not configured.`);
            // Log System Error
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Session not configured.`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }

        if (isGroup && pageConfig && pageConfig.group_reply === false) {
            console.log(`[WA] Group reply disabled for ${sessionName}. Skipping group message from ${senderId}.`);
            return;
        }

        // 2. Check Subscription/Credit & Gatekeeper
        const validStatuses = ['active', 'trial', 'active_trial', 'active_paid'];
        if (!validStatuses.includes(pageConfig.subscription_status)) {
             console.log(`[WA] Session ${sessionName} subscription inactive (Status: ${pageConfig.subscription_status}).`);
             // Log System Error
             await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Inactive Subscription: ${pageConfig.subscription_status}.`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
             return;
        }

        // Gatekeeper Logic: Allow if Own API is used, otherwise require Credit
        // DEBUG LOGGING
        console.log(`[WA Gatekeeper] Config for ${sessionName}: Credits=${pageConfig.message_credit}, CheapEngine=${pageConfig.cheap_engine}, APIKey=${pageConfig.api_key ? 'YES' : 'NO'}`);

        const hasOwnKey = (pageConfig.api_key && pageConfig.api_key.length > 5 && pageConfig.cheap_engine === false);

        if (hasOwnKey) {
             console.log(`[WA] Session ${sessionName} using Own API. Gatekeeper ALLOW.`);
        } else {
             // Use Centralized User Credit (n8n style shared pool)
             // We pass 'sessionName' as pageId, but we need to ensure the DB service handles it
             if (pageConfig.message_credit <= 0) {
                 console.log(`[WA] Session ${sessionName} blocked by Gatekeeper (No Credit & No Own API). Credits: ${pageConfig.message_credit}`);
                 // Log System Error
                 await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: sessionName,
                    recipient_id: senderId,
                    message_id: `sys_${Date.now()}`,
                    text: `[SYSTEM ERROR] Out of Credits.`,
                    timestamp: Date.now(),
                    status: 'system_error',
                    reply_by: 'system'
                });
                 return;
             }
        }

        // --- FAILURE LOCK CHECK ---
        
        // SAVE USER MESSAGE (Persistence Guarantee)
        // User Requirement: Save message to Supabase even if locked (Handover).
        if (finalOutput && finalOutput.trim() !== "") {
             try {
                 // Use the ID of the first message in the batch for consistency
                 const primaryMsgId = messages.length > 0 ? messages[0].id : `usr_${Date.now()}`;
                 
                 await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: senderId,
                    recipient_id: sessionName, // Page is recipient
                    message_id: primaryMsgId,
                    text: finalOutput, // Save the FULL processed text (including image analysis)
                    timestamp: Date.now(),
                    status: 'received',
                    reply_by: 'user',
                    is_group: isGroup,
                    group_id: isGroup ? senderId : null
                });
             } catch (e) {
                 console.warn(`[WA] Failed to save user message (Persistence): ${e.message}`);
             }
        }

        const isLocked = await dbService.checkWhatsAppLockStatus(sessionName, senderId);
        if (isLocked) {
            console.log(`[WA] Conversation with ${senderId} locked due to repeated failures.`);
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Conversation Locked (Too many failures).`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }

        // 3. Prepare AI Context (n8n Style)
        // Ensure Page ID is correctly identified (Session Name = Page ID for WhatsApp)
        const pageId = sessionName; 

        // --- EMOJI LOCK SYSTEM (Messenger Parity) ---
        // Checks for admin emojis to lock/unlock AI
        try {
            const prompts = pageConfig.page_prompts || {};
            
            // Normalize inputs from both sources (page_prompts & whatsapp_message_database)
            // Combine all lock signals into one list
            const lockList = [
                prompts.block_emoji, 
                prompts.lock_emojis, 
                pageConfig.lock_emojis,
                pageConfig.block_emoji
            ].filter(Boolean).join(',').split(',').map(e => e.trim()).filter(Boolean);

            // Combine all unlock signals into one list
            const unlockList = [
                prompts.unblock_emoji, 
                prompts.unlock_emojis, 
                pageConfig.unlock_emojis,
                pageConfig.unblock_emoji
            ].filter(Boolean).join(',').split(',').map(e => e.trim()).filter(Boolean);

            if (lockList.length > 0 || unlockList.length > 0) {
                 const checkCount = parseInt(pageConfig.emoji_check_count) || 50;
                 const pgClient = require('../services/pgClient');
                 const result = await pgClient.query(
                    `
                    SELECT text, timestamp, reply_by
                    FROM whatsapp_chats
                    WHERE session_name = $1
                      AND (
                        (sender_id = $2 AND recipient_id = $3)
                        OR
                        (sender_id = $3 AND recipient_id = $2)
                      )
                    ORDER BY timestamp DESC
                    LIMIT $4
                    `,
                    [sessionName, senderId, sessionName, checkCount]
                 );
                 const rawHistory = result.rows || [];

                 if (rawHistory && rawHistory.length > 0) {
                     let lastBlockTime = 0;
                     let lastUnblockTime = 0;

                     for (const msg of rawHistory) {
                         // Only check Admin/System/Page messages
                         if (msg.reply_by === 'admin' || msg.reply_by === 'system' || msg.reply_by === 'api') {
                             const content = (msg.text || '').trim();
                             const msgTime = new Date(msg.timestamp).getTime();

                             // Check Block/Lock
                             if (lockList.some(e => content.includes(e))) {
                                 if (msgTime > lastBlockTime) lastBlockTime = msgTime;
                             }

                             // Check Unblock/Unlock
                             if (unlockList.some(e => content.includes(e))) {
                                 if (msgTime > lastUnblockTime) lastUnblockTime = msgTime;
                             }
                         }
                     }

                     if (lastBlockTime > lastUnblockTime) {
                        console.log(`[WA] Conversation Locked via Emoji by Admin. (Block: ${lastBlockTime} > Unblock: ${lastUnblockTime})`);
                        const chatKey = `${sessionName}_${senderId}`;
                        handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // 1 Hour Lock
                        
                        // Persist Lock to DB
                        try {
                            await dbService.toggleWhatsAppLock(sessionName, senderId, true);
                        } catch (err) {
                            console.warn(`[WA] Failed to persist emoji lock: ${err.message}`);
                        }
                        
                        return; 
                    } else if (lastUnblockTime > lastBlockTime) {
                        // Ensure lock is cleared
                        const chatKey = `${sessionName}_${senderId}`;
                        if (handoverMap.has(chatKey)) {
                            console.log(`[WA] Conversation Unlocked via Emoji by Admin.`);
                            handoverMap.delete(chatKey);
                        }

                        // Persist Unlock to DB
                        try {
                            await dbService.toggleWhatsAppLock(sessionName, senderId, false);
                        } catch (err) {
                            console.warn(`[WA] Failed to persist emoji unlock: ${err.message}`);
                        }
                    }
                 }
            }
        } catch (e) {
            console.warn(`[WA] Emoji lock check failed: ${e.message}`);
        }

        // --- CHECK LABELS (Admin Handover & Dynamic Actions) ---
        // MOVED TO START OF FUNCTION (Early Check)
        // Kept here only for Dynamic DB Configuration checks if needed later, but for now we skip to avoid double API calls.
        /* 
        try {
             // ... Code moved to top ...
        } catch (e) { ... } 
        */
        // -------------------------------------

        // Fetch History (User + Assistant)
        // n8n workflow uses 'postgres_chat_memory'
        // Dynamic History Limit: Check 'check_conversion' (from Behavior Settings) or default to 20
        let historyLimit = 20;
        if (pageConfig.check_conversion) {
            const limit = Number(pageConfig.check_conversion);
            if (limit > 0 && limit <= 50) historyLimit = limit;
        }
        
        const history = await dbService.getWhatsAppChatHistory(sessionName, senderId, historyLimit);
        
        // --- MANUAL INTERVENTION GUARD (Admin Reply Check) ---
        // User Requirement: "admin reply dile bot reply dibe na but amon na je silent takbe"
        // User Requirement: "admin reply dile per day te 20 ta request korte parbe amon koro"
        try {
            const rawRecent = await dbService.getLastNWhatsAppMessages(sessionName, senderId, 10);
            // Find last message sent by 'admin' (not 'bot')
            const lastAdminReply = rawRecent.find(m => m.reply_by === 'admin');
            
            if (lastAdminReply) {
                // Admin has intervened. Apply 20 requests/day limit instead of hard silence.
                const dailyAICount = await dbService.getWhatsAppDailyAICount(sessionName, senderId);
                
                if (dailyAICount >= 20) {
                    console.log(`[WA] Admin handover active & daily limit (20) reached for ${senderId}. Skipping AI.`);
                    
                    // Optional: Force Handover Memory Lock to avoid repeated DB calls for this session for a while
                    const chatKey = `${sessionName}_${senderId}`;
                    handoverMap.set(chatKey, Date.now() + 5 * 60 * 1000); // 5 min buffer
                    
                    return;
                }
                
                console.log(`[WA] Admin handover active. Daily AI count: ${dailyAICount}/20 for ${senderId}. Proceeding.`);
            }
        } catch (e) {
            console.warn(`[WA] Admin reply check failed: ${e.message}`);
        }
        // ----------------------------------------------------

        // 4. Generate Response (AI)
        console.log(`[AI] Generating response for ${senderId} (Session: ${sessionName})...`);

        // Resolve Owner Name (PushName vs SessionName)
        let ownerName = sessionName;
        if (pageConfig && pageConfig.push_name) {
             ownerName = pageConfig.push_name;
        } else {
             try {
                 // Fetch real name from WAHA if not in config
                 const sessionInfo = await whatsappService.getSession(sessionName);
                 if (sessionInfo && sessionInfo.me && sessionInfo.me.pushName) {
                     ownerName = sessionInfo.me.pushName;
                     // Attempt to save to DB for future speed (Self-Healing)
                     dbService.updateWhatsAppEntryByName(sessionName, { push_name: ownerName })
                        .catch(() => {}); // Ignore DB errors if column missing
                 }
             } catch (e) {
                 // Ignore fetch errors
             }
        }
        
        // If we already analyzed images and replaced the text, don't pass images again to avoid double-processing
        const imagesToPass = (imageAnalyzeText && imageAnalyzeText.trim() !== "") ? [] : allImages;

        const aiResponse = await aiService.generateResponse({
            pageId: pageId, 
            userId: senderId,
            userMessage: finalOutput, // Use the resolved output (Analysis, Text, Audio)
            history: history,
            imageUrls: imagesToPass, 
            audioUrls: [], // Handled manually in controller
            config: pageConfig,
            platform: 'whatsapp',
            extraTokenUsage: totalVisionTokens + totalAudioTokens, // Pass vision + audio tokens
            senderName: senderName, // <-- NEW: Pass resolved sender name
            ownerName: ownerName // <-- NEW: Pass Owner Account Name (Real PushName)
        });

        if (!aiResponse) {
             console.log(`[WA] AI returned null (Silent Failure). Verify AI Service health or content safety.`);
             // Attempt to send a fallback message if configured, or just log
             return;
        }

        const replyText = aiResponse.reply || aiResponse.text;
        finalReplyText = replyText;
        
        // 5. Send Reply
        console.log(`[WA] Sending Reply: "${replyText.substring(0, 50)}..."`);
        
        // Mark as Seen (User Experience)
        await whatsappService.sendSeen(sessionName, senderId);

        // Send Typing Indicator (User Experience: Seen -> Typing -> Reply)
        // Simulate human-like behavior
        await whatsappService.sendTyping(sessionName, senderId);
        
        // Wait 2 seconds to show "typing..."
        await new Promise(resolve => setTimeout(resolve, 2000));

        // --- HANDLE SAVE_ORDER ([SAVE_ORDER: {...}]) ---
        const orderRegex = /\[SAVE_ORDER:\s*({.*?})\]/s;
        const orderMatch = finalReplyText.match(orderRegex);
        if (orderMatch && orderMatch[1]) {
            try {
                const orderJson = JSON.parse(orderMatch[1]);
                console.log(`[WA] AI requested to save order:`, orderJson);
                
                await dbService.saveWhatsAppOrderTracking({
                    session_name: sessionName,
                    sender_id: senderId,
                    number: senderId.split('@')[0], // Clean number
                    product_name: orderJson.product_name || 'Unknown',
                    location: orderJson.location || '',
                    product_quantity: orderJson.product_quantity || '1',
                    price: orderJson.price || null
                });
                
                // ADVANCED FIX: Auto-apply 'ordertrack' label and STOP workflow immediately
                // This ensures reliability even if AI forgets the [ADD_LABEL] tag
                console.log(`[WA] Order Saved. Enforcing 'ordertrack' label and lock.`);
                await whatsappService.addLabel(sessionName, senderId, 'ordertrack');
                
                const chatKey = `${sessionName}_${senderId}`;
                handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // Lock for 1 hour
                
                // Remove tag from user-facing text
                finalReplyText = finalReplyText.replace(orderMatch[0], '').trim();
            } catch (e) {
                console.error(`[WA] Failed to save order from AI tag:`, e.message);
            }
        }

        // --- HANDLE DYNAMIC LABELS ([ADD_LABEL: x]) ---
        // Format: [ADD_LABEL: admincall]
        const labelRegex = /\[ADD_LABEL:\s*([a-zA-Z0-9_]+)\]/gi;
        let labelMatch;

        while ((labelMatch = labelRegex.exec(finalReplyText)) !== null) {
            const fullTag = labelMatch[0];
            const labelName = labelMatch[1].toLowerCase();
            
            console.log(`[WA] AI requested to add label: ${labelName}`);
            
            try {
                // Call WAHA to add label
                await whatsappService.addLabel(sessionName, senderId, labelName);
                
                // If label is 'admincall' or 'adminhandle' or has 'stop' action, lock immediately
                // This prevents AI from replying to its own label action in next loop if user replies fast
                const labelActions = pageConfig.label_actions || [];
                const actionConfig = labelActions.find(la => la.label_name.toLowerCase() === labelName);
                const isHardcodedStop = ['adminhandle', 'admincall', 'ordertrack'].includes(labelName);
                
                if (isHardcodedStop || (actionConfig && actionConfig.ai_action === 'stop')) {
                     console.log(`[WA] Blocking Label applied (${labelName}). Locking conversation.`);
                     const chatKey = `${sessionName}_${senderId}`;
                     handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000);
                }

            } catch (lblErr) {
                console.error(`[WA] Failed to add label ${labelName}:`, lblErr.message);
            }

            // Remove tag from user-facing text
            finalReplyText = finalReplyText.replace(fullTag, '').trim();
        }

        // Handle Strict Image Sending (High Level: JSON + Regex Fallback)
        let extractedImages = [];
        
        // 1. Structured Images from AI (Priority)
        if (aiResponse.images && Array.isArray(aiResponse.images)) {
            extractedImages = [...aiResponse.images];
        }

        // 2. Legacy Regex Fallback (In case AI puts it in text)
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        let strictMatch;
        while ((strictMatch = strictImageRegex.exec(finalReplyText)) !== null) {
            const fullMatch = strictMatch[0];
            const title = strictMatch[1].trim();
            const url = strictMatch[2].trim();
            
            if (!extractedImages.some(img => img.url === url)) {
                // Check if it's a direct image or a product page
                const isImageExtension = /\.(jpg|jpeg|png|gif|webp|bmp|tiff)(\?.*)?$/i.test(url);
                if (isImageExtension) {
                    extractedImages.push({ url: url, title: title });
                } else {
                    // Try to fetch OG image for product pages labeled as IMAGE
                    try {
                        console.log(`[WA] Labeled link detected, fetching OG image for: ${url}`);
                        const ogImage = await aiService.fetchOgImage(url);
                        if (ogImage) {
                            extractedImages.push({ url: ogImage, title: title });
                            console.log(`[WA] Successfully fetched OG Image for labeled link: ${ogImage}`);
                        } else {
                            // If no OG image, keep the link but maybe not send as image
                            console.warn(`[WA] No OG Image found for labeled link: ${url}`);
                        }
                    } catch (ogError) {
                        console.warn(`[WA] OG Image fetch failed for ${url}:`, ogError.message);
                    }
                }
            }
            
            // Remove from text
            finalReplyText = finalReplyText.replace(fullMatch, '').trim();
        }

        // --- NEW: AUTO-EXTRACT PRODUCT LINKS WITHOUT LABELS ---
        // If AI just drops a link (e.g. from the store) without "Image:" prefix, 
        // we still want to try and send it as an image if it's a product page.
        const rawLinkRegex = /(https?:\/\/[^\s,]+)/gi;
        let rawMatch;
        while ((rawMatch = rawLinkRegex.exec(finalReplyText)) !== null) {
            const url = rawMatch[0].replace(/[,.]$/, '');
            
            // Skip if already extracted or if it has an image extension (already handled above)
            const isImageExtension = /\.(jpg|jpeg|png|gif|webp|bmp|tiff)(\?.*)?$/i.test(url);
            if (isImageExtension || extractedImages.some(img => img.url === url)) continue;

            // Only try for potential store/product links
            // We skip obvious social media, search engines, and common non-product sites
            const isSocialOrGeneric = /facebook\.com|instagram\.com|twitter\.com|t\.me|wa\.me|youtube\.com|youtu\.be|tiktok\.com|google\.com|bing\.com|linkedin\.com|pinterest\.com/i.test(url);
            
            // Optimization: If it's a known product platform or a direct link that isn't social/generic, try to fetch image
            const isProductStore = /daraz|evaly|chaldal|rokomari|pickaboo|startech|ryanscomputers|othoba|shajgoj|aarong/i.test(url);

            if (!isSocialOrGeneric || isProductStore) {
                try {
                    console.log(`[WA] Potential product link detected, attempting OG image fetch: ${url}`);
                    const ogImage = await aiService.fetchOgImage(url);
                    if (ogImage) {
                        if (!extractedImages.some(img => img.url === ogImage)) {
                            extractedImages.push({ url: ogImage, title: 'Product Details' });
                            console.log(`[WA] Auto-extracted OG Image from raw link: ${ogImage}`);
                        }
                    }
                } catch (e) {
                    // Silently fail if image fetch fails for a link
                }
            }
        }

        // 3. Normalize & Fix URLs (Google Drive, etc.)
        extractedImages = extractedImages.map(img => {
            let url = img.url.replace(/[,.]$/, ''); // Cleanup punctuation
            
            // Fix Google Drive Links
            const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (driveIdMatch && driveIdMatch[1]) {
                url = `https://drive.google.com/uc?export=view&id=${driveIdMatch[1]}`;
            }
            return { ...img, url };
        });

        // --- EMOJI HANDOVER LOGIC (AI Reply) ---
        {
            let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
            let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];

            if (pageConfig) {
                if (pageConfig.lock_emojis && pageConfig.lock_emojis.trim()) {
                    LOCK_EMOJIS = pageConfig.lock_emojis.split(',').map(e => e.trim()).filter(e => e);
                }
                if (pageConfig.unlock_emojis && pageConfig.unlock_emojis.trim()) {
                    UNLOCK_EMOJIS = pageConfig.unlock_emojis.split(',').map(e => e.trim()).filter(e => e);
                }
            }

            let aiCommand = null;
            for (const e of LOCK_EMOJIS) if (finalReplyText.includes(e)) aiCommand = 'LOCK';
            for (const e of UNLOCK_EMOJIS) if (finalReplyText.includes(e)) aiCommand = 'UNLOCK';
            
            if (aiCommand) {
                 const isLocked = aiCommand === 'LOCK';
                 console.log(`[WA] Emoji Command Detected (${aiCommand}) from AI. Updating Lock Status...`);
                 await dbService.toggleWhatsAppLock(sessionName, senderId, isLocked);
                 
                 const chatKey = `${sessionName}_${senderId}`;
                 if (isLocked) handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000);
                 else handoverMap.delete(chatKey);
            }
        }

        // Send Text First
        let sentMessageId = `bot_${Date.now()}`;
        
        if (finalReplyText) {
             // PRE-REGISTER to prevent Race Condition (Echo Guard)
             // We add it to the map BEFORE sending, so if the webhook hits immediately, it's already there.
             const existing = recentBotReplies.get(senderId) || [];
             existing.push({ text: normalizeText(finalReplyText), timestamp: Date.now() });
             recentBotReplies.set(senderId, existing);

             const sentData = await whatsappService.sendMessage(sessionName, senderId, finalReplyText);
             if (sentData && sentData.id) {
                 // WAHA returns { id: "...", ... } or { id: { _serialized: "..." } } depending on version
                 // Usually sentData.id is the ID string
                 sentMessageId = (typeof sentData.id === 'object') ? sentData.id._serialized : sentData.id;
                 
                 // Add to Bot Message IDs (Critical for preventing Double Messages in Dashboard)
                 if (sentMessageId) {
                     console.log(`[WA Debug] Adding BotID: ${sentMessageId}`);
                     botMessageIds.add(sentMessageId);
                     
                     // Auto-clear after 2 minutes to save memory
                     setTimeout(() => {
                         botMessageIds.delete(sentMessageId);
                         recentBotReplies.delete(senderId);
                         // console.log(`[WA Debug] Cleared BotID: ${sentMessageId}`);
                     }, 2 * 60 * 1000);
                 }
             }
        }

        // Send Images
        for (const img of extractedImages) {
            console.log(`[WA] Sending Extracted Image: ${img.title} -> ${img.url}`);
            
            // Register Image Caption for Echo Guard
            if (img.title && img.title.trim()) {
                 const existing = recentBotReplies.get(senderId) || [];
                 existing.push({ text: normalizeText(img.title), timestamp: Date.now() });
                 recentBotReplies.set(senderId, existing);
            }

            await whatsappService.sendImage(sessionName, senderId, img.url, img.title);
        }

        // 6. Deduct Credit (If not Own API)
        // Update: Deduct from User Shared Pool
        if (!hasOwnKey) {
             const deducted = await dbService.deductWhatsAppCredit(sessionName);
             if (!deducted) {
                 console.warn(`[WA] Credit deduction failed for ${sessionName} (User Shared Pool).`);
             }
        }

        // 7. Save Bot Reply to DB
        let modelLabel = aiResponse.model;
        if (!hasOwnKey && (modelLabel === 'gemini-2.0-flash' || modelLabel === 'gemini-2.0-flash-lite')) {
            modelLabel = 'salesmanchatbot-pro';
        }
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: pageId || sessionName, // Bot (Page) is sender
            recipient_id: senderId, // User is recipient
            message_id: sentMessageId,
            text: finalReplyText, // Save CLEANED text (what was actually sent) to match Webhook Echo Guard
            timestamp: Date.now(),
            status: 'sent',
            reply_by: 'bot',
            model_used: modelLabel, // Save Model Name
            token_usage: aiResponse.token_usage // Save Total Token Usage (Vision + Chat)
        });

        // Save Image Memory (system note) so AI can see previously sent product images for this chat
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            const summary = aiResponse.images
                .map(img => `${img.title || 'Image'} | ${img.url}`)
                .join(' ; ');
            const memoryNote = `[IMAGE MEMORY] Sent product images in this reply: ${summary}`;
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `imgmem_${Date.now()}`,
                text: memoryNote,
                timestamp: Date.now(),
                status: 'image_memory',
                reply_by: 'system'
            });
        }

    } catch (err) {
        console.error(`[WA] Error processing buffered messages: ${err.message}`);
        // Log System Error
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: sessionName,
            recipient_id: senderId,
            message_id: `err_${Date.now()}`,
            text: `[SYSTEM ERROR] ${err.message}`,
            timestamp: Date.now(),
            status: 'system_error',
            reply_by: 'system'
        });
    }
}

// Auto-Repair Job
async function checkAndAutoRepairSessions() {
    console.log('[WA Repair] Checking for failed sessions...');
    try {
        const activeSessions = await dbService.getActiveWhatsAppSessions();
        if (!activeSessions || activeSessions.length === 0) return;

        // Fetch ALL sessions from WAHA once
        let wahaSessions = [];
        try {
            wahaSessions = await whatsappService.getSessions(true);
        } catch (e) {
            console.warn("[WA Repair] Failed to fetch WAHA sessions:", e.message);
            return; // Abort if WAHA is down
        }
        
        for (const dbSession of activeSessions) {
            const { session_name } = dbSession;
            const wahaSession = wahaSessions.find(s => s.name === session_name);

            if (!wahaSession) {
                // Missing in WAHA
                console.warn(`[WA Repair] Session '${session_name}' missing in WAHA. Marking as STOPPED.`);
                await dbService.updateWhatsAppEntryByName(session_name, { status: 'STOPPED', active: false });
                continue;
            }

            if (wahaSession.status === 'STOPPED') {
                console.log(`[WA Repair] Session '${session_name}' is STOPPED. Attempting Auto-Start...`);
                try {
                    await whatsappService.startSession(session_name);
                } catch (e) {
                    console.error(`[WA Repair] Failed to auto-start '${session_name}':`, e.message);
                }
            } else if (wahaSession.status === 'FAILED') {
                 console.log(`[WA Repair] Session '${session_name}' is FAILED. Restarting...`);
                 try {
                    await whatsappService.stopSession(session_name);
                    await new Promise(r => setTimeout(r, 2000));
                    await whatsappService.startSession(session_name);
                 } catch(e) {
                     console.error(`[WA Repair] Failed to restart '${session_name}':`, e.message);
                 }
            }
        }
    } catch (err) {
        console.error('[WA Repair] Error:', err);
    }
}

// Cleanup Job
async function checkAndCleanupExpiredSessions() {
    console.log('[WA Cleanup] Checking for expired sessions...');
    try {
        const expiredSessions = await dbService.getExpiredWhatsAppSessions();
        
        if (!expiredSessions || expiredSessions.length === 0) {
            // console.log('[WA Cleanup] No expired sessions found.');
            return;
        }

        console.log(`[WA Cleanup] Found ${expiredSessions.length} expired sessions. Processing...`);

        for (const session of expiredSessions) {
            const { session_name } = session;
            console.log(`[WA Cleanup] Expiring session '${session_name}'...`);

            // 1. Stop/Delete in WAHA
            try {
                // Try logout/stop first
                try { await whatsappService.logoutSession(session_name); } catch(e){}
                await new Promise(r => setTimeout(r, 1000));
                
                try { await whatsappService.stopSession(session_name); } catch(e){}
                await new Promise(r => setTimeout(r, 1000));

                await whatsappService.deleteSession(session_name);
            } catch (err) {
                console.warn(`[WA Cleanup] WAHA cleanup error for '${session_name}':`, err.message);
                // Continue to DB cleanup anyway
            }

            // 2. Mark as Expired in DB
            // We set status to 'expired', active to false.
            await dbService.updateWhatsAppEntryByName(session_name, {
                status: 'expired',
                active: false,
                subscription_status: 'expired'
            });
            
            console.log(`[WA Cleanup] Session '${session_name}' marked as expired.`);
        }

    } catch (err) {
        console.error('[WA Cleanup] Error:', err);
    }
}

module.exports = {
    handleWebhook,
    checkAndCleanupExpiredSessions,
    checkAndAutoRepairSessions
};
