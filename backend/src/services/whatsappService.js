const axios = require('axios');
const FormData = require('form-data');

// WAHA Configuration
const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

const apiClient = axios.create({
    baseURL: WAHA_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY
    }
});

/**
 * Send Text Message via WAHA (with optional splitting)
 * @param {string} session - The WhatsApp Session Name (e.g., 'default')
 * @param {string} chatId - The recipient's Chat ID (e.g., '123456789@c.us')
 * @param {string} text - The message text
 * @param {boolean} replyTo - Optional message ID to reply to
 */
async function sendMessage(session, chatId, text, replyTo = null) {
    // Split message logic if AI used [SPLIT] tag
    if (text && text.includes('[SPLIT]')) {
        console.log(`[WA SendText] Message contains [SPLIT] tag. Splitting into chunks...`);
        const chunks = text.split('[SPLIT]').map(c => c.trim()).filter(c => c.length > 0);
        
        let lastResult = null;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) continue;
            
            const payload = {
                chatId: chatId,
                text: chunk,
                session: session
            };
            if (replyTo && i === 0) payload.reply_to = replyTo; // Only reply-to on first chunk
            
            try {
                const response = await apiClient.post('/api/sendText', payload);
                lastResult = response.data;
            } catch (err) {
                console.error(`[WhatsApp] Send Text Chunk Error:`, err.message);
            }
            
            // Add a smart delay between chunks (1.5 seconds) to ensure correct order
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        return lastResult;
    }

    // Normal Send
    try {
        const payload = {
            chatId: chatId,
            text: text,
            session: session
        };

        if (replyTo) {
            payload.reply_to = replyTo;
        }

        const response = await apiClient.post('/api/sendText', payload);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Send Text Error (${session} -> ${chatId}):`, error.message);
        return null;
    }
}

/**
 * Send Image via WAHA (Professional: Binary Upload with URL Fallback)
 * @param {string} session 
 * @param {string} chatId 
 * @param {string} imageUrl 
 * @param {string} caption 
 */
async function sendImage(session, chatId, imageUrl, caption) {
    try {
        // 1. Try to download the image first (Binary Upload)
        // This ensures the image is actually reachable and avoids WAHA URL access issues
        const imageResponse = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 10000 // 10s timeout
        });
        
        const buffer = Buffer.from(imageResponse.data, 'binary');
        
        // Detect MimeType from Headers
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
        let extension = contentType.split('/')[1] || 'jpg';
        if (extension === 'jpeg') extension = 'jpg';
        
        const filename = `image_${Date.now()}.${extension}`;

        const form = new FormData();
        form.append('session', session);
        form.append('chatId', chatId);
        form.append('file', buffer, { filename: filename, contentType: contentType });
        if (caption) form.append('caption', caption);

        // Send using specific headers for FormData
        // Note: We use raw axios here to handle FormData headers correctly
        const response = await axios.post(`${WAHA_BASE_URL}/api/sendImage`, form, {
            headers: {
                ...form.getHeaders(),
                'X-Api-Key': WAHA_API_KEY
            }
        });
        
        return response.data;

    } catch (error) {
        console.warn(`[WhatsApp] Binary Upload Failed. Falling back to URL method: ${error.message}`);
        
        // 2. Fallback: URL Method
        try {
            // Auto-detect mimetype from URL extension (Basic)
            let mimetype = "image/jpeg";
            if (imageUrl.endsWith(".png")) mimetype = "image/png";
            else if (imageUrl.endsWith(".webp")) mimetype = "image/webp";
            else if (imageUrl.endsWith(".gif")) mimetype = "image/gif";
            
            const payload = {
                chatId: chatId,
                file: {
                    mimetype: mimetype,
                    url: imageUrl,
                    filename: "image" + (imageUrl.split('.').pop() || ".jpg")
                },
                caption: caption,
                session: session
            };

            const response = await apiClient.post('/api/sendImage', payload);
            return response.data;
        } catch (fallbackError) {
            console.error(`[WhatsApp] Send Image Error (Final):`, fallbackError.message);
            return null;
        }
    }
}

/**
 * Send Video via WAHA
 * @param {string} session
 * @param {string} chatId
 * @param {string} videoUrl
 * @param {string} caption
 */
async function sendVideo(session, chatId, videoUrl, caption) {
    try {
        const videoResponse = await axios.get(videoUrl, {
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const buffer = Buffer.from(videoResponse.data, 'binary');
        const contentType = videoResponse.headers['content-type'] || 'video/mp4';
        let extension = contentType.split('/')[1] || 'mp4';
        if (extension === 'quicktime') extension = 'mov';

        const filename = `video_${Date.now()}.${extension}`;

        const form = new FormData();
        form.append('session', session);
        form.append('chatId', chatId);
        form.append('file', buffer, { filename, contentType });
        if (caption) form.append('caption', caption);

        const response = await axios.post(`${WAHA_BASE_URL}/api/sendVideo`, form, {
            headers: {
                ...form.getHeaders(),
                'X-Api-Key': WAHA_API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.warn(`[WhatsApp] Binary Video Upload Failed. Falling back to URL method: ${error.message}`);

        try {
            let mimetype = 'video/mp4';
            if (videoUrl.endsWith('.webm')) mimetype = 'video/webm';
            else if (videoUrl.endsWith('.mov')) mimetype = 'video/quicktime';
            else if (videoUrl.endsWith('.avi')) mimetype = 'video/x-msvideo';
            else if (videoUrl.endsWith('.mkv')) mimetype = 'video/x-matroska';

            const payload = {
                chatId: chatId,
                file: {
                    mimetype,
                    url: videoUrl,
                    filename: "video." + (videoUrl.split('.').pop() || "mp4")
                },
                caption: caption,
                session: session
            };

            const response = await apiClient.post('/api/sendVideo', payload);
            return response.data;
        } catch (fallbackError) {
            console.error(`[WhatsApp] Send Video Error (Final):`, fallbackError.message);
            return null;
        }
    }
}

/**
 * Send Typing Indicator (Presence)
 * @param {string} session 
 * @param {string} chatId 
 */
async function sendTyping(session, chatId) {
    try {
        // WAHA 'startTyping'
        await apiClient.post('/api/startTyping', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore typing errors (non-critical)
    }
}

/**
 * Stop Typing Indicator
 * @param {string} session 
 * @param {string} chatId 
 */
async function stopTyping(session, chatId) {
    try {
        await apiClient.post('/api/stopTyping', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore
    }
}

/**
 * Send Seen Status (Mark as Read)
 * @param {string} session 
 * @param {string} chatId 
 */
async function sendSeen(session, chatId) {
    try {
        await apiClient.post('/api/sendSeen', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore errors
    }
}

/**
 * Get Chat History (if supported by WAHA instance)
 * @param {string} session 
 * @param {string} chatId 
 * @param {number} limit 
 */
async function getMessages(session, chatId, limit = 10) {
    try {
        const response = await apiClient.get('/api/getMessages', {
            params: {
                session: session,
                chatId: chatId,
                limit: limit
            }
        });
        return response.data;
    } catch (error) {
        console.warn(`[WhatsApp] Fetch Messages Error:`, error.message);
        return [];
    }
}

/**
 * Get All Sessions (WAHA)
 */
async function getSessions(all = false) {
    try {
        const response = await apiClient.get(`/api/sessions?all=${all}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Sessions Error:`, error.message);
        return [];
    }
}

/**
 * Get Single Session Info (WAHA)
 */
async function getSession(sessionName) {
    try {
        const response = await apiClient.get(`/api/sessions/${sessionName}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Session Error:`, error.message);
        return null;
    }
}

/**
 * Create New Session (WAHA)
 */
async function createSession(payload) {
    try {
        const response = await apiClient.post('/api/sessions', payload);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Create Session Error:`, error.message);
        throw error;
    }
}

