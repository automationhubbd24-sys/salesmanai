const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const FormData = require('form-data');
const keyService = require('./keyService');
const dbService = require('./dbService');

const PRO_PLUS_VISION_CHAIN = [
    { model: 'gemini-3.1-flash-lite-preview', retries: 3 },
    { model: 'gemini-3.1-flash-lite', retries: 1 },
    { model: 'gemini-3-flash-preview', retries: 1 }
];

const PRO_PLUS_VOICE_CHAIN = [
    { model: 'gemini-3.1-flash-lite-preview', retries: 3 },
    { model: 'gemini-3.1-flash-lite', retries: 1 },
    { model: 'gemini-3-flash-preview', retries: 1 }
];

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

const PROXY_BASE_URL = process.env.BRIGHT_DATA_PROXY_URL;
const PROXY_USER = process.env.BRIGHT_DATA_USER;
const PROXY_PASS = process.env.BRIGHT_DATA_PASS;

function getProxyUrl(modelName = 'default') {
    if (!PROXY_BASE_URL || !PROXY_USER || !PROXY_PASS) return null;
    const session = Math.floor(Math.random() * 10000000);
    return `http://${PROXY_USER}-session-${session}:${PROXY_PASS}@${PROXY_BASE_URL}`;
}

function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        return new HttpsProxyAgent(proxyUrl);
    } catch (e) {
        return null;
    }
}

function getDynamicUserAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
}

async function processProPlusVision(imageUrl, pageConfig = {}, customOptions = {}) {
    let base64Image = null;
    let mimeType = null;
    let lastError = null;

    const ensureBase64 = async () => {
        if (base64Image) return;
        try {
            if (imageUrl.startsWith('data:')) {
                const parts = imageUrl.split(',');
                if (parts.length >= 2) {
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                    base64Image = parts.slice(1).join('').replace(/\s/g, '');
                }
            } else {
                const headers = { 'User-Agent': getDynamicUserAgent() };
                if (imageUrl.includes(WAHA_BASE_URL) || imageUrl.includes('wahubbd.salesmanchatbot.online')) {
                    headers['X-Api-Key'] = WAHA_API_KEY;
                } else if (imageUrl.includes('graph.facebook.com') && pageConfig.page_access_token) {
                    headers['Authorization'] = `Bearer ${pageConfig.page_access_token}`;
                }

                const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    headers,
                    timeout: 40000,
                    proxy: false
                });
                base64Image = Buffer.from(response.data).toString('base64');
                mimeType = response.headers['content-type'] || 'image/jpeg';
            }
        } catch (e) {
            throw new Error(`Image Pre-processing Failed: ${e.message}`);
        }
    };

    await ensureBase64();

    const systemPrompt = customOptions?.prompt || "Describe this image briefly.";
    const maxTokens = customOptions?.max_tokens || 10000;
    const attemptedKeys = new Set();

    for (const chainItem of PRO_PLUS_VISION_CHAIN) {
        const { model, retries } = chainItem;
        console.log(`[ProPlus Vision] Trying model: ${model}`);

        for (let attempt = 0; attempt < retries; attempt++) {
            let apiKey = null;
            let proxyAgent = null;

            try {
                const proxyUrl = getProxyUrl(model);
                proxyAgent = createProxyAgent(proxyUrl);

                let keyData = await keyService.getSmartKey('google', model, 'vision');
                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    keyData = await keyService.getSmartKey('google', 'default', 'vision');
                }

                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    console.warn(`[ProPlus Vision] Pool for ${model} exhausted.`);
                    break;
                }

                apiKey = keyData.key;
                attemptedKeys.add(apiKey);

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: [{
                        parts: [
                            { text: systemPrompt },
                            { inline_data: { mime_type: mimeType, data: base64Image } }
                        ]
                    }],
                    generationConfig: { maxOutputTokens: maxTokens },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
                    ]
                };

                const response = await axios.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    httpsAgent: proxyAgent,
                    httpAgent: proxyAgent,
                    proxy: false,
                    timeout: 60000
                });

                const resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                const usageTokens = response.data?.usageMetadata?.totalTokenCount || 0;

                if (!resultText) throw new Error("Empty response");

                if (apiKey && usageTokens > 0) {
                    keyService.recordKeyUsage(apiKey, usageTokens, model).catch(() => {});
                }

                return { text: resultText, usage: usageTokens, model };

            } catch (err) {
                lastError = err;
                const statusCode = err.response?.status;
                const errorMsg = (err.message || '').toLowerCase();

                console.warn(`[ProPlus Vision] ${model} attempt ${attempt + 1} failed: ${err.message}`);

                const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 ||
                    errorMsg.includes('limit') || errorMsg.includes('quota') ||
                    errorMsg.includes('key') || errorMsg.includes('timeout');

                if (isRetryable) {
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }
                break;
            }
        }
    }

    return { text: `[Vision Failed] ${lastError?.message || 'All models exhausted'}`, usage: 0, model: 'salesmanchatbot-pro-plus' };
}

