const dbService = require('../services/dbService');
const { query } = require('../services/pgClient');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');
const { runMessengerWorkflow } = require('../services/messenger_workflow');
const fs = require('fs');
const path = require('path');

// --- GATEKEEPER CACHE (In-Memory) ---
// Purpose: Block unauthorized pages instantly to protect backend resources.
let allowedPagesCache = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes

async function refreshAllowedPages() {
    const now = Date.now();
    if (now - lastCacheUpdate < CACHE_TTL && allowedPagesCache.size > 0) return;

    // console.log("[Gatekeeper] Refreshing allowed pages cache...");
    const pages = await dbService.getAllActivePages();
    if (pages && pages.length > 0) {
        allowedPagesCache = new Set(pages);
        lastCacheUpdate = now;
        console.log(`[Gatekeeper] Cache updated. Allowed Pages: ${allowedPagesCache.size}`);
    }
}

// Initial Warmup
refreshAllowedPages();
setInterval(refreshAllowedPages, CACHE_TTL);
// ------------------------------------

// Helper to log to file (Async)
function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFile(logPath, `[${timestamp}] ${message}\n`, (err) => {
        if (err) console.error('Log Error:', err);
    });
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractImageUrlsFromText(text) {
    const urls = [];
    if (!text || typeof text !== 'string') return { cleanText: text || '', urls };
    const imageUrlRegex = /https?:\/\/[^\s,)]*?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s,)]*)?/gi;
    const cleanText = text.replace(imageUrlRegex, match => {
        const cleaned = match.replace(/[,.]$/, '');
        urls.push(cleaned);
        return '';
    });
    return {
        cleanText: cleanText.replace(/\n\s*\n/g, '\n').trim(),
        urls
    };
}

function sanitizeReplyText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\[[A-Z0-9_]+:[\s\S]*?\]/g, '')
        .replace(/\[.*?\]\s*\(\s*https?:\/\/[^\s)]+\s*\)/gi, '')
        .replace(/\[\s*\/?[^\]]*\]/gi, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

function extractVisionProductNames(text) {
    const names = [];
    if (!text || typeof text !== 'string') return names;
    
    // 1. Look for numbered list items like: ১. **The Face Shop...**
    const listMatches = text.match(/(?:\d+|[০-৯])\.\s*\*\*([^*]+)\*\*/g) || [];
    for (const match of listMatches) {
        const name = match.replace(/(?:\d+|[০-৯])\.\s*\*\*/, '').replace(/\*\*/, '').trim();
        if (name && name.length > 2) names.push(name);
    }

    // 2. Fallback to PRODUCT: format
    if (names.length === 0) {
        const productLines = text.match(/PRODUCT:\s*([^\n]+)/gi) || [];
        for (const line of productLines) {
            const name = line.split(':').slice(1).join(':').trim();
            if (name && name.length > 2) names.push(name);
        }
    }

    if (names.length === 0) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (line.length < 4) continue;
            if (/price|৳|tk|bdt|\d{3,}/i.test(line)) continue;
            names.push(line);
            if (names.length >= 5) break;
        }
    }
    return Array.from(new Set(names));
}