/**
 * Delete Session (WAHA)
 */
async function deleteSession(sessionName) {
    try {
        const response = await apiClient.delete(`/api/sessions/${sessionName}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Delete Session Error:`, error.message);
        throw error;
    }
}

/**
 * Start Session (WAHA)
 */
async function startSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/start`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Start Session Error:`, error.message);
        throw error;
    }
}

/**
 * Stop Session (WAHA)
 */
async function stopSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/stop`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Stop Session Error:`, error.message);
        throw error;
    }
}

/**
 * Logout Session (WAHA)
 */
async function logoutSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/logout`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Logout Session Error:`, error.message);
        throw error;
    }
}

/**
 * Get Session Screenshot (QR)
 * Optimized to try direct QR first, then screenshot
 */
async function getScreenshot(sessionName) {
    try {
        // 1. Try to get QR code directly first (Better for NOWEB/WEBJS if configured)
        // Some WAHA versions support /api/{session}/auth/qr as an image
        try {
            const qrResponse = await apiClient.get(`/api/${sessionName}/auth/qr`, {
                responseType: 'arraybuffer',
                headers: { 'Accept': 'image/png' },
                timeout: 5000
            });
            // If it's a valid image (not a tiny error response)
            if (qrResponse.status === 200 && qrResponse.data && qrResponse.data.length > 500) {
                const base64 = Buffer.from(qrResponse.data, 'binary').toString('base64');
                return `data:image/png;base64,${base64}`;
            }
        } catch (e) {
            // Silently fallback to screenshot
            // console.warn(`[WhatsApp] Direct QR fetch failed for ${sessionName}, falling back to screenshot.`);
        }

        // 2. Fallback to Screenshot
        const response = await apiClient.get(`/api/screenshot?session=${sessionName}`, {
            responseType: 'arraybuffer' 
        });
        // Convert to base64 data URL
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error(`[WhatsApp] Get Screenshot Error:`, error.message);
        // Check for 422 Unprocessable Entity (Session Starting or Failed)
        if (error.response && error.response.status === 422) {
             console.warn(`[WhatsApp] Session ${sessionName} cannot provide screenshot (422) - likely starting.`);
             return null; // Return null to keep polling/waiting
        }
        return null;
    }
}