async function processProPlusAudio(audioUrl, pageConfig = {}) {
    let audioBuffer = null;
    let mimeType = 'audio/ogg';
    let lastError = null;
    const attemptedKeys = new Set();

    try {
        const headers = { 'User-Agent': getDynamicUserAgent() };
        if (audioUrl.includes(WAHA_BASE_URL) || audioUrl.includes('wahubbd.salesmanchatbot.online')) {
            headers['X-Api-Key'] = WAHA_API_KEY;
        } else if (audioUrl.includes('graph.facebook.com') && pageConfig.page_access_token) {
            headers['Authorization'] = `Bearer ${pageConfig.page_access_token}`;
        }

        const response = await axios.get(audioUrl, { responseType: 'arraybuffer', headers, validateStatus: s => s === 200 });
        audioBuffer = Buffer.from(response.data);
        const contentType = response.headers['content-type'] || 'audio/ogg';
        if (contentType.includes('opus') || contentType.includes('ogg')) mimeType = 'audio/ogg';
        else if (contentType.includes('mp3') || contentType.includes('mpeg')) mimeType = 'audio/mpeg';
        else if (contentType.includes('wav')) mimeType = 'audio/wav';
        else if (contentType.includes('aac') || contentType.includes('mp4') || contentType.includes('m4a')) mimeType = 'audio/mp4';
    } catch (e) {
        return { text: null, error: `Audio download failed: ${e.message}`, usage: 0 };
    }

    const voicePrompt = "Transcribe this audio. Priority: Bangla, English, Hindi. Output only transcription text.";
    const attemptedKeys2 = new Set();

    for (const chainItem of PRO_PLUS_VOICE_CHAIN) {
        const { model, retries } = chainItem;
        console.log(`[ProPlus Audio] Trying model: ${model}`);

        for (let attempt = 0; attempt < retries; attempt++) {
            let apiKey = null;
            let proxyAgent = null;

            try {
                const proxyUrl = getProxyUrl(model);
                proxyAgent = createProxyAgent(proxyUrl);

                let keyData = await keyService.getSmartKey('google', model, 'voice');
                if (!keyData || !keyData.key || attemptedKeys2.has(keyData.key)) {
                    keyData = await keyService.getSmartKey('google', 'default', 'voice');
                }

                if (!keyData || !keyData.key || attemptedKeys2.has(keyData.key)) {
                    console.warn(`[ProPlus Audio] Pool for ${model} exhausted.`);
                    break;
                }

                apiKey = keyData.key;
                attemptedKeys2.add(apiKey);

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: [{
                        parts: [
                            { text: voicePrompt },
                            { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }
                        ]
                    }]
                };

                const response = await axios.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    httpsAgent: proxyAgent,
                    httpAgent: proxyAgent,
                    proxy: false,
                    timeout: 60000
                });

                const resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                const usageTokens = response.data?.usageMetadata?.totalTokenCount || 0;

                if (!resultText) throw new Error("Empty response");

                if (apiKey && usageTokens > 0) {
                    keyService.recordKeyUsage(apiKey, usageTokens, model).catch(() => {});
                }

                return { text: resultText, usage: usageTokens, model };

            } catch (err) {
                lastError = err;
                const statusCode = err.response?.status;
                const errorMsg = (err.message || '').toLowerCase();

                console.warn(`[ProPlus Audio] ${model} attempt ${attempt + 1} failed: ${err.message}`);

                const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 ||
                    errorMsg.includes('limit') || errorMsg.includes('quota') ||
                    errorMsg.includes('key') || errorMsg.includes('timeout');

                if (isRetryable) {
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }
                break;
            }
        }
    }

    return { text: null, error: `Audio failed: ${lastError?.message || 'All models exhausted'}`, usage: 0 };
}

module.exports = {
    processProPlusVision,
    processProPlusAudio,
    PRO_PLUS_VISION_CHAIN,
    PRO_PLUS_VOICE_CHAIN
};
