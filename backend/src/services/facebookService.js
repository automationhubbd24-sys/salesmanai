const axios = require('axios');
const dbService = require('./dbService'); // Required for token invalidation
const imageService = require('./imageService');
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v25.0';

// Helper: Handle Facebook Errors
async function handleFacebookError(error, pageId) {
    if (error.response && error.response.data && error.response.data.error) {
        const fbError = error.response.data.error;
        // Error Code 190: Invalid OAuth Access Token
        if (fbError.code === 190 || fbError.code === 102) { // 102 can also be session invalid
             console.error(`[Facebook] Critical Token Error for Page ${pageId}: ${fbError.message}`);
             
             // --- AUTO REFRESH LOGIC ---
             try {
                 console.log(`[Facebook] Attempting Auto-Refresh for Page ${pageId}...`);
                 const config = await dbService.getPageConfig(pageId);
                 
                 if (config && config.user_access_token) {
                     // Try to get new page token
                     const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${pageId}?fields=access_token&access_token=${config.user_access_token}`;
                     const response = await axios.get(url);
                     
                     if (response.data && response.data.access_token) {
                         console.log(`[Facebook] Auto-Refresh SUCCESS! Updating DB...`);
                         await dbService.updatePageToken(pageId, response.data.access_token);
                         return true; // Signal success (Token Refreshed)
                     }
                 } else {
                     console.warn(`[Facebook] No user_access_token found for auto-refresh.`);
                 }
             } catch (refreshError) {
                 console.error(`[Facebook] Auto-Refresh FAILED:`, refreshError.message);
             }
             // ---------------------------

             await dbService.markPageTokenInvalid(pageId);
        }
    }
}

// Step 4: HTTP Request to Send Message (with Splitting)
async function sendMessage(pageId, recipientId, text, accessToken) {
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;
        const sendWithRetry = async (payload) => {
            const delays = [500, 1000, 2000];
            for (let i = 0; i < delays.length + 1; i++) {
                try {
                    const response = await axios.post(url, payload, { timeout: 20000 });
                    return response.data;
                } catch (error) {
                    const status = error.response?.status;
                    await handleFacebookError(error, pageId);
                    const retryable = status === 429 || status === 613 || (status && status >= 500);
                    if (!retryable || i === delays.length) throw error;
                    await new Promise((r) => setTimeout(r, delays[i]));
                }
            }
        };
        
        // Split message if too long (limit is 2000, we use 1990 for safety check) or if it has [SPLIT] tag
        const FB_LIMIT = 2000;
        
        if (text.includes('[SPLIT]') || text.length > FB_LIMIT) {
            console.log(`Message contains [SPLIT] or is too long (${text.length} chars). Splitting...`);
            let chunks = [];
            
            if (text.includes('[SPLIT]')) {
                // If AI used the [SPLIT] delimiter, use it to separate messages
                chunks = text.split('[SPLIT]').map(c => c.trim()).filter(c => c.length > 0);
            } else {
                // Legacy length-based splitting
                let currentText = text;
                
                while (currentText.length > 0) {
                    let splitIndex = FB_LIMIT;
                    
                    if (currentText.length > FB_LIMIT) {
                        const chunkSafeLimit = 1950; // Leave buffer
                        const minChunkSize = 300;    // Allow smaller chunks if it means a clean section break
                        
                        const subString = currentText.substring(0, chunkSafeLimit);
                        
                        const headerRegex = /\n(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|IMAGE:|Link:|Sobi:).{1,50}(\n|$)/gu;
                        
                        let bestSplit = -1;
                        let match;
                        
                        // Find the last header that fits in the chunk
                        while ((match = headerRegex.exec(subString)) !== null) {
                             if (match.index > minChunkSize) {
                                 bestSplit = match.index; // Split BEFORE the header (at the newline)
                             }
                        }

                        const lastDoubleNewline = subString.lastIndexOf('\n\n');
                        const lastNewline = subString.lastIndexOf('\n');
                        const lastSpace = subString.lastIndexOf(' ');
                        
                        if (bestSplit !== -1) {
                            splitIndex = bestSplit; // Perfect Split: Before a new Section
                        } else if (lastDoubleNewline > minChunkSize) {
                            splitIndex = lastDoubleNewline; // Good Split: Paragraph end
                        } else if (lastNewline > minChunkSize) {
                            splitIndex = lastNewline; // Okay Split: Line end
                        } else if (lastSpace > minChunkSize) {
                            splitIndex = lastSpace; // Fallback: Word end
                        } else {
                            splitIndex = chunkSafeLimit; // Hard Split
                        }
                    } else {
                        splitIndex = currentText.length;
                    }
                    
                    chunks.push(currentText.substring(0, splitIndex));
                    currentText = currentText.substring(splitIndex).trim();
                }
            }
            
            // Send chunks sequentially with smart delay to avoid spam filters and order breaking
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (!chunk) continue;
                const payload = {
                    recipient: { id: recipientId },
                    message: { text: chunk }
                };
                await sendWithRetry(payload);
                
                // Add a smart delay between chunks (1.5 seconds) to ensure correct order and avoid rate limits
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
            return { status: 'split_sent', chunks: chunks.length };
        } else {
            // Normal Send
            const payload = {
                recipient: { id: recipientId },
                message: { text: text }
            };
            console.log(`Sending FB Message to ${recipientId} from ${pageId}`);
            return await sendWithRetry(payload);
        }
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error sending FB message for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        await handleFacebookError(error, pageId);
        throw error;
    }
}

// Human AI Agent Trick: Typing Indicator
async function sendTypingAction(recipientId, accessToken, action = 'typing_on') {
    if (accessToken === 'TEST_TOKEN') return;
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;
        await axios.post(url, {
            recipient: { id: recipientId },
            sender_action: action
        }, { timeout: 5000 });
    } catch (error) {
        // Ignore typing errors, not critical
        // But check if token is invalid
        await handleFacebookError(error, 'unknown_page_typing'); 
    }
}

// Get Single Message (Fallback for Swipe Reply) - REMOVED DUPLICATE
// See function at bottom of file


// Check Last Message for Human Handover
async function getConversationMessages(pageId, userId, accessToken, limit = 5) {
    if (accessToken === 'TEST_TOKEN') return [];
    try {
        // Correct endpoint to get messages between Page and User
        // Need to find the conversation ID first or use the user_id scope if allowed
        // Easier way: /me/conversations?user_id={user_id}
        
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/conversations?user_id=${userId}&fields=messages.limit(${limit}){message,from,created_time}&access_token=${accessToken}`;
        
        const response = await axios.get(url, { timeout: 10000 });
        
        // Structure: data: [{ messages: { data: [...] } }]
        if (response.data && response.data.data && response.data.data.length > 0) {
             return response.data.data[0].messages.data;
        }
        return [];
    } catch (error) {
        console.error(`Error fetching conversation for ${pageId}:`, error.response ? error.response.data : error.message);
        await handleFacebookError(error, pageId);
        return [];
    }
}

const FormData = require('form-data');

// Upload Image Binary (Bypasses URL reachability issues)
async function sendImageUpload(pageId, recipientId, imageUrl, accessToken) {
    try {
        // Validate image format (only JPG/PNG allowed!)
        if (!imageService.validateImageFormat(imageUrl)) {
            console.warn(`[Facebook] Image format not allowed (only JPG/PNG): ${imageUrl}`);
            return null;
        }

        console.log(`[Facebook] Compressing image: ${imageUrl}`);
        const compressed = await imageService.compressImage(imageUrl, {
            maxWidth: 1200,
            maxHeight: 1200,
            quality: 80
        });
        console.log(`[Facebook] Image compressed: ${(compressed.size / 1024).toFixed(2)}KB`);

        // Prepare Form Data with compressed buffer
        const form = new FormData();
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append('message', JSON.stringify({
            attachment: {
                type: 'image',
                payload: {
                    is_reusable: true
                }
            }
        }));
        form.append('filedata', compressed.buffer, {
            filename: 'image.jpg',
            contentType: compressed.mimeType
        });

        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;
        
        console.log(`[Facebook] Uploading compressed image to ${recipientId} from ${pageId}`);
        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });
        
        return response.data;
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`[Facebook] Error uploading compressed image for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        throw error;
    }
}

async function sendImageMessage(pageId, recipientId, imageUrl, accessToken) {
    try {
        // Validate image format (only JPG/PNG allowed!)
        if (!imageService.validateImageFormat(imageUrl)) {
            console.warn(`[Facebook] Image format not allowed (only JPG/PNG): ${imageUrl}`);
            return null;
        }

        // Let's use compressed upload instead of URL to ensure compression is applied!
        return sendImageUpload(pageId, recipientId, imageUrl, accessToken);
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`[Facebook] Error sending image for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        throw error;
    }
}

async function sendVideoUpload(pageId, recipientId, videoUrl, accessToken) {
    try {
        console.log(`Downloading video for upload: ${videoUrl}`);

        const videoResponse = await axios.get(videoUrl, {
            responseType: 'stream'
        });

        const form = new FormData();
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append('message', JSON.stringify({
            attachment: {
                type: 'video',
                payload: {
                    is_reusable: true
                }
            }
        }));
        form.append('filedata', videoResponse.data, {
            filename: 'video.mp4',
            contentType: videoResponse.headers['content-type'] || 'video/mp4'
        });

        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;

        console.log(`Uploading video to ${recipientId} from ${pageId}`);
        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        return response.data;
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error uploading video for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);

        console.log('Falling back to URL send method for video...');
        return sendVideoMessage(pageId, recipientId, videoUrl, accessToken);
    }
}