/**
 * Get Pairing Code (Link with Phone Number)
 * @param {string} sessionName 
 * @param {string} phoneNumber 
 */
async function getPairingCode(sessionName, phoneNumber) {
    // Poll for SCAN_QR status before requesting code (Max 30s)
    let retries = 20;
    while (retries > 0) {
        try {
            const sessionInfo = await getSession(sessionName);
            // Check for both SCAN_QR and SCAN_QR_CODE statuses
            if (sessionInfo && (sessionInfo.status === 'SCAN_QR' || sessionInfo.status === 'SCAN_QR_CODE')) {
                break; // Ready!
            }
        } catch (e) {
            // Ignore error during polling
        }
        await new Promise(r => setTimeout(r, 1500));
        retries--;
    }

    try {
        // Ensure phone number has no plus sign and no spaces/dashes
        // WAHA/WhatsApp usually expects just digits (CC + Number) without '+' for API calls
        const cleanPhoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        console.log(`[WhatsApp] Requesting Pairing Code for ${sessionName} -> ${cleanPhoneNumber}`);

        // Correct endpoint for NOWEB engine based on documentation
        // POST /api/{session}/auth/request-code
        const response = await apiClient.post(`/api/${sessionName}/auth/request-code`, {
            codeMethod: "sms", 
            phoneNumber: cleanPhoneNumber
        });
        return response.data.code;
    } catch (error) {
        console.error(`[WhatsApp] Get Pairing Code Error:`, error.message);
        
        // If 404, maybe try the previous method as fallback (optional, but sticking to new instruction first)
        if (error.response && error.response.status === 404) {
             console.error(`[WhatsApp] 404 Error: Endpoint not found. Ensure session is running and engine supports this.`);
        }
        
        // Handle Rate Limiting (Too Many Requests)
        const errDataStr = error.response && error.response.data ? (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)) : "";
        if (error.response && (error.response.status === 429 || errDataStr.toLowerCase().includes('rate limit'))) {
             throw new Error("Too many pairing attempts. WhatsApp has temporarily blocked this number. Please wait 5-10 minutes and try again.");
        }

        throw error;
    }
}

/**
 * Get Contact Info (Labels, etc.)
 * @param {string} session 
 * @param {string} chatId 
 */
