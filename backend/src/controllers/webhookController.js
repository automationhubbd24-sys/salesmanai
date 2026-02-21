const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');
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

// Helper to log to file
function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (e) {
        console.error('Log Error:', e);
    }
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    const body = req.body;
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
                // Extract Page ID from the first entry (assuming batch is for same page usually)
                const pageId = body.entry?.[0]?.id;
                
                if (pageId) {
                     // If cache is empty (server restart), try quick fetch or allow once to be safe?
                     // Better: If cache is empty, we force refresh.
                     if (allowedPagesCache.size === 0) await refreshAllowedPages();
        
                     if (!allowedPagesCache.has(pageId)) {
                        // Double check DB before hard blocking (in case of new signup not in cache yet)
                        const isActuallyActive = await dbService.getPageConfig(pageId);
                        
                        if (isActuallyActive) {
                            // Note: getPageConfig now returns shared 'message_credit' from user_configs
                            const hasCredit = (isActuallyActive.message_credit > 0);
                            const hasOwnKey = (isActuallyActive.api_key && isActuallyActive.api_key.length > 5 && isActuallyActive.cheap_engine === false);
                            
                            // Allow if they have Credit OR Own Key, regardless of subscription_status (unless banned)
                            // We treat 'null' status as 'free'/'pay-as-you-go'
                            const isBanned = isActuallyActive.subscription_status === 'banned';
        
                            if (!isBanned && (hasCredit || hasOwnKey)) {
                                allowedPagesCache.add(pageId); 
                            } else {
                                console.warn(`[Gatekeeper] BLOCKED unauthorized event for Page ID: ${pageId}. Status: ${isActuallyActive.subscription_status}, Credit: ${isActuallyActive.message_credit}, OwnAPI: ${hasOwnKey}`);
                                return; // Stop processing
                            }
                        } else {
                            // Page not found in DB
                            return; // Stop processing
                        }
                     }
                }
                // ------------------------------------
        
                // Async Processing
                for (const entry of body.entry) {
                    // 1. Handle Messaging Events (Direct Messages)
                    if (entry.messaging) {
                        for (const webhookEvent of entry.messaging) {
                            if (webhookEvent) {
                                await queueMessage(webhookEvent);
                            }
                        }
                    }
                    
                    // 2. Handle Changes Events (Comments / Feed)
                    if (entry.changes) {
                        for (const change of entry.changes) {
                            if (change.field === 'feed') {
                                await processCommentEvent(change.value);
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
    const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || '123456'; 

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
async function queueMessage(event) {
    const senderId = event.sender.id;
    const pageId = event.recipient.id;
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
    if (event.message?.attachments) {
        // Separate Stickers from Real Images
        const stickers = event.message.attachments.filter(att => 
            att.type === 'image' && (event.message.sticker_id || att.payload.sticker_id)
        );
        
        const realImages = event.message.attachments.filter(att => 
            att.type === 'image' && !event.message.sticker_id && !att.payload.sticker_id
        );

        // Handle Stickers -> Convert to Emoji
        if (stickers.length > 0) {
            console.log(`[Webhook] Detected ${stickers.length} Sticker(s). Converting to Emoji.`);
            // Default to Thumbs Up 👍 for stickers as it's the most common (Blue Thumb)
            // We can append it to text so AI sees it as an emoji
            messageText = (messageText ? messageText + " " : "") + "👍"; 
        }

        const imageUrls = realImages.map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            console.log(`[Webhook] Image URLs Queued: ${imageUrls.length}`);
            // We just store the URLs now, analysis happens in processBufferedMessages
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

    // Check Duplicate immediately to avoid processing same message twice
    const isDuplicate = await dbService.checkDuplicate(messageId);
    if (isDuplicate) {
        console.log(`Duplicate message ${messageId} ignored.`);
        return;
    }

    const replyToId = event.message?.reply_to?.mid || null;

    // --- SAVE USER MESSAGE TO fb_chats (Immediate - Raw) ---
    try {
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: senderId,
            recipient_id: pageId,
            message_id: messageId,
            text: messageText || '[Media Message]', // Placeholder if text is empty
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
    
    // Extract URLs for this specific message (EXCLUDING STICKERS)
    // FIX: Removed event.message.sticker_id check to allow Screenshots/Images that might trigger false positives
    // UPDATE: Also removing att.payload.sticker_id check to ensure NO product images are missed. 
    // If a sticker is analyzed, AI will just describe it, which is better than missing a product.
    if (event.message?.attachments) {
        console.log(`[Webhook] Raw Attachments for ${sessionId}:`, JSON.stringify(event.message.attachments.map(a => ({ type: a.type, sticker_id: a.payload?.sticker_id, url: a.payload?.url?.substring(0, 30) }))));
    }

    const thisMsgImages = event.message?.attachments?.filter(att => 
        att.type === 'image'
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
        isPostback: !!event.postback,
        referral: referralData // Pass referral data to buffer
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
    // Reconstruct Combined Message & Extract Metadata
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    let hasPostback = false;
    let adContext = ""; // To store referral info

    for (const msg of messages) {
        if (typeof msg === 'string') {
            combinedText += msg + "\n";
        } else {
            if (msg.text) combinedText += msg.text + "\n";
            if (msg.reply_to) replyToId = msg.reply_to; 
            if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
            if (msg.audios && msg.audios.length > 0) allAudios.push(...msg.audios);
            if (msg.isPostback) hasPostback = true;
            
            // Extract Referral/Ad Info
            if (msg.referral) {
                const ref = msg.referral.ref || 'N/A';
                const source = msg.referral.source || 'Ad';
                const adId = msg.referral.ad_id || 'N/A';
                adContext = `\n[System Note: User clicked on an AD. Source: ${source}, Ref: "${ref}", Ad ID: ${adId}. Use this context to identify the product they are interested in.]`;
            }
        }
    }
    combinedText = combinedText.trim();
    if (adContext) combinedText += adContext;
    
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

    try {
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
        const isLocked = await dbService.checkLockStatus(pageId, senderId);
        if (isLocked) {
            const logMsg = `[Failure Lock] Conversation with ${senderId} is locked for 24h due to repeated failures.`;
            console.log(logMsg);
            logToFile(logMsg);
            // Log to DB
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM] Conversation Locked (Repeated Failures).`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }
        // --------------------------

        // --- OPTIMIZATION: PARALLEL DATA FETCHING ---
        // We fetch Prompts, User Profile, Chat History, and FB Messages (for handover) in parallel
        // This significantly reduces latency (User Feedback: "1s debounce but late reply")
        
        console.log("Fetching context data in parallel...");
        
        // Reduced history limit to save tokens (User Feedback: "System token besi kasse")
        const historyLimit = 10; 

        // --- MARK SEEN FIRST ---
        // Ensure 'mark_seen' is sent BEFORE 'typing_on' to avoid cancelling the typing bubble.
        // We await this to ensure order, and add a small delay.
        try {
            await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'mark_seen');
        } catch (e) {}
        
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        
        const typingStartTime = Date.now();
        // -----------------------
        
        const [pagePrompts, userProfile, fbMessages, history, typingResult] = await Promise.all([
            dbService.getPagePrompts(pageId),
            facebookService.getUserProfile(senderId, pageConfig.page_access_token),
            facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10), // For Handover Check
            dbService.getChatHistory(sessionId, historyLimit),
            facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on') // Fire and forget (awaited in parallel)
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

            let productAnalysisPrompt = "";
            if (pagePrompts && (pagePrompts.image_prompt || pagePrompts.vision_prompt)) {
                productAnalysisPrompt = pagePrompts.image_prompt || pagePrompts.vision_prompt;
            }

            for (const msg of messages) {
                if (msg.images && msg.images.length > 0) {
                    try {
                        const imagePromises = msg.images.map(url =>
                            aiService.processImageWithVision(url, pageConfig, { prompt: productAnalysisPrompt || "" })
                        );
                        const imageResults = await Promise.all(imagePromises);
                        
                        const perMsgText = imageResults.map((result, index) => {
                            const text = typeof result === 'object' ? (result.text || '') : String(result || '');
                            const usage = typeof result === 'object' ? (result.usage || 0) : 0;
                            totalVisionTokens += usage;
                            return `[Image ${index + 1} Analysis]: ${text}`;
                        }).join("\n").trim();
                        
                        if (perMsgText) {
                            combinedImageAnalysis += `\n${perMsgText}\n`;
                            try {
                                const analysisText = `[Image Analysis] ${perMsgText}`;
                                await dbService.saveFbChat({
                                    page_id: pageId,
                                    sender_id: senderId,
                                    recipient_id: pageId,
                                    message_id: `img_analysis_${Date.now()}_${messages.indexOf(msg)}`, // New ID for analysis text
                                    text: analysisText,
                                    timestamp: Date.now(),
                                    status: 'received',
                                    reply_by: 'user'
                                });
                                console.log(`[FB] Saved image analysis as new text message for ${senderId}`);
                            } catch (e) {
                                console.error(`[FB] Failed to save per-message analysis:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error(`[FB] Image Analysis Failed (msg ${msg.id}):`, err.message);
                    }
                }
            }
            if (combinedImageAnalysis) {
                combinedText += `\n\n[System: User sent ${allImages.length} images. Analysis follows:]${combinedImageAnalysis}`;
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
                
                // Save Audio Transcripts to DB as User Messages
                try {
                    const audioMsgText = `[Voice Transcript] ${combinedAudioTranscript}`;
                    await dbService.saveFbChat({
                        page_id: pageId,
                        sender_id: senderId,
                        recipient_id: pageId,
                        message_id: `audio_${Date.now()}`, // Generate a unique ID since we don't have one per audio file easily here without mapping
                        text: audioMsgText,
                        timestamp: Date.now(),
                        status: 'received',
                        reply_by: 'user'
                    });
                    console.log(`[FB] Saved audio transcript to DB for ${senderId}`);
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
        
        // Dynamic History Limit from DB (check_conversion) or default 10
        // history already fetched with default 50. If check_conversion is different, we might have fetched too much or too little.
        // But 50 is a safe upper bound for context window usually.
        // If we really need strict limit, we can slice the array locally.
        
        let effectiveHistory = history;
        if (pagePrompts?.check_conversion) {
             const limit = Number(pagePrompts.check_conversion);
             if (limit > 0 && limit < 50) {
                 effectiveHistory = history.slice(0, limit);
             }
        }

        // --- STOP EMOJI CHECK (Dynamic Logic via Graph API) ---
        const blockEmoji = pagePrompts?.block_emoji;
        const unblockEmoji = pagePrompts?.unblock_emoji;

        if (blockEmoji) {
            let lastBlockTime = 0;
            let lastUnblockTime = 0;
            
            for (const msg of fbMessages) {
                // Check if message is from PAGE (Admin or Bot)
                if (msg.from && msg.from.id === pageId) {
                     const content = msg.message || '';
                     const msgTime = new Date(msg.created_time).getTime();
                     
                     if (content.includes(blockEmoji)) {
                         if (msgTime > lastBlockTime) lastBlockTime = msgTime;
                     }
                     
                     if (unblockEmoji && content.includes(unblockEmoji)) {
                         if (msgTime > lastUnblockTime) lastUnblockTime = msgTime;
                     }
                }
            }
            
            if (lastBlockTime > 0) {
                 if (lastBlockTime > lastUnblockTime) {
                          const logMsg = `[Stop Logic] Active Block Emoji (${blockEmoji}) detected from Page. AI Halted.`;
                          console.log(logMsg);
                          logToFile(logMsg);
                          // Log to DB
                          await dbService.saveFbChat({
                              page_id: pageId,
                              sender_id: pageId,
                              recipient_id: senderId,
                              message_id: `sys_${Date.now()}`,
                              text: `[SYSTEM] AI Halted by Stop Emoji (${blockEmoji}).`,
                              timestamp: Date.now(),
                              status: 'system_info',
                              reply_by: 'system'
                          });
                          return;
                     }
            }
        }
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
                        const descDisplay = p.description ? p.description.replace(/\n/g, ' ').substring(0, 200) : 'N/A';
                        const imgDisplay = p.image_url || 'N/A';
                        promptProductContext += `Item ${i + 1}: ${p.name} | Price: ${priceDisplay} | Image URL: ${imgDisplay} | Desc: ${descDisplay}\n`;
                    });
                    promptProductContext += "[End of Instruction Products]\n";
                }
            }
        }
        
        const finalUserMessage = `${replyContext}${combinedText}${promptProductContext}`;
        // ------------------------------------

        // 5. Generate AI Reply
        // Use finalUserMessage which includes reply context
        
        // --- INJECT FORMATTING INSTRUCTION (Product Tags + Image Rules) ---
        if (pagePrompts && pagePrompts.text_prompt) {
             pagePrompts.text_prompt += `\n\n[IMPORTANT OUTPUT RULES]\n` +
                `1) There are two default modes:\n` +
                `   - Case A (no product tags): If the system prompt does NOT contain any line starting with '##PRODUCT', reply like a normal human.\n` +
                `     Keep any links exactly in the text and DO NOT invent product details or extra images unless the user clearly asks.\n` +
                `   - Case B (product tags): If the system prompt contains lines like '##PRODUCT \"gradepicture\"' (quotes may contain **bold** etc.),\n` +
                `     treat those as product definitions that you can use in replies.\n` +
                `2) In Case B, whenever you decide to use one of those products in your answer:\n` +
                `   - Merge the main reply and that product's information into ONE natural, human-sounding message.\n` +
                `   - Inside the same text, include: product name, key benefit, price, and a clear call-to-action.\n` +
                `   - Use the product's Image URL from the [Available Products in Store] context to output exactly ONE image line per used product\n` +
                `     using this STRICT format:\n` +
                `       IMAGE: <Product Name> | <Image URL>\n` +
                `3) Always keep the final text coherent and conversational, as if a real human agent wrote it.\n` +
                `   Do NOT send a separate \"product info\" block; the product details must be blended into the main message.\n` +
                `4) Never expose raw '##PRODUCT' tags back to the customer.\n` +
                `5) DO NOT use [Image] placeholders. ONLY use the 'IMAGE: Title | URL' format.\n`;
        }
        // --------------------------------------------------------------------

        const aiResponse = await aiService.generateReply(
            finalUserMessage, 
            pageConfig, 
            pagePrompts, 
            effectiveHistory, 
            senderName, 
            senderGender,
            [], // imageUrls (Already processed)
            [], // audioUrls (Already processed)
            totalVisionTokens + totalAudioTokens // Pass aggregated token usage
        );
        
        if (!aiResponse) {
             console.error(`[Webhook] AI generation failed for ${senderId}. No response generated.`);
             return;
        }

        // --- ZERO COST ORDER TRACKING LOGIC ---
        // If AI detects order details, save to DB immediately.
        // This uses the SAME AI call, so ZERO extra cost.
        if (aiResponse.order_details && aiResponse.order_details.product_name) {
             const order = aiResponse.order_details;
             console.log(`[Order] AI detected potential order: ${JSON.stringify(order)}`);
             
             // Normalize Data for DB
             // number: bigint (phone or sender_id)
             // We prioritize phone if AI found it, else use sender_id (must be numeric for bigint, but FB IDs are strings...
             // Wait, user schema says 'number bigint'. FB IDs are huge strings often, might fit in bigint?
             // Safest is to try parsing phone, if null, try senderId if it looks numeric.
             
             let customerNumber = order.phone ? order.phone.replace(/\D/g, '') : null;
             if (!customerNumber && /^\d+$/.test(senderId)) {
                 customerNumber = senderId;
             }
             
             // Only save if we have at least a product name and some user identifier
             if (customerNumber) {
                 await dbService.saveOrderTracking({
                     page_id: pageId, // Passed for duplicate check logic (though table might not have column, logic handles it)
                     sender_id: senderId, // For logging
                     product_name: order.product_name,
                     number: customerNumber, 
                     location: order.address,
                     product_quantity: order.quantity,
                     price: order.price
                 });
             }
        }
        // --------------------------------------

        // --- PRE-SEND CHECK (n8n "IfPageReplyExists" Logic) ---
        // Check again if Admin replied while AI was generating (Race Condition Fix)
        const freshFbMessages = await facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 1);
        if (freshFbMessages.length > 0) {
            const latestFresh = freshFbMessages[0];
            if (latestFresh.from && latestFresh.from.id === pageId) {
                console.log(`Admin replied while AI was generating. Stopping reply for ${sessionId}.`);
                return;
            }
        }
        // -------------------------------------------------------

        // 6. Send Reply (Text + Images)
        let replyText = aiResponse.reply;
        const originalReply = replyText;

        if (replyText == null) {
            replyText = '';
        } else {
            replyText = String(replyText);
        }

        // If AI returns null/empty text and no images, send a safe fallback reply
        if (!replyText && (!aiResponse.images || aiResponse.images.length === 0)) {
            const reason = originalReply === null ? 'Strict Domain Control (Null Reply)' : 'Empty String Response';
            console.log(`[AI] Empty reply detected. Reason: ${reason}. Using fallback message instead of staying silent.`);

            const hasProviderError = aiResponse.error && typeof aiResponse.error === 'string';
            const fallbackText = hasProviderError
                ? 'দুঃখিত, এই মুহূর্তে AI সিস্টেমে সমস্যা হচ্ছে। কিছুক্ষণ পর আবার চেষ্টা করুন।'
                : 'দুঃখিত, আমি আপনার বার্তাটা ঠিক বুঝিনি। আরেকবার একটু পরিষ্কার করে বলবেন?';

            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: `fail_${Date.now()}`,
                text: `[AI Fallback] ${reason}${hasProviderError ? ` | ${aiResponse.error}` : ''}`,
                timestamp: Date.now(),
                status: 'ai_ignored',
                reply_by: 'bot'
            });

            replyText = fallbackText;
        }

        // --- SMART IMAGE EXTRACTION & CLEANING ---
        if (!aiResponse.images) aiResponse.images = [];
        
        // Start with existing images from AI Service (normalize strings to objects)
        let extractedImages = aiResponse.images.map(img => {
            if (typeof img === 'string') return { url: img, title: 'Product Image' };
            return img;
        }); 

        const normalizedProductNames = Object.keys(promptProductMap || {});

        if (normalizedProductNames.length > 0 && replyText) {
            const lowerReply = replyText.toLowerCase();
            normalizedProductNames.forEach(name => {
                const product = promptProductMap[name];
                if (!product || !product.image_url) return;
                let url = product.image_url;
                if (!/^https?:\/\//i.test(url)) {
                    // Assume it's a relative path to our own storage
                    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
                    url = `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\/+/, '')}`;
                }

                const imageUrl = url;
                const hasImageAlready = extractedImages.some(img => img.url === imageUrl);

                const linkPattern = new RegExp(`Link\\s*:\\s*${escapeRegExp(name)}\\b`, 'gi');
                const hasLinkPattern = linkPattern.test(replyText);
                const hasNameMention = lowerReply.includes(name.toLowerCase());

                if (hasLinkPattern || (hasNameMention && !hasImageAlready)) {
                    if (hasLinkPattern) {
                        replyText = replyText.replace(linkPattern, '').trim();
                    }
                    const line = `IMAGE: ${product.name || name} | ${imageUrl}`;
                    if (replyText.length > 0 && !replyText.endsWith('\n')) {
                        replyText += '\n';
                    }
                    if (!replyText.includes(line)) {
                        replyText += line;
                    }
                }
            });
        }

        // 1. STRICT FORMAT: IMAGE: Title | URL
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

            if (isImage) {
                if (!extractedImages.some(img => img.url === url)) {
                    extractedImages.push({ url: url, title: title });
                }
                replyText = replyText.replace(fullMatch, '').trim();
            } else {
                // Non-Image URLs stay as normal text
                console.log(`[Image Extraction] Keeping non-Image URL as text: ${url}`);
            }
        }

        // 3. Direct Image URLs (Fallback)
        // Improved Regex: Handles comma-separated URLs and ignores trailing punctuation
        const imgRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)?(https?:\/\/[^\s,]+\.(?:jpg|jpeg|png|gif|webp))/gi;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(replyText)) !== null) {
            const fullMatch = imgMatch[0];
            let url = imgMatch[1];
            
            // Remove trailing punctuation
            url = url.replace(/[,.]$/, '');

            // Accept any valid image URL (Local or Remote)
            // Previously restricted to Supabase, now open for local storage migration
            if (!extractedImages.some(img => img.url === url)) {
                extractedImages.push({ url: url, title: 'View Image' });
            }
            replyText = replyText.replace(fullMatch, '').trim();
        }

        const labeledLinkRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)(https?:\/\/[^\s,]+)/gi;
        let labeledMatch;
        while ((labeledMatch = labeledLinkRegex.exec(replyText)) !== null) {
             const fullMatch = labeledMatch[0];
             let url = labeledMatch[1];
             
             // Remove trailing punctuation
             url = url.replace(/[,.]$/, '');

             // Check if it looks like an image file
             const isImage = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url);

             if (isImage) {
                 if (!extractedImages.some(img => img.url === url)) {
                    extractedImages.push({ url: url, title: 'View Link' });
                }
                replyText = replyText.replace(fullMatch, '').trim();
             } else {
                 console.log(`[Image Extraction] Keeping non-image link as text: ${url}`);
             }
        }
        
        replyText = replyText.replace(/\[Image.*?\]/gi, '').trim();
        replyText = replyText.replace(/^Image:$/gm, '').trim();

        // --- DEDUPLICATION LOGIC REMOVED (User Request) ---
        // We now rely entirely on the System Prompt / AI to decide whether to send an image or not.
        // If the AI outputs "IMAGE: ...", we send it.
        // --------------------------------------------------

        // Update aiResponse.images with our new object array
        aiResponse.images = extractedImages;

        if (aiResponse.images.length > 0) {
            console.log(`[Smart Extraction] Found ${aiResponse.images.length} images.`);
        }
        // ----------------------------------------

        let botMessageId = `bot_${Date.now()}`;
        if (replyText && replyText.length > 0) {
            const sendResult = await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);
            botMessageId = sendResult?.message_id || botMessageId;

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
                        
                        await facebookService.sendCarouselMessage(pageId, senderId, carouselElements, pageConfig.page_access_token);
                        sentViaCarousel = true;
                        console.log(`[Image Group] Sent ${images.length} images via Carousel.`);
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
                             // OPTIMIZATION: Try sending via URL first (Much faster)
                             // This avoids downloading and re-uploading the image if possible.
                             await facebookService.sendImageMessage(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             console.log(`[Image Sent] ${imgObj.url}`);
                         } catch (urlError) {
                             console.warn(`[Image URL Send Failed] ${imgObj.url} - Falling back to Upload. Error: ${urlError.message}`);
                             try {
                                 // Fallback: Use Smart Downloader & Uploader
                                 // This handles downloading the image to a buffer and uploading it as multipart/form-data
                                 await facebookService.sendImageUpload(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                                 console.log(`[Image Uploaded] ${imgObj.url}`);
                             } catch (imgError) {
                                 console.error(`[Image Fallback] Failed to send image ${imgObj.url}: ${imgError.message}`);
                                 
                                 // FINAL FALLBACK: If binary upload fails, send as a Link
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
        // Save Assistant Reply (Text only)
        await dbService.saveChatMessage(sessionId, 'assistant', replyText);
        // Save Image Memory (system note) so AI can see previously sent product images
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            let memoryNote = "";
            
            // Priority: Use 'foundProducts' if available to be specific about WHICH product
            if (aiResponse.foundProducts && Array.isArray(aiResponse.foundProducts) && aiResponse.foundProducts.length > 0) {
                 const productDetails = aiResponse.foundProducts.map(p => 
                    `${p.name} (Desc: ${p.description ? p.description.substring(0, 100) : 'N/A'})`
                 ).join(' | ');
                 const summary = aiResponse.images.map(img => typeof img === 'string' ? img : img.url).join(' ; ');
                 memoryNote = `[IMAGE MEMORY] Sent product images for: [${productDetails}]. Images: ${summary}`;
            } else {
                 // Fallback: Just list titles/urls from images array
                 const summary = aiResponse.images
                    .map(img => typeof img === 'string' ? img : `${img.title || 'Image'} | ${img.url}`)
                    .join(' ; ');
                 memoryNote = `[IMAGE MEMORY] Sent product images in this reply: ${summary}`;
            }
            
            // 1. Save to backend_chat_histories (for AI Context)
            await dbService.saveChatMessage(sessionId, 'system', memoryNote);

            // 2. Save to fb_chats (for Audit/Debugging & User Requirement)
            // "iamge send er somoi iamge er titel description teke etka message fb chats e save korbe"
            // "but ei message ta sender pabe na" -> reply_by = 'system'
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
    }
}

// Handle Comments (n8n "OnComment" Logic)
async function processCommentEvent(changeValue) {
    try {
        if (changeValue.item !== 'comment' || changeValue.verb !== 'add') return;

        const commentId = changeValue.comment_id;
        const message = changeValue.message;
        const senderId = changeValue.from?.id;
        const senderName = changeValue.from?.name || 'Unknown';
        const postId = changeValue.post_id;
        const pageId = postId.split('_')[0]; // Extract Page ID from Post ID

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

        if (!replyText) return;

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
    }
}

module.exports = {
    handleWebhook,
    verifyWebhook
};