function normalizeImageUrl(url) {
    if (!url || url === 'N/A') return null;
    if (url.startsWith('http')) return url;
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl.replace(/\/$/, '')}${cleanPath}`;
}

function hasPhotoIntent(historyList) {
    if (!Array.isArray(historyList)) return false;
    return historyList.some(item => {
        let content = '';
        if (typeof item === 'string') content = item;
        else if (typeof item.content === 'string') content = item.content;
        else if (typeof item.text === 'string') content = item.text;
        else if (item.message && typeof item.message.content === 'string') content = item.message.content;
        else if (item.message && typeof item.message.text === 'string') content = item.message.text;
        return typeof content === 'string' && content.includes('[INTENT_DETECTED: USER_REQUESTED_PHOTO]');
    });
}

function shouldBlockOutgoingReply(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return true; // Silence if empty

    // 1. Check for remaining Structural Symbols (e.g. [ , ] , { , } , http)
    // If the Logic-Based Sanitizer didn't catch these, it means the message is messy.
    // Professional messages should be pure text, emojis, and common punctuation.
    const hasBrackets = trimmed.includes('[') || trimmed.includes(']');
    const hasBraces = trimmed.includes('{') || trimmed.includes('}');
    const hasBackslashes = trimmed.includes('\\');

    if (hasBrackets || hasBraces || hasBackslashes) {
        console.warn(`[Quality Control] Blocked unprofessional message: "${trimmed.substring(0, 50)}..."`);
        return true; // BLOCK it. Better silence than garbage.
    }

    // 2. Original JSON check
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return true;
        } catch (e) {}
    }
    
    return false;
}

function extractProductNamesFromPrompt(promptText) {
    if (!promptText || typeof promptText !== 'string') return [];
    const regex = /##PRODUCT\s+"([^"]+)"/gi;
    const set = new Set();
    let match;
    while ((match = regex.exec(promptText)) !== null) {
        let name = match[1].trim();
        name = name.replace(/^\*+/, '').replace(/\*+$/, '').trim();
        if (name) set.add(name.toLowerCase());
    }
    return Array.from(set);
}

function detectImageMode(promptText) {
    const text = String(promptText || '');
    const tagMatch = text.match(/\[(?:IMAGE_MODE|MODE):\s*(image_only|image_title|title_desc|full_product)\s*\]/i);
    if (tagMatch) return tagMatch[1].toLowerCase();
    if (/(image\s*only|only\s*image|only\s*picture|only\s*photo|শুধু\s*(ইমেজ|ছবি|সবি)|sudu\s*sobi)/i.test(text)) return 'image_only';
    if (/(image\s*(and|&)\s*title|title\s*(and|&)\s*image|ছবি\s*.*টাইটেল|ইমেজ\s*.*টাইটেল)/i.test(text)) return 'image_title';
    if (/(title\s*(and|&)\s*description|description\s*(and|&)\s*title|টাইটেল\s*.*ডেসক্রিপশন|টাইটেল\s*.*বর্ণনা)/i.test(text)) return 'title_desc';
    if (/(full\s*product|title\s*description\s*price|সব\s*দাও|সব\s*দেবে|সম্পূর্ণ)/i.test(text)) return 'full_product';
    return null;
}

function extractDecisionMode(text) {
    if (!text || typeof text !== 'string') return { mode: null, cleaned: text };
    const match = text.match(/\[(?:IMAGE_DECISION|DECISION_MODE):\s*(image_only|image_title|title_desc|full_product)\s*\]/i);
    if (!match) return { mode: null, cleaned: text };
    const mode = match[1].toLowerCase();
    const cleaned = text.replace(match[0], '').trim();
    return { mode, cleaned };
}

const debounceMap = new Map();
const pageQueueMap = new Map();
const MAX_CONCURRENT_PER_PAGE = 5;

function schedulePageTask(pageId, task) {
    const key = String(pageId);
    let state = pageQueueMap.get(key);
    if (!state) {
        state = { active: 0, queue: [] };
        pageQueueMap.set(key, state);
    }
    const run = async () => {
        try {
            // Add a timeout to prevent the queue from getting stuck if task hangs
            await Promise.race([
                task(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Task Timeout (30s)")), 30000))
            ]);
        } catch (e) {
            console.error(`[BurstQueue] Task error (Page ${pageId}):`, e.message || e);
        } finally {
            state.active -= 1;
            if (state.queue.length > 0) {
                const next = state.queue.shift();
                state.active += 1;
                next();
            }
        }
    };
    if (state.active < MAX_CONCURRENT_PER_PAGE) {
        state.active += 1;
        run();
    } else {
        state.queue.push(run);
    }
}

function parsePrice(value) {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    // Remove currency symbols, commas, and other non-numeric chars except dot
    const cleanValue = String(value).replace(/[^\d.]/g, '');
    const num = parseFloat(cleanValue);
    return isFinite(num) ? num : 0;
}

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    const body = req.body;
    console.log(`[Webhook] Incoming POST Request. Object: ${body.object}`); 
    // console.log('Webhook Body Received:', JSON.stringify(body, null, 2)); // Too verbose for production

    if (body.object === 'page') {
        // --- REALTIME OPTIMIZATION: Respond Immediately ---
        // Facebook requires a 200 OK within a few seconds.
        // We send it NOW, before any heavy lifting (DB, Gatekeeper, AI).
        res.status(200).send('EVENT_RECEIVED');

        // Execute processing in background (Fire & Forget)
        (async () => {
            try {
                // --- GATEKEEPER CHECK (Fail Fast) ---
                if (allowedPagesCache.size === 0) await refreshAllowedPages();
                
                // Async Processing
                for (const entry of body.entry) {
                    const pageId = entry.id; // Correct way to get pageId for THIS entry
                    if (!pageId) continue;

                    // Gatekeeper Check per Page
                    if (!allowedPagesCache.has(pageId)) {
                        // Double check DB before hard blocking (in case of new signup not in cache yet)
                        const isActuallyActive = await dbService.getPageConfig(pageId);
                        
                        if (isActuallyActive) {
                            const hasCredit = (isActuallyActive.message_credit > 0);
                            const hasOwnKey = (isActuallyActive.api_key && isActuallyActive.api_key.length > 5 && isActuallyActive.cheap_engine === false);
                            const isBanned = isActuallyActive.subscription_status === 'banned';
        
                            if (!isBanned && (hasCredit || hasOwnKey)) {
                                allowedPagesCache.add(pageId); 
                            } else {
                                console.warn(`[Gatekeeper] BLOCKED unauthorized event for Page ID: ${pageId}. Status: ${isActuallyActive.subscription_status}, Credit: ${isActuallyActive.message_credit}, OwnAPI: ${hasOwnKey}`);
                                continue; // Skip THIS entry
                            }
                        } else {
                            // Page not found in DB
                            continue; // Skip THIS entry
                        }
                    }

                    // 1. Handle Messaging Events (Direct Messages)
                    if (entry.messaging) {
                        for (const webhookEvent of entry.messaging) {
                            if (webhookEvent) {
                                await queueMessage(webhookEvent, pageId);
                            }
                        }
                    }
                    
                    // 2. Handle Changes Events (Comments / Feed)
                    if (entry.changes) {
                        for (const change of entry.changes) {
                            if (change.field === 'feed') {
                                await processCommentEvent(change.value, pageId);
                            }
                        }
                    }
                }
            } catch (bgError) {
                console.error("[Webhook] Background Processing Error:", bgError);
            }
        })();

    } else {
        res.sendStatus(404);
    }
};

const verifyWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || '123456'; 
    console.log(`[Webhook] Verification Request: Mode=${req.query['hub.mode']}, Token=${req.query['hub.verify_token']}`);

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('WEBHOOK_VERIFICATION_FAILED');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// Queue Message for Debounce
async function queueMessage(event, entryPageId = null) {
    // --- DEBUG: Log Incoming Event to see why echoes fail ---
    if (event.message && event.message.is_echo) {
        console.log(`[Echo Debug] RAW PAYLOAD:`, JSON.stringify(event));
    }

    // --- ECHO HANDLING (Admin Replies & Bot Confirmations) ---
    const senderIdRaw = event.sender?.id;
    const recipientIdRaw = event.recipient?.id;
    
    // Robust Admin Detection:
    // 1. Explicit Echo flag
    // 2. Sender is the Page itself (matched against Entry ID)
    // 3. Sender same as Recipient (Self-message case)
    // 4. Sender is a known Page in DB (Fallback)
    
    let isAdminSender = false;
    
    // Check 1 & 2 & 3
    if (event.message?.is_echo || senderIdRaw === entryPageId || senderIdRaw === recipientIdRaw) {
        isAdminSender = true;
    } 
    // Check 4 (Fallback DB Check) - Only if not already identified
    else if (event.message && senderIdRaw && recipientIdRaw) {
        try {
             // Optimization: If senderIdRaw matches the page_id passed from webhook entry, avoid DB call
             if (entryPageId && senderIdRaw === entryPageId) {
                 isAdminSender = true;
             } else {
                 const senderPageConfig = await dbService.getPageConfig(senderIdRaw);
                 if (senderPageConfig) {
                     isAdminSender = true;
                 }
             }
        } catch (e) {}
    }

    if (event.message && isAdminSender) {
        // IMPORTANT: In Echo, Sender = Page, Recipient = User
        const pageId = senderIdRaw; 
        const messageRecipientId = recipientIdRaw; 
        const messageId = event.message.mid;
        const text = event.message.text || '';

        // --- SMART ECHO FILTER (Race Condition Proof) ---
        // We check DB first. If it's NOT in DB or NOT marked as 'bot', it's ADMIN.
        try {
            const existingChat = await dbService.getFbChatById(messageId);
            if (existingChat && (existingChat.reply_by === 'bot' || existingChat.reply_by === 'system')) {
                // Already handled by our system flow, skip echo
                return; 
            }

            console.log(`[Echo] ADMIN ACTION DETECTED: Page ${pageId} -> User ${messageRecipientId}. Text: ${text.substring(0, 20)}...`);

            // Save Admin Reply to DB
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, // Page is sender
                recipient_id: messageRecipientId, // User is recipient
                message_id: messageId,
                text: text,
                timestamp: Date.now(),
                status: 'sent',
                reply_by: 'admin'
            });

            // Save to AI Context Memory
            const sessionId = `${pageId}_${messageRecipientId}`;
            await dbService.saveChatMessage(sessionId, 'assistant', text, messageId);

            // --- INSTANT EMOJI LOCK CHECK ---
            const pagePrompts = await dbService.getPagePrompts(pageId);
            if (pagePrompts && text) {
                // Normalize Emoji: remove Variation Selector-16 (\uFE0F) and Normalize to NFC
                const normalizeEmojiText = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');
                const cleanText = normalizeEmojiText(text);

                // Build Lock List
                const lockList = [
                    pagePrompts.block_emoji,
                    pagePrompts.lock_emojis,
                    pagePrompts.block_emojis
                ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

                // Build Unlock List
                const unlockList = [
                    pagePrompts.unblock_emoji,
                    pagePrompts.unlock_emojis,
                    pagePrompts.unblock_emojis
                ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

                let isLocked = false;
                let isUnlocked = false;

                // Check Lock (Iterate through list)
                for (const e of lockList) {
                    if (cleanText.includes(e)) {
                        isLocked = true;
                        break;
                    }
                }

                // Check Unlock (Only if not locking)
                if (!isLocked) {
                    for (const e of unlockList) {
                        if (cleanText.includes(e)) {
                            isUnlocked = true;
                            break;
                        }
                    }
                }

                if (isLocked) {
                    await dbService.toggleFbLock(pageId, messageRecipientId, true);
                    console.log(`[Handover] 🔒 ADMIN LOCK: ${messageRecipientId} via Emoji`);
                } else if (isUnlocked) {
                    await dbService.toggleFbLock(pageId, messageRecipientId, false);
                    console.log(`[Handover] 🔓 ADMIN UNLOCK: ${messageRecipientId} via Emoji`);
                }
            }
        } catch (err) {
            console.error(`[Echo Error] Failed to process admin reply:`, err.message);
        }

        return; // STOP Processing
    }
    // ---------------------------------------------------------

    const senderId = event.sender.id;
    const pageId = event.recipient.id || entryPageId; // Always prioritize FB recipient ID for messaging
    console.log(`[Webhook DEBUG] Event for Page: ${pageId} | Sender: ${senderId}`);
    let messageText = event.message?.text || '';
    const messageId = event.message?.mid || `evt_${Date.now()}`;

    // --- EXTRACT AD/REFERRAL DATA ---
    // This handles "Get Started" or "Send Message" clicks from Ads
    let referralData = null;
    if (event.referral) {
        referralData = event.referral;
    } else if (event.postback && event.postback.referral) {
        referralData = event.postback.referral;
    }
    
    if (referralData) {
        const adSource = referralData.source || 'ad';
        const adRef = referralData.ref || 'unknown';
        const adId = referralData.ad_id || 'unknown';
        console.log(`[Webhook] Referral/Ad Detected. Source: ${adSource}, Ref: ${adRef}, Ad ID: ${adId}`);
        
        // Append to text for AI visibility (if not already there)
        // We push this as a separate system note in the buffer logic
    }
    // --------------------------------

    // 1. Handle Postback (Button Clicks)
    if (event.postback) {
        // PRIORITIZE PAYLOAD, THEN TITLE. Ensure it's a string.
        messageText = event.postback.payload || event.postback.title || '';
        if (typeof messageText !== 'string') {
            messageText = JSON.stringify(messageText);
        }
        const logMsg = `[Webhook] Received Postback. Page: ${pageId}, Sender: ${senderId}, Payload: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    } else {
        const logMsg = `[Webhook] Received Message. Page: ${pageId}, Sender: ${senderId}, Text: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    }

    // 2. Handle Attachments (Images & Stickers)
    let hasSticker = false;
    if (event.message?.attachments) {
        // DETECT STICKERS: Facebook sends stickers as images but with a sticker_id
        hasSticker = event.message.attachments.some(att => att.payload && att.payload.sticker_id);
        
        const imageUrls = event.message.attachments
            .filter(att => att.type === 'image' && !att.payload.sticker_id) // ONLY real images (no stickers)
            .map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            console.log(`[Webhook] Image URLs Queued: ${imageUrls.length}`);
        }

        // 3. Handle Audio (Voice Messages) - DEFERRED PROCESSING
        const audioUrls = event.message.attachments
            .filter(att => att.type === 'audio')
            .map(att => att.payload.url);
            
        if (audioUrls.length > 0) {
            console.log(`[Webhook] Audio URLs Queued: ${audioUrls.length}`);
        }

        // Handle other attachments (file, video) placeholders
        const otherAtts = event.message.attachments.filter(att => att.type !== 'image' && att.type !== 'audio');
        if (otherAtts.length > 0) {
             messageText += `\n[User sent attachments: ${otherAtts.map(a => a.type).join(', ')}]`;
        }
    }

    if (!messageText && !event.message?.attachments) return; // Ignore if empty and no attachments

    const replyToId = event.message?.reply_to?.mid || null;

    // --- SAVE USER MESSAGE TO fb_chats (Immediate - Raw) ---
    try {
        let rawLogText = messageText || (hasSticker ? '[Sticker]' : '[Media Message]');
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: senderId,
            recipient_id: pageId,
            message_id: messageId,
            text: rawLogText, 
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user'
        });
    } catch (err) {
        console.error(`Error saving to fb_chats (Page: ${pageId}, Msg: ${messageId}):`, err.message);
    }
    // -------------------------------------------------

    const sessionId = `${pageId}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null });
    }

    const sessionData = debounceMap.get(sessionId);
    
    // Extract URLs for this specific message (STRICTLY EXCLUDING STICKERS)
    const thisMsgImages = event.message?.attachments?.filter(att => 
        att.type === 'image' && !att.payload?.sticker_id
    ).map(att => att.payload.url) || [];
    
    const thisMsgAudios = event.message?.attachments?.filter(att => 
        att.type === 'audio' || 
        (att.type === 'file' && att.payload?.url && /\.(mp3|wav|ogg|m4a|aac|mp4)(\?|$)/i.test(att.payload.url))
    ).map(att => att.payload.url) || [];

    // Push Object
    sessionData.messages.push({
        id: messageId,
        text: messageText,
        reply_to: replyToId,
        images: thisMsgImages,
        audios: thisMsgAudios,
        isSticker: hasSticker, // Mark if this specific message was a sticker
        isPostback: !!event.postback,
        referral: referralData 
    });

    console.log(`Queued message for ${sessionId}. Buffer size: ${sessionData.messages.length}`);
    
    if (sessionData.timer) {
        clearTimeout(sessionData.timer); // Reset timer on new message
    }

    // Dynamic Debounce from DB
    // We need to fetch the wait time. Since we can't await in top level easily without refactoring,
    // we'll fetch it inside the timeout or pre-fetch?
    // Better: Fetch it now, async.
    // NOTE: This adds a small DB read overhead per message.
    // Optimization: Cache this in memory or just accept the slight delay.
    
    const pagePrompts = await dbService.getPagePrompts(pageId);
    let debounceTime = 8000; // Default 8s
    if (pagePrompts && pagePrompts.wait) {
        debounceTime = Number(pagePrompts.wait) * 1000; // Convert sec to ms
    }
    
    // Safety check
    if (debounceTime < 1000) debounceTime = 1000; // Minimum 1s

    console.log(`[Debounce] Using wait time: ${debounceTime}ms for ${sessionId}`);

    sessionData.timer = setTimeout(() => {
        const messagesToProcess = [...sessionData.messages];
        debounceMap.delete(sessionId);
        
        schedulePageTask(pageId, () => processBufferedMessages(sessionId, pageId, senderId, messagesToProcess));
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
    try {
        // Reconstruct Combined Message & Extract Metadata
        let combinedText = "";
        let replyToId = null;
        let allImages = [];
        let allAudios = [];
        let hasPostback = false;
        let adContext = "";

        try {
            const workflowResult = runMessengerWorkflow(messages);
            combinedText = workflowResult.combinedText || "";
            replyToId = workflowResult.replyToId || null;
            allImages = workflowResult.allImages || [];
            allAudios = workflowResult.allAudios || [];
        hasPostback = workflowResult.hasPostback || false;
        adContext = workflowResult.adContext || "";

        const allStickers = messages.filter(m => m.isSticker);
        const hasOnlyStickers = allStickers.length > 0 && 
                                allStickers.length === messages.length && 
                                !combinedText.trim() && 
                                allImages.length === 0 && 
                                allAudios.length === 0;
        
        // --- STICKER GATEKEEPER ---
        if (hasOnlyStickers) {
            const logMsg = `[Sticker Gatekeeper] Blocked sticker-only message for ${sessionId}.`;
            console.log(logMsg);
            logToFile(logMsg);
            return;
        }
        } catch (wfError) {
            console.error(`[Workflow Error] Failed to run messenger workflow: ${wfError.message}`);
            dbService.logError(wfError, 'Webhook Controller - Workflow Execution', { pageId, senderId, messages: messages.length });
            // Fallback: Simple concatenation
            combinedText = messages.map(m => m.text).filter(Boolean).join("\n");
            allImages = messages.flatMap(m => m.images || []);
            allAudios = messages.flatMap(m => m.audios || []);
        }
        
        // --- SAVE USER MESSAGES TO DB (fb_chats) ---
    // Fix: Ensure user messages are saved before any processing/blocking
    for (const msg of messages) {
        try {
            // Skip if it's just a placeholder or empty (unless it has media)
            const hasContent = (msg.text && msg.text.trim()) || 
                               (msg.images && msg.images.length > 0) || 
                               (msg.audios && msg.audios.length > 0);
            
            if (!hasContent) continue;
            
            let msgText = msg.text || "";
            if (msg.images && msg.images.length > 0) {
                msgText += ` [Images: ${msg.images.length}]`;
            }
            if (msg.audios && msg.audios.length > 0) {
                msgText += ` [Audio: ${msg.audios.length}]`;
            }

            // We use a separate try-catch for the DB call to not block the main flow
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: senderId,
                recipient_id: pageId,
                message_id: msg.id,
                text: msgText,
                timestamp: Date.now(),
                status: 'received',
                reply_by: 'user'
            });

            // FIX: Also save to backend_chat_histories for AI Context (Short-Term Memory)
            await dbService.saveChatMessage(sessionId, 'user', msgText);
        } catch (saveErr) {
            // Ignore duplicate key errors, log others
            if (!saveErr.message.includes('unique') && !saveErr.message.includes('duplicate')) {
                console.warn(`[FB] Failed to save user message ${msg.id}: ${saveErr.message}`);
            }
        }
    }
    // -------------------------------------------

    const normalizedForEmojiCheck = combinedText.replace(/\s/g, '');
    const hasAlphaNumericOrBangla = /[A-Za-z0-9\u0980-\u09FF]/.test(normalizedForEmojiCheck);
    const hasQuestionMark = normalizedForEmojiCheck.includes('?');
    const hasMediaContext = allImages.length > 0 || allAudios.length > 0 || !!replyToId;
    if (!hasAlphaNumericOrBangla && !hasQuestionMark && !hasMediaContext && normalizedForEmojiCheck.length > 0) {
        const logMsg = `[Emoji Gatekeeper] Blocked emoji-only message for ${sessionId}.`;
        console.log(logMsg);
        logToFile(logMsg);
        return;
    }

    // If this is a swipe-reply, fetch quoted message text by ID for context
    // REMOVED: This logic is now handled in the main reply generation block to avoid duplication.
    // if (replyToId) { ... }

    console.log(`Processing buffered messages for ${sessionId}. Text: ${combinedText.substring(0,50)}... Images: ${allImages.length}, Audios: ${allAudios.length}`);

        // 1. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        
        console.log("Config fetched:", pageConfig ? "Found" : "Null");
        
        if (!pageConfig) {
            const logMsg = `Page ${pageId} not configured.`;
            console.log(logMsg);
            logToFile(logMsg);
            // Log System Error to DB for visibility
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Page not configured in database.`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }

        // 2. Check Subscription Status (Active/Trial)
        // Note: getPageConfig now returns shared 'message_credit' from user_configs
        const hasCredit = (pageConfig.message_credit > 0);
        const hasOwnKey = (pageConfig.api_key && pageConfig.api_key.length > 5 && pageConfig.cheap_engine === false);
        
        // Allow if they have Credit OR Own Key, regardless of subscription_status (unless banned)
        const isBanned = pageConfig.subscription_status === 'banned';

        if (isBanned || (!hasCredit && !hasOwnKey)) {
             const logMsg = `Page ${pageConfig.page_id} blocked. Status: ${pageConfig.subscription_status}, Credit: ${pageConfig.message_credit}, OwnKey: ${hasOwnKey}`;
             console.log(logMsg);
             logToFile(logMsg);
             // Log System Error to DB for visibility
             await dbService.saveFbChat({
                 page_id: pageId,
                 sender_id: pageId,
                 recipient_id: senderId,
                 message_id: `sys_${Date.now()}`,
                 text: `[SYSTEM ERROR] Blocked (Status: ${pageConfig.subscription_status}, Credit: ${pageConfig.message_credit}). Reply Halted.`,
                 timestamp: Date.now(),
                 status: 'system_error',
                 reply_by: 'system'
             });
             return;
        }
        
        // --- CREDIT CHECK LOGIC (Modified for Cheap Engine vs Own API) ---
        // Default to TRUE (Cheap Engine) if undefined, for backward compatibility
        const isCheapEngine = pageConfig.cheap_engine !== false; 

        if (isCheapEngine) {
            // CHEAP ENGINE: Must have credits
            if (pageConfig.message_credit <= 0) {
                const logMsg = `Page ${pageId} out of credits (Cheap Engine Active). (Source: ${pageConfig.credit_source || 'page_balance'})`;
                console.log(logMsg);
                logToFile(logMsg);
                // Log System Error to DB for visibility
                await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `sys_${Date.now()}`,
                    text: `[SYSTEM ERROR] Out of Credits. Reply Halted.`,
                    timestamp: Date.now(),
                    status: 'system_error',
                    reply_by: 'system'
                });
                return; // STOP Processing
            }
        } else {
            // OWN API: Ignore credit check (Allow even if 0)
            console.log(`Page ${pageId} using Own API. Bypassing credit check.`);
        }
        // -----------------------------------------------------------------

        // --- FAILURE LOCK CHECK ---
        const isLocked = await dbService.checkFbLockStatus(pageId, senderId);
        if (isLocked) {
            const logMsg = `[Handover Lock] AI is permanently disabled for ${senderId} on Page ${pageId}.`;
            console.log(logMsg);
            logToFile(logMsg);
            return;
        }
        // --------------------------

    // --- OPTIMIZATION: PARALLEL DATA FETCHING (Modified for Dynamic History) ---
        // 1. Fetch Page Prompts FIRST to get the 'check_conversion' (History Limit)
        // This ensures we only fetch exactly what the user configured (Token Saving)
        let pagePrompts = null;
        try {
            pagePrompts = await dbService.getPagePrompts(pageId);
            if (pagePrompts) {
                const promptSnippet = pagePrompts.text_prompt ? pagePrompts.text_prompt.substring(0, 100).replace(/\n/g, ' ') : "EMPTY";
                console.log(`[AI Context Check] Page: ${pageId} | Prompt Snippet: "${promptSnippet}..."`);
            } else {
                console.warn(`[AI Context Check] Page: ${pageId} | NO PROMPT FOUND IN DB!`);
            }
        } catch (e) {
            console.warn(`[Webhook] Failed to fetch prompts for ${pageId}:`, e.message);
        }

        // Determine History Limit (User Setting or Default 10)
        // "check_conversion" is the setting for Context Memory Limit (1-50)
        // User Requirement: This limit applies to BOTH text and image memory.
        let historyLimit = 20; // Default safe limit
        if (pagePrompts && pagePrompts.check_conversion) {
            historyLimit = parseInt(pagePrompts.check_conversion, 10);
            if (isNaN(historyLimit) || historyLimit < 1) historyLimit = 20;
        }
        console.log(`[Context] Dynamic History Limit: ${historyLimit} (Source: ${pagePrompts ? 'DB' : 'Default'})`);

        console.log("Fetching remaining context data in parallel...");
        
        // 2. Fetch the rest in parallel using the dynamic limit
        const [userProfile, fbMessages, history] = await Promise.all([
            facebookService.getUserProfile(senderId, pageConfig.page_access_token),
            facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10), // For Handover Check
            dbService.getChatHistory(sessionId, historyLimit)
        ]);

        const senderName = userProfile.name || 'Customer';
        const senderGender = userProfile.gender || null;
        
        // --------------------------------------------

        // --- BATCH PROCESSING: IMAGES & AUDIO ---
        // Now we process all media together BEFORE generating the reply.
        
        // Track Token Usage for Aggregation
        let totalVisionTokens = 0;
        let totalAudioTokens = 0;
        
        // A. Process Images (Vision)
        const allVideos = [];
        const TOO_MANY_IMAGES_THRESHOLD = 10;
        const hasVideo = allVideos.length > 0;
        const tooManyImages = allImages.length > TOO_MANY_IMAGES_THRESHOLD;

        if (hasVideo || tooManyImages) {
             console.log(`[Optimization] Skipping Vision Analysis. Video: ${hasVideo}, Images: ${allImages.length}`);
             const reason = hasVideo ? "User sent a video." : `User sent ${allImages.length} images.`;
             combinedText += `\n[System Note: ${reason} This is too costly/complex to analyze directly. Instead of analyzing these media files, use the Ad Context (Ref/Title) if available, or ask the user to specify which product they are interested in from the post.]`;
        } else if (allImages.length > 0) {
            console.log(`[Batch] Per-message analysis for ${allImages.length} images...`);
            let combinedImageAnalysis = "";

            let productAnalysisPrompt = `Analyze this image with 100% precision. 
STRICT RULES:
1. FOCUS ONLY on the main products in the foreground (e.g., being held in hand or placed at the front). 
2. IGNORE the background products on shelves or blurred items.
3. READ the actual text printed on each foreground product carefully. 
4. Identify the brand and full product name.
5. Output EXACTLY in this Bengali format:
এই ছবিতে মোট **[সংখ্যা]টি** প্রোডাক্ট রয়েছে। প্রোডাক্টগুলোর নাম নিচে দেওয়া হলো:
১. **[প্রোডাক্টের পুরো নাম]** ([পজিশন ও ছোট ভিজ্যুয়াল বিবরণ])
২. ...
এটি মূলত একটি **"[কম্বো বা অফার নাম]"** হিসেবে সাজানো হয়েছে। [একটি ছোট বাক্যে সারসংক্ষেপ]`;

            if (pagePrompts && (pagePrompts.image_prompt || pagePrompts.vision_prompt)) {
                productAnalysisPrompt = pagePrompts.image_prompt || pagePrompts.vision_prompt;
            }

            for (const msg of messages) {
                if (msg.images && msg.images.length > 0) {
                    try {
                        const imagesToAnalyze = msg.images.slice(0, 2);
                        const imagePromises = imagesToAnalyze.map(url =>
                            aiService.processImageWithVision(url, pageConfig, { prompt: productAnalysisPrompt || "", max_tokens: 10000 })
                        );
                        const imageResults = await Promise.all(imagePromises);
                        
                        const perMsgText = imageResults.map((result, index) => {
                            const text = typeof result === 'object' ? (result.text || '') : String(result || '');
                            const usage = typeof result === 'object' ? (result.usage || 0) : 0;
                            totalVisionTokens += usage;
                            return text; // Return raw text, tags added below
                        }).join("\n\n").trim();
                        
                        if (perMsgText) {
                            combinedImageAnalysis += `${perMsgText}\n\n`;
                            // Parallel Save (No await) with specific token count
                            dbService.saveFbChat({
                                page_id: pageId,
                                sender_id: pageId, // Bot (Page) is sender
                                recipient_id: senderId, // User is recipient
                                message_id: `img_analysis_${Date.now()}_${messages.indexOf(msg)}`,
                                text: `[Visual Data]:\n${perMsgText}`,
                                timestamp: Date.now(),
                                status: 'bot_reply',
                                reply_by: 'bot',
                                token: totalVisionTokens, // Specific tokens for vision
                                ai_model: 'gemini-vision'
                            }).catch(e => console.error(`[FB] Failed to save per-message analysis:`, e.message));
                        }
                    } catch (err) {
                        console.error(`[FB] Image Analysis Failed (msg ${msg.id}):`, err.message);
                    }
                }
            }
            if (combinedImageAnalysis) {
                // Unified single block for AI
                combinedText += `\n\n[Visual Content Description]:\n${combinedImageAnalysis.trim()}`;
            } else {
                combinedText += `\n[User sent ${allImages.length} images: ${allImages.join(', ')}]`;
            }
        }

        // B. Process Audio (Voice)
        if (allAudios.length > 0) {
            // Check Feature Flag (default false)
            const audioEnabled = pagePrompts && pagePrompts.audio_detection === true;

            if (audioEnabled) {
                console.log(`[Batch] Transcribing ${allAudios.length} voice messages...`);
                allAudios.forEach((url, i) => console.log(`[Batch] Audio URL [${i}]: ${url}`));

                // Process in parallel
                const audioPromises = allAudios.map(url => aiService.transcribeAudio(url, pageConfig));
                const audioResultsRaw = await Promise.all(audioPromises);
                
                // Extract text and usage
                const audioTranscripts = audioResultsRaw.map((res, i) => {
                    const text = typeof res === 'object' ? (res.text || '') : String(res || '');
                    const usage = typeof res === 'object' ? (res.usage || 0) : 0;
                    totalAudioTokens += usage;
                    console.log(`[Batch] Audio [${i}] Result: "${text.substring(0, 50)}..."`);
                    return text;
                });

                const combinedAudioTranscript = audioTranscripts.join('\n');
                combinedText += `\n\n[System: User sent ${allAudios.length} voice messages. Transcripts follow:]\n${combinedAudioTranscript}`;
                
                try {
                    const audioMsgText = `[Voice Transcript] ${combinedAudioTranscript}`;
                    // Parallel Save (No await) with specific token count
                    dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId, // Bot (Page) is sender
                        recipient_id: senderId, // User is recipient
                        message_id: `audio_transcript_${Date.now()}`,
                        text: audioMsgText,
                        timestamp: Date.now(),
                        status: 'bot_reply',
                        reply_by: 'bot',
                        token: totalAudioTokens, // Specific tokens for audio
                        ai_model: 'google-whisper-style'
                    }).catch(e => console.error(`[FB] Failed to save audio transcript:`, e.message));
                    console.log(`[FB] Scheduled audio transcript save to DB for ${senderId}`);
                } catch (e) {
                    console.error(`[FB] Failed to save audio transcript:`, e.message);
                }
            } else {
                console.log(`[Batch] Audio Detection disabled for page ${pageId}. Skipping.`);
                combinedText += `\n[System Note: User sent ${allAudios.length} voice messages. Audio detection is disabled, so they were not transcribed. Ask the user to type instead.]`;
            }
        }
        
        console.log(`[Batch] Final Context for AI:\n${combinedText}`);
        // ----------------------------------------
        

        // 2. HUMAN HANDOVER & RACE CONDITION CHECK
        console.log("Checking human handover...");
        // fbMessages already fetched in parallel
        
        // 3. Send Typing Indicator
        // Already sent in parallel

        // 4. Get Knowledge Base & Chat History
        // pagePrompts already fetched in parallel
        
        // --- FEATURE FLAGS CHECK ---
        if (pagePrompts) {
            // Check based on message type
            if (hasPostback) {
                // It's a Swipe/Postback
                if (!pagePrompts.swipe_reply) {
                    const logMsg = `[AI] Swipe Reply disabled (swipe_reply=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    // Log to DB
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `sys_${Date.now()}`,
                        text: `[SYSTEM] Swipe Reply Disabled in Settings.`,
                        timestamp: Date.now(),
                        status: 'system_info',
                        reply_by: 'system'
                    });
                    return;
                }
            } else {
                // It's a Text Message
                if (pagePrompts && pagePrompts.reply_message === false) {
                    const logMsg = `[AI] Reply Message disabled (reply_message=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    // Log to DB
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `sys_${Date.now()}`,
                        text: `[SYSTEM] Reply Message Disabled in Settings.`,
                        timestamp: Date.now(),
                        status: 'system_info',
                        reply_by: 'system'
                    });
                    return;
                }
            }
        }

        // Debugging: Log Prompt Info
        if (pagePrompts) {
             const logMsg = `[AI] Loaded Prompts for ${pageId}. Text Prompt: "${pagePrompts.text_prompt?.substring(0, 50)}..."`;
             console.log(logMsg);
             logToFile(logMsg);
        } else {
             const logMsg = `[AI] No Prompts found for ${pageId}. Using Default.`;
             console.log(logMsg);
             logToFile(logMsg);
        }

        // --- FETCH SENDER NAME ---
        // senderName already fetched
        // -------------------------
        
    let effectiveHistory = history;
    // Respect the dynamic history limit fetched above
    if (effectiveHistory.length > historyLimit) {
        effectiveHistory = effectiveHistory.slice(effectiveHistory.length - historyLimit);
    }
    console.log(`[Context] Using last ${effectiveHistory.length} messages (Limit: ${historyLimit})`);

        // --- STOP EMOJI CHECK (Dynamic Logic via Graph API) ---
        // REMOVED: This is now handled permanently via DB status in the echo handling above.
        // ---------------------------------------

        // --- MARK SEEN (Delayed until after Stop Logic) ---
        // MOVED TO TOP (Before typing_on)
        // --------------------------------------------------

        // --- REPLY TO LOGIC ---
        // User Instruction: Try to find old message by message_id from fb_chats first.
        // If not found, try fetching from FB API (Fallback).
        let replyContext = "";
        if (replyToId) {
            let originalText = await dbService.getMessageById(replyToId);
            
            // Fallback: Fetch from Facebook if not in DB
            if (!originalText) {
                console.log(`[Swipe Reply] Message ${replyToId} not found in DB. Fetching from FB...`);
                originalText = await facebookService.getMessageById(replyToId, pageConfig.page_access_token);
            }

            if (originalText) {
                // DETECT IMAGE ANALYSIS CONTEXT
                // Fix: Handle object return from facebookService
                if (typeof originalText === 'object') {
                    originalText = originalText.message || "";
                }

                // If the user is replying to a message that contains "Based on the image",
                // we must explicitly tell the AI that this text IS the image content.
                if (originalText.includes("Based on the image") || originalText.includes("[User sent images:")) {
                    replyContext = `\n[System Note: The user is replying to an image. The AI cannot see the image again, but here is the analysis/description of that image: "${originalText}". Answer the user's question assuming this text is what they are looking at.]\n`;
                } else {
                    replyContext = `\n[User Replying To: "${originalText}"]`;
                }
            }
        }
        
        let productNamesFromPrompt = extractProductNamesFromPrompt(pagePrompts?.text_prompt || "");
        const promptProductMap = {};
        let promptProductContext = "";
        if (productNamesFromPrompt && productNamesFromPrompt.length > 0 && pageConfig && pageConfig.user_id) {
            const lowerCombined = combinedText.toLowerCase();
            const isGreeting = /\b(hi+|hello|hey)\b/.test(lowerCombined);
            productNamesFromPrompt = productNamesFromPrompt.filter(name => {
                if (name.toLowerCase() === 'logo' && !isGreeting) {
                    return false;
                }
                return true;
            });
            if (productNamesFromPrompt.length > 0) {
                const uniqueNames = Array.from(new Set(productNamesFromPrompt));
                for (const rawName of uniqueNames) {
                    const key = rawName.toLowerCase();
                    if (promptProductMap[key]) continue;
                    try {
                        const productsForPrompt = await dbService.searchProducts(pageConfig.user_id, rawName, pageConfig.page_id);
                        if (productsForPrompt && productsForPrompt.length > 0) {
                            promptProductMap[key] = productsForPrompt[0];
                        }
                    } catch (e) {}
                }
                const promptProducts = Object.values(promptProductMap);
                if (promptProducts.length > 0) {
                    promptProductContext = "\n[Instruction Products]\n";
                    promptProducts.forEach((p, i) => {
                        const priceDisplay = p.price ? `${p.price} ${p.currency || 'BDT'}` : 'N/A';
                        const imgDisplay = p.image_url || 'N/A';
                        const descDisplay = p.description ? p.description.replace(/\n/g, ' ').substring(0, 200) : '';
                        if (!p.allow_description) {
                            promptProductContext += `Item ${i + 1}: Image URL: ${imgDisplay}\n`;
                            return;
                        }
                        const descPart = descDisplay ? ` | Desc: ${descDisplay}` : '';
                        promptProductContext += `Item ${i + 1}: ${p.name} | Price: ${priceDisplay} | Image URL: ${imgDisplay}${descPart}\n`;
                    });
                    promptProductContext += "[End of Instruction Products]\n";
                }
            }
        }
        
        const finalUserMessage = `${replyContext}${combinedText}${promptProductContext}`;
        // ------------------------------------

        // 5. Generate AI Reply
        // Use finalUserMessage which includes reply context
        
        // --- INJECT FORMATTING INSTRUCTION (Tool-Driven Product System) ---
        if (pagePrompts && pagePrompts.text_prompt) {
             pagePrompts.text_prompt += `\n\n[PROFESSIONAL OUTPUT RULES]\n` +
                `1) IDENTITY: You are a professional human sales representative. Talk naturally.\n` +
                `2) TOOL-FIRST: If the user asks about product price/details, you MUST call tools. Do NOT invent prices or descriptions.\n` +
                `   - Step A: Call resolve_product with the user's query.\n` +
                `   - Step B: If a single clear candidate is returned, call get_product with product_id.\n` +
                `   - Step C: For final price, call compute_offer_price with line_items.\n` +
                `3) IMAGE REQUEST: If the user asks for a photo/picture, include image_url from get_product in reply.\n` +
                `4) LISTING PRODUCTS: If asked "What do you sell?", list 3-5 names from the [Inventory List] naturally and ask which one they are interested in.\n` +
                `5) NO HALLUCINATIONS: Never guess or invent prices. Always use tool data only.\n`;
        }
        // --------------------------------------------------------------------
        // --------------------------------------------------------------------

        const aiResponse = await aiService.generateResponse({
            pageId: pageId,
            userId: senderId,
            userMessage: finalUserMessage,
            history: effectiveHistory,
            imageUrls: [], // imageUrls (Already processed)
            audioUrls: [], // audioUrls (Already processed)
            config: pageConfig,
            platform: 'messenger',
            extraTokenUsage: totalVisionTokens + totalAudioTokens,
            senderName: senderName
        });
        
        if (aiResponse == null) {
             console.error(`[Webhook] AI generation failed or returned NULL for ${senderId}. No response sent to user.`);
             
             // Log Error to DB but DO NOT send fallback message to user
             await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `fail_${Date.now()}`,
                text: `[AI Error] Response was NULL/Empty. Silently ignored to prevent bad UX.`,
                timestamp: Date.now(),
                status: 'ai_ignored',
                reply_by: 'bot'
            });
             return;
        }

        let replyText = aiResponse.reply || "";

        // --- NEW PROFESSIONAL TAG PROCESSOR (PRODUCT_ID) ---
        // Robust check for the tag, allowing for variations in spacing and quotes
        if (/\[PRODUCT_ID\s*:\s*/i.test(replyText)) {
            // Loose regex to capture whatever is inside the tag
            const productTagRegex = /\[PRODUCT_ID\s*:\s*["']?\s*([^"\]\s']+)["']?\s*\]/gi;
            
            const matches = [...replyText.matchAll(productTagRegex)];
            const uniqueTags = new Set(matches.map(m => m[0]));

            for (const fullTag of uniqueTags) {
                const match = matches.find(m => m[0] === fullTag);
                const productId = match[1].trim().replace(/["']/g, ''); // Extra cleanup for quotes

                try {
                    // Fetch product by exact ID
                    const product = await dbService.getProductById(productId);
                    if (product) {
                        const numericPrice = parsePrice(product.price);
                        let priceDisplay = numericPrice > 0 ? `${numericPrice} ${product.currency || 'BDT'}` : "Ask for Price";
                        const description = product.description || "No description available.";

                        // Prepare replacement text
                        const replacementText = `\n\n🛍️ *${product.name}*\n💰 Price: ${priceDisplay}\n📝 Details: ${description}`;
                        
                        // Replace all occurrences of this exact tag string
                        replyText = replyText.split(fullTag).join(replacementText);

                        // Image attachment logic
                        const historyText = getHistoryText(effectiveHistory);
                        const imageAlreadySent = historyText.includes(product.image_url);
                        const userWantsPhoto = hasPhotoIntent(effectiveHistory);

                        if ((!imageAlreadySent || userWantsPhoto) && product.image_url) {
                            if (!aiResponse.images) aiResponse.images = [];
                            if (!aiResponse.images.some(img => img.url === product.image_url)) {
                                aiResponse.images.push({
                                    url: product.image_url,
                                    title: product.name,
                                    description: description
                                });
                            }
                        }
                    } else {
                        console.warn(`[TagProcessor] Product ID "${productId}" not found in DB.`);
                        // If not found, we still remove the tag but show a clean "not found" message
                        replyText = replyText.split(fullTag).join(`\n(Product info currently unavailable)`);
                    }
                } catch (err) {
                    console.error(`[TagProcessor] Error for ID ${productId}:`, err);
                }
            }
        }
        // -----------------------------------------------------

        const normalizeBanglaDigits = (value) => {
            if (!value) return '';
            const map = { 
                '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9',
                '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' // Arabic Digits
            };
            return String(value).replace(/[০-৯٠-٩]/g, d => map[d] || d);
        };

        const normalizeBdPhone = (value) => {
            if (!value) return null;
            const normalized = normalizeBanglaDigits(value);
            const digits = normalized.replace(/\D/g, '');
            const candidate = digits.length > 11 ? digits.slice(-11) : digits;
            if (candidate.length === 11 && candidate.startsWith('01')) return candidate;
            return null;
        };

        const extractSaveOrderTag = (replyText) => {
            if (!replyText || typeof replyText !== 'string') return null;
            const match = replyText.match(/\[SAVE_ORDER:\s*({[\s\S]*?})\]/);
            if (!match || !match[1]) return null;
            try {
                return JSON.parse(match[1]);
            } catch (e) {
                console.warn(`[Order] Failed to parse SAVE_ORDER JSON: ${e.message}`);
                return null;
            }
        };

        const getHistoryText = (historyList) => {
            if (!Array.isArray(historyList)) return '';
            return historyList
                .map(item => {
                    let content = '';
                    if (!item) return '';
                    if (typeof item === 'string') content = item;
                    else if (typeof item.content === 'string') content = item.content;
                    else if (typeof item.text === 'string') content = item.text;
                    else if (item.message && typeof item.message.content === 'string') content = item.message.content;
                    else if (item.message && typeof item.message.text === 'string') content = item.message.text;
                    
                    if (!content) return '';

                    // --- SMART CLEAN INTERNAL NOISE FROM HISTORY ---
                    // Instead of deleting everything, we strip out the "pollution" (long URLs and Descs)
                    // but keep the core info (Product Name, Price) for the regex to find.
                    return content
                        .replace(/Image URL: https?:\/\/[^\s|]+/gi, '(Image)') // Shorten long URLs
                        .replace(/Desc: [\s\S]*?(?=\||\[End|$)/gi, '') // Remove long internal descriptions
                        .replace(/\[Instruction Products\]/gi, '') // Remove start marker
                        .replace(/\[End of Instruction Products\]/gi, '') // Remove end marker
                        .replace(/\[SAVE_ORDER:[\s\S]*?\]/gi, '') // Remove raw JSON
                        .replace(/##product/gi, '')
                        .trim();
                })
                .filter(Boolean)
                .join('\n');
        };

        const extractHistoryOrder = (historyText) => {
            const cleanedText = String(historyText || '')
                .replace(/\*\*/g, '')
                .replace(/[*_`]/g, '')
                .replace(/[•·]/g, ' ')
                .trim();
            const flatText = cleanedText.replace(/\s+/g, ' ').trim();
            const normalized = normalizeBanglaDigits(cleanedText);

            // 1. PRODUCT NAME EXTRACTION
            // Priority: Explicit mention -> AI suggestion in history -> Recovered
            const productMatch = flatText.match(/(?:পণ্যের নাম|প্রোডাক্টের নাম|পণ্য|আইটেম|প্রোডাক্ট|product name|product|item)\s*[:ঃ-]?\s*([^\n,।|]+)/i);
            
            // 2. QUANTITY EXTRACTION
            const qtyMatch = normalized.match(/(?:কোয়ান্টিটি|quantity|qty|পরিমাণ)\s*[:ঃ-]?\s*([০-৯\d]+|এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট|নয়|দশ)\s*(পিস|টা|টি|বোতল)?/i);
            const unitMatch = normalized.match(/(\d+)\s*(পিস|টা|টি|বোতল)/i);
            
            // 3. PRICE EXTRACTION
            const totalMatch = normalized.match(/(?:মোট মূল্য|total price|total)\s*[:ঃ-]?\s*([\d,]+)\s*(টাকা|tk|bdt)?/i);
            const priceMatch = normalized.match(/(?:পণ্যের মূল্য|price|amount|মূল্য|দাম)\s*[:ঃ-]?\s*([\d,]+)\s*(টাকা|tk|bdt)?/i);
            
            // 4. CUSTOMER NAME
            const nameMatch = flatText.match(/(?:নাম|customer name|name)\s*[:ঃ-]?\s*([^\n,।|]+)/i);
            
            // 5. LOCATION/ADDRESS
            const addrKeywords = ['ঠিকানা','জেলা','থানা','গ্রাম','পোস্ট','বাড়ি','রোড','বাসা','উপজেলা','বিভাগ','ইউনিয়ন','বাজার','এলাকা','address'];
            const addressLines = cleanedText
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && addrKeywords.some(k => l.includes(k)))
                // Filter out any lines that still contain internal tags just in case
                .filter(l => !l.includes('[Instruction') && !l.includes('IMAGE:'));
            
            const location = addressLines.join(' ').trim();
            const bnNumberMap = { এক: '1', দুই: '2', তিন: '3', চার: '4', পাঁচ: '5', ছয়: '6', সাত: '7', আট: '8', নয়: '9', দশ: '10' };
            
            let qtyValue = '';
            let qtyUnit = '';
            if (qtyMatch) {
                qtyValue = bnNumberMap[qtyMatch[1]] || qtyMatch[1];
                qtyUnit = qtyMatch[2] || '';
            } else if (unitMatch) {
                qtyValue = unitMatch[1];
                qtyUnit = unitMatch[2] || '';
            }
            const quantity = qtyValue ? `${qtyValue}${qtyUnit ? ` ${qtyUnit}` : ''}`.trim() : '';
            
            const priceRaw = totalMatch ? totalMatch[1] : (priceMatch ? priceMatch[1] : null);
            const price = priceRaw ? String(priceRaw).replace(/,/g, '') : null;

            return {
                product_name: productMatch ? productMatch[1].trim() : '',
                quantity,
                price,
                location,
                name: nameMatch ? nameMatch[1].trim() : ''
            };
        };

        // --- ZERO COST ORDER TRACKING LOGIC ---
        // If AI detects order details, save to DB immediately.
        // This uses the SAME AI call, so ZERO extra cost.
        let orderSaved = false;
        const saveOrderPayload = aiResponse.order_details || extractSaveOrderTag(aiResponse.reply);
        
        // AI DATA EXTRACTION (New Logic: AI detects Name, Phone, Address naturally)
        if (saveOrderPayload && (saveOrderPayload.phone || saveOrderPayload.number || saveOrderPayload.address || saveOrderPayload.location)) {
             const extracted = saveOrderPayload;
             console.log(`[Order] AI extracted data: ${JSON.stringify(extracted)}`);
             
             let customerNumber = normalizeBdPhone(extracted.phone || extracted.number || extracted.mobile);
             
             // Smart Save: If we have at least a number OR a name/address, attempt save
             if (customerNumber || extracted.address || extracted.location || extracted.name) {
                 await dbService.saveOrderTracking({
                     page_id: pageId,
                     sender_id: senderId,
                     product_name: extracted.product_name || 'Recovered Lead',
                     number: customerNumber || null, 
                     location: extracted.address || extracted.location || '',
                     product_quantity: extracted.quantity || '1',
                     price: extracted.price || null,
                     sender_number: senderId
                 });
                 orderSaved = true;
             }
        }

        if (!orderSaved) {
            const normalizedCombined = normalizeBanglaDigits(combinedText);
            const phoneMatch = normalizedCombined.match(/(?:\+?88)?(01[3-9]\d{8})/g);
            const fallbackNumber = phoneMatch ? normalizeBdPhone(phoneMatch[0]) : null;

            // ONLY save if we have a number in the current message OR if it's a known user with a previous order
            if (fallbackNumber) {
                // 1. Get History Context for fallback parsing
                const historyText = getHistoryText(effectiveHistory);
                const historyOrder = extractHistoryOrder(historyText);

                // 2. Extract Info from CURRENT message (Highest Priority)
                const addrKeywords = ['ঠিকানা','নাম','জেলা','থানা','গ্রাম','পোস্ট','বাড়ি','রোড','বাসা','উপজেলা','বিভাগ','ইউনিয়ন','বাজার','এলাকা','address'];
                const addressLines = combinedText
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l && addrKeywords.some(k => l.includes(k)));
                const currentAddress = addressLines.join(' ').trim();
                
                const nameMatch = combinedText.match(/(?:নাম|name)\s*[:ঃ-]?\s*([^\n,।|]+)/i);
                const currentName = nameMatch ? nameMatch[1].trim() : '';
                
                const qtyMatch = normalizedCombined.match(/(এক|দুই|তিন|চার|পাঁচ|\d+)\s*(বোতল|পিস|টা|টি)/);
                const currentQty = qtyMatch ? qtyMatch[0] : '';

                // 3. MERGE Current Info with History Info (Fallback)
                const finalName = currentName || historyOrder.name || '';
                const finalAddress = currentAddress || historyOrder.location || '';
                
                const locationParts = [];
                if (finalName) locationParts.push(`নাম: ${finalName}`);
                if (finalAddress) locationParts.push(finalAddress);
                const fallbackLocation = locationParts.join(' | ') || 'N/A';
                
                const finalQuantity = currentQty || historyOrder.quantity || '1';
                
                // For product name: Priority 1 (AI detection above), Priority 2 (History Parsing)
                let finalProduct = historyOrder.product_name || 'Recovered Lead';
                
                // Clean product name if it was picked up from a polluted source
                if (finalProduct.includes('|')) {
                    finalProduct = finalProduct.split('|')[0].trim();
                }
                finalProduct = finalProduct.replace(/Item \d+:/gi, '').replace(/##product/gi, '').replace(/"/g, '').trim();

                const finalPrice = historyOrder.price || null;

                await dbService.saveOrderTracking({
                    page_id: pageId,
                    sender_id: senderId,
                    product_name: finalProduct,
                    number: fallbackNumber,
                    location: fallbackLocation,
                    product_quantity: finalQuantity,
                    price: finalPrice,
                    sender_number: senderId
                });
                orderSaved = true;
            }
        }
        // --------------------------------------

        // 6. Send Reply (Text + Images)
        if (replyText && typeof replyText === 'object') {
            if (replyText.reply) {
                replyText = String(replyText.reply);
            } else {
                replyText = '';
            }
        }
        
        let decisionMode = null;
        if (replyText && typeof replyText === 'string') {
            const decision = extractDecisionMode(replyText);
            decisionMode = decision.mode;
            replyText = decision.cleaned;
        }

        const originalReply = replyText;

        if (replyText == null) {
            replyText = '';
        } else {
            replyText = String(replyText);
        }

        // --- JSON & ERROR HANDLING (Commercial Grade) ---
        // 1. Attempt to Rescue JSON (Moved BEFORE block check)
        if (replyText && (replyText.trim().startsWith('{') || replyText.trim().startsWith('['))) {
            const trimmed = replyText.trim();
            // Robust check: Is it likely JSON? (Contains " : " and " " ")
            const isLikelyJson = (trimmed.includes('"') && trimmed.includes(':')) || trimmed.includes('{}');
            
            if (isLikelyJson) {
                try {
                    // Remove Markdown code blocks if present (```json ... ```)
                    const cleanJson = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    
                    // Extract useful text from common JSON fields
                    if (parsed.reply_text) replyText = parsed.reply_text;
                    else if (parsed.reply) replyText = parsed.reply;
                    else if (parsed.message) replyText = parsed.message;
                    else if (parsed.text) replyText = parsed.text;
                    else if (parsed.answer) replyText = parsed.answer;
                    else if (parsed.content) replyText = parsed.content;
                    
                    console.log(`[JSON Rescuer] Successfully extracted text from JSON: "${replyText.substring(0, 50)}..."`);
                } catch (e) {
                    console.warn(`[JSON Rescuer] Failed to parse JSON: ${e.message}. Content: ${replyText.substring(0, 20)}...`);
                    // If parsing fails, we treat it as potentially harmful raw code.
                    // We will LOG it for Admin but NOT send it to User.
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: pageId,
                        recipient_id: senderId,
                        message_id: `fail_${Date.now()}`,
                        text: `[AI Error - Silent] Raw JSON/Code Blocked: ${replyText}`,
                        timestamp: Date.now(),
                        status: 'ai_ignored',
                        reply_by: 'bot'
                    });
                    replyText = ''; // SILENCE
                }
            } else {
                // Not likely JSON, just bracketed text like "[Image of...]"
                // Let it pass through to the text handling logic below.
                console.log(`[JSON Rescuer] Skipping non-JSON bracketed text: "${replyText.substring(0, 20)}..."`);
            }
        }

        if (replyText && typeof replyText === 'string') {
            const extracted = extractImageUrlsFromText(replyText);
            replyText = sanitizeReplyText(extracted.cleanText);
            if (extracted.urls.length > 0) {
                if (!aiResponse.images) aiResponse.images = [];
                extracted.urls.forEach(url => {
                    if (!aiResponse.images.some(img => (typeof img === 'string' ? img : img.url) === url)) {
                        aiResponse.images.push({ url: url, title: 'Product Image' });
                    }
                });
            }
        }

        if (hasPhotoIntent(effectiveHistory)) {
            let targetProductId = null;
            const state = await dbService.getConversationState(pageId, senderId);
            if (state && state.last_product_id) targetProductId = state.last_product_id;
            if (!targetProductId && aiResponse.product_id) targetProductId = aiResponse.product_id;
            if (targetProductId) {
                const product = await dbService.getProductById(targetProductId);
                if (product && product.image_url) {
                    const primaryUrl = normalizeImageUrl(product.image_url);
                    const additional = Array.isArray(product.additional_images)
                        ? product.additional_images.map(normalizeImageUrl).filter(Boolean)
                        : [];
                    const urls = [primaryUrl, ...additional].filter(Boolean);
                    aiResponse.images = urls.map((url, idx) => ({
                        url,
                        title: product.name || (idx === 0 ? 'Product Image' : `Product Image ${idx + 1}`),
                        description: product.description || ''
                    }));
                }
            }
        }

        if (replyText && shouldBlockOutgoingReply(replyText)) {
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `fail_${Date.now()}`,
                text: `[Blocked Internal Error] ${replyText}`,
                timestamp: Date.now(),
                status: 'ai_ignored',
                reply_by: 'bot'
            });
            replyText = '';
        }

        // 2. Suppress Known Error Patterns (Strict Commercial Quality)
        // Never show "AI Error", "null", "undefined" or technical jargon to customers.
        const forbiddenPatterns = [
            '\\[AI Error', 
            'JSON reply blocked', 
            'Error:', 
            'undefined',
            '\\[System Error\\]',
            '429 status code', 
            'no body',         
            'status code'      
        ];

        if (replyText) {
            for (const pattern of forbiddenPatterns) {
                try {
                    const regex = new RegExp(pattern, 'i');
                    if (regex.test(replyText)) {
                        console.log(`[Quality Control] Blocked internal error text matching: "${pattern}"`);
                        // Log for Admin
                        await dbService.saveFbChat({
                            page_id: pageId,
                            sender_id: pageId,
                            recipient_id: senderId,
                            message_id: `fail_${Date.now()}`,
                            text: `[Blocked Internal Error] ${replyText}`,
                            timestamp: Date.now(),
                            status: 'ai_ignored',
                            reply_by: 'bot'
                        });
                        replyText = ''; // SILENCE
                        break;
                    }
                } catch (reErr) {
                    // Fallback to simple includes if regex fails
                    if (replyText.toLowerCase().includes(pattern.toLowerCase().replace(/\\/g, ''))) {
                        replyText = '';
                        break;
                    }
                }
            }
            // Special check for literal 'null' as a word, not as a substring
            if (replyText && /\bnull\b/i.test(replyText)) {
                 console.log(`[Quality Control] Blocked literal 'null' in reply.`);
                 await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `fail_${Date.now()}`,
                    text: `[Blocked Internal Error] ${replyText}`,
                    timestamp: Date.now(),
                    status: 'ai_ignored',
                    reply_by: 'bot'
                });
                replyText = '';
            }
        }

        // 3. Final Empty Check
        if (!replyText || replyText.trim() === '' || replyText === 'null') {
            replyText = ''; // Ensure it's empty string
            
            // If we also have no images, this is a SILENT event.
            if (!aiResponse.images || aiResponse.images.length === 0) {
                 console.log(`[AI Silence] No text and no images. Staying silent.`);
                 // We already logged the error above if it was a block. 
                 // If it was just natural silence (function call), we do nothing.
                 return; // STOP HERE. Do not send anything to FB.
            }
        }


        if (replyText && pagePrompts) {
            const normalizeEmojiText = (str) => (str || '').replace(/\uFE0F/g, '').normalize('NFC');
            const cleanText = normalizeEmojiText(replyText);

            const lockList = [
                pagePrompts.block_emoji,
                pagePrompts.lock_emojis,
                pagePrompts.block_emojis
            ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

            const unlockList = [
                pagePrompts.unblock_emoji,
                pagePrompts.unlock_emojis,
                pagePrompts.unblock_emojis
            ].filter(Boolean).join(',').split(/[, ]+/).map(e => normalizeEmojiText(e.trim())).filter(e => e);

            let isLocked = false;
            let isUnlocked = false;

            for (const e of lockList) {
                if (cleanText.includes(e)) {
                    isLocked = true;
                    break;
                }
            }

            if (!isLocked) {
                for (const e of unlockList) {
                    if (cleanText.includes(e)) {
                        isUnlocked = true;
                        break;
                    }
                }
            }

            if (isLocked) {
                await dbService.toggleFbLock(pageId, senderId, true);
                console.log(`[Handover] 🔒 BOT LOCK: ${senderId} via Emoji`);
            } else if (isUnlocked) {
                await dbService.toggleFbLock(pageId, senderId, false);
                console.log(`[Handover] 🔓 BOT UNLOCK: ${senderId} via Emoji`);
            }
        }

        if (replyText && promptProductMap) {
            const products = Object.values(promptProductMap)
                .map(p => ({ ...p, _lowerName: (p.name || '').toLowerCase() }))
                .filter(p => p._lowerName);
            products.sort((a, b) => b._lowerName.length - a._lowerName.length);

            const pricePlaceholderRegex = /\[(price|Check for exact price|Price not available in inventory list)\]/gi;
            const descPlaceholderRegex = /\[(description|Get detailed description|Description not available in inventory list)\]/gi;

            let currentProduct = null;
            const lines = replyText.split('\n').map(line => {
                const lowerLine = line.toLowerCase();
                const matched = products.find(p => lowerLine.includes(p._lowerName));
                if (matched) currentProduct = matched;

                if (currentProduct) {
                    if (pricePlaceholderRegex.test(line)) {
                        const priceText = currentProduct.price
                            ? `${currentProduct.price} ${currentProduct.currency || 'BDT'}`
                            : 'Ask for Price';
                        line = line.replace(pricePlaceholderRegex, priceText);
                    }
                    if (descPlaceholderRegex.test(line)) {
                        const descText = currentProduct.description || 'No description available.';
                        line = line.replace(descPlaceholderRegex, descText);
                    }
                }
                return line;
            });
            replyText = lines.join('\n');
        }

        // --- SMART IMAGE EXTRACTION & CLEANING ---
        if (!aiResponse.images) aiResponse.images = [];
        
        // --- NEW: Add images from structured image_urls array (Professional JSON mode) ---
        if (Array.isArray(aiResponse.image_urls)) {
            aiResponse.image_urls.forEach(url => {
                if (url && typeof url === 'string' && url.startsWith('http')) {
                    if (!aiResponse.images.some(img => (typeof img === 'string' ? img : img.url) === url)) {
                        aiResponse.images.push({ url: url, title: 'Product Image' });
                    }
                }
            });
        }

        // Start with existing images from AI Service (normalize strings to objects)
        let extractedImages = aiResponse.images.map(img => {
            if (typeof img === 'string') return { url: img, title: 'Product Image' };
            return img;
        }); 

        // VALIDATION: Filter out hallucinated external URLs (e.g. ibb.co) that are not in our system
        // We only allow:
        // 1. URLs from our own domain (local storage)
        // 2. URLs that exactly match a product's image_url from the promptProductMap
        // 3. URLs that are FB CDN (from user attachments) - though usually we don't send those back as products
        
        const baseUrlForImages = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
        const normalizeImageUrl = (url) => {
            if (!url || url === 'N/A') return null;
            if (url.startsWith('http')) return url;
            const cleanPath = url.startsWith('/') ? url : `/${url}`;
            return `${baseUrlForImages.replace(/\/$/, '')}${cleanPath}`;
        };

        const validProductUrls = new Set();
        if (promptProductMap) {
            Object.values(promptProductMap).forEach(p => {
                if (p.image_url) {
                    validProductUrls.add(p.image_url);
                    const normalized = normalizeImageUrl(p.image_url);
                    if (normalized) validProductUrls.add(normalized);
                }
            });
        }
        // Add images found by AI during the AgentLoop
        if (aiResponse.foundProducts && Array.isArray(aiResponse.foundProducts)) {
            aiResponse.foundProducts.forEach(p => {
                if (p.image_url) {
                    validProductUrls.add(p.image_url);
                    const normalized = normalizeImageUrl(p.image_url);
                    if (normalized) validProductUrls.add(normalized);
                }
            });
        }

        const normalizedProductNames = Object.keys(promptProductMap || {});

        if (normalizedProductNames.length > 0 && replyText) {
            const lowerReply = replyText.toLowerCase();
            
            // 1. GREETING PROTECTION: If reply is too short, skip auto-injection (Only tags allowed)
            // This prevents image leaks on "Hi", "Hello" etc.
            const isShortGreeting = replyText.length < 30 && /^(hi|hello|hey|সালাম|হ্যালো|নমস্কার|জ্বি|কিভাবে)/i.test(replyText);
            
            // 2. TAG-BASED EXTRACTION (Highest Priority)
            const tagRegex = /##PRODUCT\s*["'](.+?)["']/gi;
            let tagMatch;
            const mentionedViaTag = new Set();
            while ((tagMatch = tagRegex.exec(replyText)) !== null) {
                mentionedViaTag.add(tagMatch[1].toLowerCase());
            }

            normalizedProductNames.forEach(name => {
                const product = promptProductMap[name];
                if (!product || !product.image_url) return;
                
                const lowerName = name.toLowerCase();
                const isExplicitlyTagged = mentionedViaTag.has(lowerName);
                
                // FIX: Only inject if there's an EXPLICIT tag (##PRODUCT). 
                // Natural mention matching is disabled to prevent image leaks on greetings or casual talk.
                const shouldInject = isExplicitlyTagged;

                if (shouldInject) {
                    // Add Primary Image
                    let primaryUrl = product.image_url;
                    if (!/^https?:\/\//i.test(primaryUrl)) {
                        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                        primaryUrl = `${baseUrl.replace(/\/$/, '')}/${primaryUrl.replace(/^\/+/, '')}`;
                    }

                    if (!extractedImages.some(img => img.url === primaryUrl)) {
                        extractedImages.push({ url: primaryUrl, title: product.name || name, description: product.description || '' });
                    }

                    // Add Additional Images
                    if (product.additional_images && Array.isArray(product.additional_images)) {
                        product.additional_images.forEach((url, idx) => {
                            let additionalUrl = url;
                            if (!/^https?:\/\//i.test(additionalUrl)) {
                                const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                                additionalUrl = `${baseUrl.replace(/\/$/, '')}/${additionalUrl.replace(/^\/+/, '')}`;
                            }
                            if (!extractedImages.some(img => img.url === additionalUrl)) {
                                extractedImages.push({ url: additionalUrl, title: `${product.name || name} (Pic ${idx + 2})`, description: product.description || '' });
                            }
                        });
                    }
                }
            });

            // 3. CLEANUP: Remove tags from the final text
            replyText = replyText.replace(tagRegex, '').trim();
        }

        // 1. BROKEN IMAGE TAG RECOVERY: IMAGE: Title | (missing URL)
        if (replyText) {
            const brokenTagRegex = /IMAGE:\s*([^|]+?)\s*\|\s*(?=\s|$)/gi;
            let brokenMatch;
            brokenTagRegex.lastIndex = 0;
            const seenBrokenTags = new Set();

            while ((brokenMatch = brokenTagRegex.exec(replyText)) !== null) {
                const fullMatch = brokenMatch[0];
                const productName = brokenMatch[1].trim();
                
                // Prevent infinite loop if we already tried to fix this specific string
                if (seenBrokenTags.has(fullMatch)) continue;
                seenBrokenTags.add(fullMatch);

                try {
                    const products = await dbService.searchProducts(pageConfig.user_id, productName, pageId);
                    if (products && products.length > 0) {
                        const product = products[0];
                        const fullImgUrl = normalizeImageUrl(product.image_url);
                        if (fullImgUrl) {
                            // Use split/join to replace ALL identical broken tags at once safely
                            replyText = replyText.split(fullMatch).join(`IMAGE: ${product.name} | ${fullImgUrl}`);
                            console.log(`[Image Recovery] Fixed broken tag for: ${product.name}`);
                            validProductUrls.add(fullImgUrl);
                            if (product.image_url) validProductUrls.add(product.image_url);
                        }
                    }
                } catch (err) {
                    console.warn(`[Image Recovery] Failed for "${productName}": ${err.message}`);
                }
            }
        }

        if (
            replyText &&
            aiResponse.foundProducts &&
            Array.isArray(aiResponse.foundProducts) &&
            aiResponse.foundProducts.length > 0
        ) {
            const p = aiResponse.foundProducts[0];
            if (replyText.includes('[Price not available in inventory list]')) {
                const priceText = p.price ? `${p.price} ${p.currency || 'BDT'}` : 'Ask for Price';
                replyText = replyText.replace(/\[Price not available in inventory list\]/gi, priceText);
            }
            if (replyText.includes('[Description not available in inventory list]')) {
                const descText = p.description || 'No description available.';
                replyText = replyText.replace(/\[Description not available in inventory list\]/gi, descText);
            }
        }

        // 2. STRICT FORMAT: IMAGE: Title | URL
        // Matches: IMAGE: Basic Plan | https://...
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        let strictMatch;
        while ((strictMatch = strictImageRegex.exec(replyText)) !== null) {
            const fullMatch = strictMatch[0];
            const title = strictMatch[1].trim();
            let url = strictMatch[2].trim();
            
            // Remove trailing punctuation (comma, dot) if accidentally matched
            url = url.replace(/[,.]$/, '');

            // Allow any image URL (local or remote)
            const isImage = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);
            
            // STRICT VALIDATION: Check if this URL is known
            // If it's a hallucinated URL (not in our product map and not our domain), block it.
            const isKnownProduct = validProductUrls.has(url);
            const isLocal = url.includes(process.env.PUBLIC_BASE_URL || 'localhost');
            const isFbCdn = url.includes('fbcdn.net') || url.includes('cdn.fbsbx.com'); // Allow user images if echoed
            const isTrustedStorage = url.includes('supabase.co'); // Whitelist Supabase
            
            // If it's an external link (like ibb.co) and NOT in our product list, it's likely a hallucination.
            const isSuspicious = !isKnownProduct && !isLocal && !isFbCdn && !isTrustedStorage;

            if (isImage && !isSuspicious) {
                if (!extractedImages.some(img => img.url === url)) {
                    // Try to find product description if this is a known product URL
                    let description = '';
                    if (isKnownProduct && promptProductMap) {
                        const product = Object.values(promptProductMap).find(p => p.image_url === url);
                        if (product) description = product.description || '';
                    }
                    extractedImages.push({ url: url, title: title, description: description });
                }
                // Only remove from text if it's a Supabase link. 
                // For all other links, keep them in the text so the customer can click them.
                if (url.includes('supabase.co')) {
                    replyText = replyText.replace(fullMatch, '').trim();
                } else {
                    replyText = replyText.replace(fullMatch, `${title}: ${url}`).trim();
                }
            } else if (isSuspicious) {
                 // If it's suspicious, we still keep it as text unless it's a known internal storage link
                 if (url.includes('supabase.co')) {
                    console.log(`[Image Extraction] Removing internal Supabase link: ${url}`);
                    replyText = replyText.replace(fullMatch, '').trim();
                 } else {
                    console.log(`[Image Extraction] Keeping "suspicious" link as text: ${url}`);
                    // Replace the IMAGE: tag with just the URL to keep it readable
                    replyText = replyText.replace(fullMatch, `${title}: ${url}`).trim();
                 }
            } else {
                // Non-Image URLs stay as normal text
                console.log(`[Image Extraction] Keeping non-Image URL as text: ${url}`);
                replyText = replyText.replace(fullMatch, `${title}: ${url}`).trim();
            }
        }

        // -----------------------------------------------------

        // --- AGENTIC DELIVERY SYSTEM (BACKEND-DRIVEN) ---
        if (aiResponse.action && aiResponse.action !== "NONE" && aiResponse.product_id) {
            try {
                const product = await dbService.getProductById(aiResponse.product_id);
                if (product) {
                    if (aiResponse.action === "SEND_DETAILS" || aiResponse.action === "SEND_BOTH") {
                        // Backend only appends details if AI explicitly asks for it AND hasn't already included it.
                        // However, per user request, we now give AI full control over description length.
                        // If AI already wrote a reply, we assume it handled the description as per its prompt.
                        // We only append if replyText is very short (fallback).
                        if (!replyText || replyText.length < 50) {
                            const numericPrice = parsePrice(product.price);
                            const priceDisplay = numericPrice > 0 ? `${numericPrice} ${product.currency || 'BDT'}` : "Ask for Price";
                            const details = `🛍️ *${product.name}*\n💰 Price: ${priceDisplay}\n📝 Info: ${product.description || 'No details available.'}`;
                            replyText = `${replyText}\n\n${details}`;
                        }
                    }

                    if ((aiResponse.action === "SEND_PHOTO" || aiResponse.action === "SEND_BOTH") && product.image_url) {
                        if (!aiResponse.images) aiResponse.images = [];
                        if (!aiResponse.images.some(img => img.url === product.image_url)) {
                            aiResponse.images.push({
                                url: product.image_url,
                                title: product.name,
                                description: product.description || ''
                            });
                        }
                    }
                }
            } catch (err) {
                console.error(`[Agentic Delivery] Failed for ID ${aiResponse.product_id}:`, err.message);
            }
        }

        // --- DEDUPLICATION LOGIC REMOVED (User Request) ---
        // We now rely entirely on the System Prompt / AI to decide whether to send an image or not.
        // If the AI outputs "IMAGE: ...", we send it.
        // --------------------------------------------------

        // --- SMART EXTRACTION & DEDUPLICATION ---
        aiResponse.images = extractedImages;

        // Ensure images are also deduplicated against what's already being sent
        if (aiResponse.images && aiResponse.images.length > 0) {
            const uniqueUrls = new Set();
            aiResponse.images = aiResponse.images.filter(img => {
                if (!img.url || uniqueUrls.has(img.url)) return false;
                uniqueUrls.add(img.url);
                return true;
            });
        }
        // ----------------------------------------

        const promptMode = decisionMode || detectImageMode(pagePrompts?.text_prompt);
        // FIX: NEVER wipe out text unless it's strictly requested. 
        // If there's an image, we still want to keep the text (price/details).
        if (promptMode === 'image_only' && aiResponse.images.length > 0 && (!replyText || replyText.length < 5)) {
            replyText = '';
        } else if (promptMode === 'image_title' && aiResponse.images.length > 0 && (!replyText || replyText.length < 5)) {
            const titles = aiResponse.images.map(img => img.title).filter(Boolean);
            replyText = titles.length > 0 ? titles.join('\n') : '';
        } else if (promptMode === 'title_desc' && replyText) {
            replyText = replyText
                .replace(/(?:৳|bdt|taka|tk)\s*[\d,.]+/gi, '')
                .replace(/[\d,.]+\s*(?:৳|bdt|taka|tk)/gi, '')
                .trim();
        }

        try {
            await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'mark_seen');
            await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on');
        } catch (e) {}

        let botMessageId = `bot_${Date.now()}`;
        if (replyText && replyText.length > 0) {
            // FIX: If AI says "no reply", we skip sending it to Facebook but still save it to our DB for history/tracking.
            const isNoReply = replyText.toLowerCase().trim() === 'no reply';
            
            if (!isNoReply) {
                const sendResult = await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);
                botMessageId = sendResult?.message_id || botMessageId;
            } else {
                console.log(`[AI Silence] Detected "no reply". Saving to DB but skipping Facebook send.`);
            }

            let aiModelLabel = aiResponse.model || null;
            const isCheapEngineForLog = pageConfig.cheap_engine !== false;
            if (isCheapEngineForLog && (!pageConfig.api_key || pageConfig.api_key === 'MANAGED_SECRET_KEY')) {
                if (aiModelLabel === 'gemini-2.0-flash' || aiModelLabel === 'gemini-2.0-flash-lite') {
                    aiModelLabel = 'salesmanchatbot-pro';
                }
            }

            // --- SAVE BOT REPLY TO fb_chats ---
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, // Bot is sender
                recipient_id: senderId,
                message_id: botMessageId,
                text: replyText,
                timestamp: Date.now(),
                status: 'bot_reply',
                reply_by: 'bot',
                token: aiResponse.token_usage || 0,
                ai_model: aiModelLabel
            });

            // --- PERSISTENCE: Save Last Resolved Product ID to Context ---
            if (aiResponse.foundProducts && aiResponse.foundProducts.length > 0) {
                const lastProductId = aiResponse.foundProducts[0].id || aiResponse.foundProducts[0].product_id;
                if (lastProductId) {
                    await dbService.saveChatMessage(sessionId, 'system', `[CONTEXT: LAST_RESOLVED_PRODUCT_ID: "${lastProductId}"]`);
                    console.log(`[Persistence] Saved last_resolved_product_id: ${lastProductId} for ${sessionId}`);
                }
            }
            // ----------------------------------
        }

        // Send Images (if any)
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            const images = aiResponse.images; // Array of {url, title}
            console.log(`[AI] Found ${images.length} images to send.`);
            
            // MASTER SWITCH: check if 'image_reply' is FALSE (default TRUE if undefined)
            // User requirement: "jodi image send o false ... tobe full image send system ta kaj korbe na"
            const allowImageSend = pagePrompts?.image_reply !== false; // Strict check against false
            
            if (!allowImageSend) {
                console.log(`[Image Send] Disabled by Config (image_reply=false). STRICT MODE: Sending nothing.`);
                // Do NOTHING. No links, no text fallback for images.
                // The AI's text reply (sent above) is all the user gets.
                
            } else {
                // Image Send ENABLED
                
                let sentViaCarousel = false;
                
                // Check Config for Template/Carousel
                // Robust check: handles boolean true, string 'true', integer 1, string '1'
                const tVal = pagePrompts?.template_reply;
                const useCarousel = (tVal === true || tVal === 'true' || tVal === 1 || tVal === '1');
                
                console.log(`[Image Group] Template Check: Value=${tVal}, Result=${useCarousel}, ImageCount=${images.length}`);
    
                if (useCarousel && images.length > 1) {
                    console.log(`[Image Group] Template Reply ON. Sending via Carousel...`);
                    try {
                        const elements = images.map((imgObj, index) => ({
                            title: imgObj.title || `View Image ${index + 1}`,
                            subtitle: 'Tap to expand',
                            image_url: imgObj.url,
                            default_action: {
                                type: "web_url",
                                url: imgObj.url,
                                webview_height_ratio: "tall"
                            }
                        }));
                        
                        // Limit to 10 elements (FB limit)
                        const carouselElements = elements.slice(0, 10);
                        
                        const carouselResult = await facebookService.sendCarouselMessage(pageId, senderId, carouselElements, pageConfig.page_access_token);
                        sentViaCarousel = true;
                        console.log(`[Image Group] Sent ${images.length} images via Carousel.`);

                        // FIX: Save Carousel Message ID with Product Context for Reply-To Logic
                        if (carouselResult && carouselResult.message_id) {
                            const productContext = images.map(img => `${img.title || 'Product'} (${img.url})`).join(', ');
                            await dbService.saveFbChat({
                                page_id: pageId,
                                sender_id: pageId,
                                recipient_id: senderId,
                                message_id: carouselResult.message_id, // REAL FB MESSAGE ID
                                text: `[System Memory: User is viewing Carousel with: ${productContext}]`,
                                timestamp: Date.now(),
                                status: 'bot_carousel',
                                reply_by: 'bot'
                            });
                        }
                    } catch (carouselError) {
                        console.error(`[Image Group] Carousel failed. Falling back to Binary Upload. Error: ${carouselError.message}`);
                        sentViaCarousel = false;
                    }
                }
    
                if (!sentViaCarousel) {
                    // Binary Upload Fallback
                    console.log(`[Image Send] Sending ${images.length} images...`);
                    
                    const uploadPromises = images.map(async (imgObj) => {
                         try {
                             // --- FORCE UPLOAD FOR STABILITY (User Requirement) ---
                             // We skip the direct URL send and use the binary uploader immediately.
                             // This ensures the image is "uploaded" as an attachment rather than just a linked URL.
                             console.log(`[Image Upload] Forcing binary upload for: ${imgObj.url}`);
                             const uploadResult = await facebookService.sendImageUpload(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             
                             // FIX: Save Uploaded Image Message ID
                             if (uploadResult && uploadResult.message_id) {
                                await dbService.saveFbChat({
                                    page_id: pageId,
                                    sender_id: pageId,
                                    recipient_id: senderId,
                                    message_id: uploadResult.message_id, // REAL FB MESSAGE ID
                                    text: `[System Memory: User is viewing Image of ${imgObj.title || 'Product'}: ${imgObj.url}]`,
                                    timestamp: Date.now(),
                                    status: 'bot_image',
                                    reply_by: 'bot'
                                });
                             }
                         } catch (imgError) {
                             console.error(`[Image Upload] Failed to upload image ${imgObj.url}: ${imgError.message}`);
                             
                             // FINAL FALLBACK: If binary upload fails, try sending via URL as a last resort
                             try {
                                 console.log(`[Image Fallback] Attempting direct URL send for: ${imgObj.url}`);
                                 await facebookService.sendImageMessage(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             } catch (urlError) {
                                 console.error(`[Image Fallback] Direct URL send also failed: ${urlError.message}`);
                                 // If everything fails, send as a text link
                                 const fallbackText = `Link: ${imgObj.url}`;
                                 await facebookService.sendMessage(pageId, senderId, fallbackText, pageConfig.page_access_token);
                             }
                         }
                    });
                    
                    await Promise.all(uploadPromises);
                    console.log(`[Image Group] All images processed.`);
                }
            }
        }

        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');

        // 7. Save History & Lead
        // Save User Message (Combined with Context)
        await dbService.saveChatMessage(sessionId, 'user', finalUserMessage);

        // Prepare Assistant History Content
        let historyReplyText = replyText;
        
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            let memoryNote = "";
            
            // Priority: Use 'foundProducts' if available to be specific about WHICH product
            // FIX: Include product names, URLs AND descriptions so AI knows exactly what it sent.
            let relevantProducts = [];
            if (aiResponse.foundProducts && Array.isArray(aiResponse.foundProducts) && aiResponse.foundProducts.length > 0) {
                 const sentImages = aiResponse.images.map(img => typeof img === 'string' ? img : img.url);
                 relevantProducts = aiResponse.foundProducts.filter(p => sentImages.includes(p.image_url));
            }

            if (relevantProducts.length > 0) {
                 const productDetails = relevantProducts.map(p => {
                     const desc = p.description ? ` | Description: ${p.description.substring(0, 300)}` : '';
                     return `${p.name}${desc}`;
                 }).join(' || ');
                 const summary = aiResponse.images.map(img => typeof img === 'string' ? img : img.url).join(' ; ');
                 memoryNote = `[SYSTEM MEMORY: Sent product images for: [${productDetails}]. Images: ${summary}. The user is now looking at these products.]`;
            } else {
                 const summary = aiResponse.images
                    .map(img => {
                        if (typeof img === 'string') return img;
                        const titlePart = img.title ? `${img.title}` : 'Image';
                        const descPart = img.description ? ` (Desc: ${img.description.substring(0, 300)})` : '';
                        return `${titlePart}${descPart} | ${img.url}`;
                    })
                    .join(' ; ');
                 memoryNote = `[SYSTEM MEMORY: Sent product images in this reply: ${summary}. The user is now looking at these images.]`;
            }
            
            // MERGE MEMORY INTO ASSISTANT MESSAGE to preserve context flow
            // This is better for context than a separate 'system' message which some models ignore.
            historyReplyText += `\n\n${memoryNote}`;

            // Save to fb_chats (for Audit/Debugging & User Requirement)
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, // System is sender
                recipient_id: senderId, // User is recipient (context)
                message_id: `mem_${Date.now()}`,
                text: memoryNote,
                timestamp: Date.now(),
                status: 'ai_memory',
                reply_by: 'system'
            });
        }

        // Save Assistant Reply (Text + Memory) to AI Context
        await dbService.saveChatMessage(sessionId, 'assistant', historyReplyText);

        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: finalUserMessage,
            reply: replyText
        });

        // 8. Deduct Credit (ONLY IF CHEAP ENGINE IS ACTIVE)
        if (isCheapEngine) {
            const deductionResult = await dbService.deductCredit(pageId, pageConfig.message_credit);
            console.log(`[Credit] Deduction Result for Page ${pageId}: ${deductionResult ? 'Success' : 'Failed/NoCredit'}`);
        } else {
            console.log(`[Credit] Skipped deduction for Page ${pageId} (Own API Mode)`);
        }

    } catch (error) {
        console.error("Error processing event:", error);
        dbService.logError(error, 'Webhook Controller - Message Processing', { pageId, senderId, sessionId });
        
        // Log Critical Error to DB for Admin Visibility
        try {
            if (pageId && senderId) {
                await dbService.saveFbChat({
                    page_id: pageId,
                    sender_id: pageId,
                    recipient_id: senderId,
                    message_id: `err_${Date.now()}`,
                    text: `[CRITICAL SYSTEM ERROR] ${error.message}`,
                    timestamp: Date.now(),
                    status: 'system_critical',
                    reply_by: 'system'
                });
            }
        } catch (dbErr) {
            console.error("Failed to log critical error to DB:", dbErr);
        }
    }
}

// Handle Comments (n8n "OnComment" Logic)
async function processCommentEvent(changeValue, entryPageId = null) {
    try {
        return;
        if (changeValue.item !== 'comment' || changeValue.verb !== 'add') return;

        const commentId = changeValue.comment_id;
        const message = changeValue.message;
        const senderId = changeValue.from?.id;
        const senderName = changeValue.from?.name || 'Unknown';
        const postId = changeValue.post_id;
        
        // Priority: Use entryPageId from Webhook Entry if available, otherwise extract from Post ID
        const pageId = entryPageId || postId.split('_')[0]; 

        // Ignore if sender is the page itself
        if (senderId === pageId) return;

        console.log(`Processing comment ${commentId} from ${senderName}: ${message}`);

        // 1. Save to DB (Avoid Duplicates)
        await dbService.saveFbComment({
            comment_id: commentId,
            page_id: pageId,
            sender_id: senderId,
            post_id: postId,
            message: message,
            status: 'received'
        });

        // 2. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        if (!pageConfig || (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial')) {
             console.log(`Page ${pageId} inactive or not found.`);
             return;
        }

        // --- CREDIT CHECK LOGIC (Modified for Cheap Engine vs Own API) ---
        // Default to TRUE (Cheap Engine) if undefined, for backward compatibility
        const isCheapEngine = pageConfig.cheap_engine !== false; 

        if (isCheapEngine) {
            if (pageConfig.message_credit <= 0) {
                console.log(`Page ${pageId} out of credits for comments (Cheap Engine Active).`);
                return;
            }
        } else {
             console.log(`Page ${pageId} using Own API for comments. Bypassing credit check.`);
        }
        // -----------------------------------------------------------------

        // 3. Generate AI Reply
        // Use a simplified prompt for comments (or same as chat)
        const pagePrompts = await dbService.getPagePrompts(pageId);
        
        // Pass "COMMENT_CONTEXT" to help AI understand
        const aiResponse = await aiService.generateReply(
            `[User Commented on Post]: ${message}`, 
            pageConfig, 
            pagePrompts, 
            [] // No history for comments usually, just single turn
        );

        const replyText = aiResponse.reply;

        if (!replyText || replyText.toLowerCase().trim() === 'no reply') return;

        // 4. Reply to Comment
        await facebookService.replyToComment(commentId, replyText, pageConfig.page_access_token);
        
        // 5. Update DB Status
        await dbService.saveFbComment({
            comment_id: commentId,
            reply_text: replyText,
            status: 'replied'
        });

        // 6. Deduct Credit (ONLY IF CHEAP ENGINE IS ACTIVE)
        if (isCheapEngine) {
             await dbService.deductCredit(pageId, pageConfig.message_credit);
        } else {
             console.log(`[Credit] Skipped deduction for Page ${pageId} (Own API Mode)`);
        }
        
        console.log(`Replied to comment ${commentId}`);

    } catch (error) {
        console.error("Error processing comment:", error);
        const safeMeta = changeValue ? { commentId: changeValue.comment_id, senderId: changeValue.from?.id } : { raw: 'Invalid changeValue' };
        dbService.logError(error, 'Webhook Controller - Comment Processing', safeMeta);
    }
}

module.exports = {
    handleWebhook,
    verifyWebhook
};