async function sendVideoMessage(pageId, recipientId, videoUrl, accessToken) {
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;

        const payload = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "video",
                    payload: {
                        url: videoUrl,
                        is_reusable: true
                    }
                }
            }
        };

        console.log(`Sending Video to ${recipientId} from ${pageId}`);
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error sending video for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        throw error;
    }
}

// Send Generic Template (Carousel) for multiple images
async function sendCarouselMessage(pageId, recipientId, elements, accessToken) {
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/messages?access_token=${accessToken}`;
        
        const payload = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements
                    }
                }
            }
        };

        console.log(`Sending Carousel to ${recipientId} from ${pageId} with ${elements.length} elements`);
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error sending carousel for page ${pageId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        throw error;
    }
}

// Reply to a Comment (Private or Public)
async function replyToComment(commentId, message, accessToken) {
    try {
        // Public Reply (reply to the comment thread)
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${commentId}/comments?access_token=${accessToken}`;
        
        console.log(`Replying to comment ${commentId}`);
        const response = await axios.post(url, { message: message });
        return response.data;
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error replying to comment ${commentId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        throw error;
    }
}

// Get Comment Replies (to check if already replied)
async function getCommentReplies(commentId, accessToken) {
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${commentId}/comments?access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data.data || [];
    } catch (error) {
        const errData = error.response ? (error.response.data || 'No data') : error.message;
        console.error(`Error getting comment replies ${commentId}:`, typeof errData === 'object' ? JSON.stringify(errData) : errData);
        return [];
    }
}

// Get User Profile (Name & Gender)
async function getUserProfile(userId, accessToken) {
    try {
        // Attempt to fetch gender (though often restricted)
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${userId}?fields=first_name,last_name,name,gender&access_token=${accessToken}`;
        const response = await axios.get(url, { timeout: 10000 });
        return response.data;
    } catch (error) {
        // console.error(`Error fetching user profile ${userId}:`, error.message);
        // Fail silently, return default
        return { name: 'Customer' };
    }
}

// Fetch Single Message by ID (Fallback for Old Messages)
async function getMessageById(messageId, accessToken) {
    try {
        const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${messageId}?fields=message&access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data.message || "";
    } catch (error) {
        console.error(`Error fetching message ${messageId}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = {
    sendMessage,
    sendImageMessage,
    sendImageUpload,
    sendVideoMessage,
    sendVideoUpload,
    sendCarouselMessage,
    sendTypingAction,
    getConversationMessages,
    replyToComment,
    getCommentReplies,
    getUserProfile,
    getMessageById
};