async function getContact(session, chatId) {
    try {
        const response = await apiClient.get('/api/contacts', {
            params: {
                session: session,
                contactId: chatId
            }
        });
        // WAHA returns array for /api/contacts usually, or single object if contactId is unique?
        // Let's assume it returns a list and we find the one.
        // Or check if there's a specific endpoint. 
        // Based on WAHA Swagger: GET /api/contacts returns list.
        // There might be /api/contacts/{contactId} in some versions.
        // Let's try the list filter first.
        if (Array.isArray(response.data)) {
            return response.data.find(c => c.id === chatId || c.id._serialized === chatId);
        }
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Contact Error:`, error.message);
        return null;
    }
}

/**
 * Get All Labels in Session
 */
async function getAllLabels(session) {
    try {
        const response = await apiClient.get(`/api/labels?session=${session}`);
        return response.data || [];
    } catch (error) {
        // Fallback for different WAHA versions
        try {
            const altResponse = await apiClient.get(`/api/${session}/labels`);
            return altResponse.data || [];
        } catch (e) {
            console.error(`[WAHA] Fetch Labels Error:`, error.message);
            return [];
        }
    }
}

/**
 * Get Labels for a Chat (WAHA)
 * @param {string} session 
 * @param {string} chatId 
 */
async function getLabels(session, chatId) {
    try {
        // Correct endpoint per docs: GET /api/{session}/labels/chats/{chatId}/
        const response = await apiClient.get(`/api/${session}/labels/chats/${chatId}`);
        return response.data || [];
    } catch (error) {
        // Fallback to contact info
        try {
            const contact = await getContact(session, chatId);
            return contact ? contact.labels : [];
        } catch (e) {
            return [];
        }
    }
}

const WAHA_VALID_COLORS = [
    '#ff9485', '#64c4ff', '#ffd429', '#dfaef0', '#99b6c1', 
    '#55ccb3', '#ff9dff', '#d3a91d', '#6d7cce', '#d7e752', 
    '#00d0e2', '#ffc5c7', '#93ceac', '#f74848', '#00a0f2', 
    '#83e422', '#ffaf04', '#b5ebff', '#9ba6ff', '#9368cf'
];

/**
 * Create a new label
 */
async function createLabel(session, name, color = null) {
    try {
        const payload = { name: name };
        
        // If color is provided and is a valid hex, use it.
        // Otherwise, pick a random valid color to avoid 422 errors.
        if (color && WAHA_VALID_COLORS.includes(color)) {
            payload.colorHex = color;
        } else {
            // Pick a random color from the valid list
            const randomColor = WAHA_VALID_COLORS[Math.floor(Math.random() * WAHA_VALID_COLORS.length)];
            payload.colorHex = randomColor;
        }

        const response = await apiClient.post(`/api/${session}/labels`, payload);
        console.log(`[WhatsApp] Created New Label: ${name} with color ${payload.colorHex}`);
        return response.data;
    } catch (error) {
        // If label already exists (422 or 400), try to fetch it
        if (error.response && (error.response.status === 422 || error.response.status === 400)) {
            console.log(`[WhatsApp] Label '${name}' creation failed (likely exists). Fetching...`);
            const allLabels = await getAllLabels(session);
            const found = allLabels.find(l => l.name.toLowerCase() === name.toLowerCase());
            if (found) return found;
        }
        console.error(`[WhatsApp] Create Label Error: ${error.message}`, error.response?.data);
        return null;
    }
}

/**
 * Add Label to Chat (WAHA)
 * @param {string} session 
 * @param {string} chatId 
 * @param {string} labelName 
 */
async function addLabel(session, chatId, labelName) {
    try {
        console.log(`[WhatsApp] Adding label '${labelName}' to ${chatId}...`);
        
        // 1. Get All Session Labels to find ID
        let allLabels = await getAllLabels(session);
        let targetLabel = allLabels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
        
        // 2. Create if missing
        if (!targetLabel) {
            targetLabel = await createLabel(session, labelName);
            if (!targetLabel) throw new Error(`Could not create label '${labelName}'`);
        }
        
        const targetLabelId = targetLabel.id;
        
        // 3. Get Current Chat Labels (to preserve them)
        const currentLabels = await getLabels(session, chatId);
        const currentIds = currentLabels.map(l => ({ id: l.id }));
        
        // 4. Merge (Avoid duplicates)
        if (currentLabels.some(l => l.id === targetLabelId)) {
            console.log(`[WhatsApp] Label '${labelName}' already assigned to chat.`);
            return;
        }
        
        const newLabelList = [...currentIds, { id: targetLabelId }];
        
        // 5. Upsert (PUT)
        // Docs: PUT /api/{session}/labels/chats/{chatId}/
        await apiClient.put(`/api/${session}/labels/chats/${chatId}`, {
            labels: newLabelList
        });
        
        console.log(`[WhatsApp] Successfully assigned label '${labelName}' to ${chatId}`);
        
    } catch (error) {
        console.error(`[WhatsApp] Add Label Failed: ${error.message}`);
        // Fallback: Try old method just in case (PUT /api/chat/...)
         try {
             await apiClient.put(`/api/chat/${chatId}/labels`, {
                session: session,
                labels: [labelName]
            });
            console.log(`[WhatsApp] Legacy Fallback: Assigned label '${labelName}'`);
        } catch (e) {
            console.error(`[WhatsApp] Legacy Fallback Failed: ${e.message}`);
        }
    }
}

module.exports = {
    sendMessage,
    sendImage,
    sendVideo,
    sendTyping,
    stopTyping,
    sendSeen,
    getMessages,
    getSessions,
    getSession,
    createSession,
    deleteSession,
    startSession,
    stopSession,
    logoutSession,
    getScreenshot,
    getPairingCode,
    getContact,
    getLabels,
    getAllLabels,
    createLabel,
    addLabel
};
