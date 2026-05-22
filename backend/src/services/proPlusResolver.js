const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const keyService = require('./keyService');
const { createChatCompletion, PRO_PLUS_API_BASE_URL, getConfiguredProPlusModel, PRO_PLUS_SINGLE_MODEL_OPTIONS } = require('./proPlusApiClient');

const PRO_PLUS_TEXT_CHAIN = PRO_PLUS_SINGLE_MODEL_OPTIONS;

const PROXY_BASE_URL = process.env.BRIGHT_DATA_PROXY_URL;
const PROXY_USER = process.env.BRIGHT_DATA_USER;
const PROXY_PASS = process.env.BRIGHT_DATA_PASS;

function getProxyUrl(modelName = 'default') {
    if (!PROXY_BASE_URL || !PROXY_USER || !PROXY_PASS) {
        console.warn("[ProPlus] Proxy not configured. Using direct connection.");
        return null;
    }
    const session = Math.floor(Math.random() * 10000000);
    return `http://${PROXY_USER}-session-${session}:${PROXY_PASS}@${PROXY_BASE_URL}`;
}

function getDynamicUserAgent() {
    const agents = [
        { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', ch: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"', platform: '"Windows"' },
        { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36', ch: '"Chromium";v="121", "Not(A:Brand";v="24", "Google Chrome";v="121"', platform: '"macOS"' },
        { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', ch: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"', platform: '"Linux"' }
    ];
    return agents[Math.floor(Math.random() * agents.length)];
}

function getStealthHeaders(apiKey) {
    const agent = getDynamicUserAgent();
    const headers = {};
    headers['User-Agent'] = agent.ua;
    headers['Accept'] = 'application/json, text/plain, */*';
    headers['Accept-Language'] = 'en-US,en;q=0.9';
    headers['Content-Type'] = 'application/json';
    headers['x-goog-api-key'] = apiKey;
    headers['Sec-CH-UA'] = agent.ch;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = agent.platform;
    headers['Sec-Fetch-Site'] = 'cross-site';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Dest'] = 'empty';
    return headers;
}

function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        return agent;
    } catch (e) {
        console.error(`[ProPlus] Proxy creation failed: ${e.message}`);
        return null;
    }
}

async function generateProPlusTextResponse({ pageConfig, userMessage, history, messages = null, imageUrls = [], audioUrls = [], senderName, extraTokenUsage = 0 }) {
    const MAX_RETRIES_PER_MODEL = 3;
    let attemptedKeys = new Set();
    let lastError = null;
    const modality = 'text';
    const selectedModel = getConfiguredProPlusModel(pageConfig);
    const modelsToTry = [selectedModel];
    const preparedMessages = Array.isArray(messages) && messages.length > 0
        ? messages
        : buildMessages({ userMessage, history, pageConfig, senderName });

    for (const currentModel of modelsToTry) {
        console.log(`[ProPlus Text] Trying branded endpoint: ${currentModel}`);

        for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
            try {
                const response = await createChatCompletion({
                    model: currentModel,
                    messages: preparedMessages,
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 2048
                });

                const resultText = response?.choices?.[0]?.message?.content;
                const usageTokens = response?.usage?.total_tokens || 0;
                if (!resultText) throw new Error('Empty response from branded endpoint');

                return {
                    reply: resultText,
                    token_usage: usageTokens + (extraTokenUsage || 0),
                    model: 'salesmanchatbot-pro-plus',
                    upstream_model: currentModel
                };
            } catch (err) {
                lastError = err;
                console.warn(`[ProPlus Text] Branded endpoint ${currentModel} attempt ${attempt + 1} failed via ${PRO_PLUS_API_BASE_URL}: ${err.message}`);
            }
        }
    }

    for (const currentModel of modelsToTry) {
        console.log(`[ProPlus Text] Trying model: ${currentModel}`);
        let modelRetryCount = 0;

        while (modelRetryCount < MAX_RETRIES_PER_MODEL) {
            let apiKey = null;
            let proxyAgent = null;

            try {
                const proxyUrl = getProxyUrl(currentModel);
                proxyAgent = createProxyAgent(proxyUrl);

                let keyData = await keyService.getSmartKey('google', currentModel, modality);
                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    keyData = await keyService.getSmartKey('google', 'default', modality);
                }

                if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                    console.warn(`[ProPlus Text] Pool for ${currentModel} exhausted.`);
                    break;
                }

                apiKey = keyData.key;
                attemptedKeys.add(apiKey);

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: preparedMessages.map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '') }]
                    })),
                    generationConfig: {
                        maxOutputTokens: 2048,
                        temperature: 0.7,
                        topP: 0.9
                    },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
                    ]
                };

                const response = await axios.post(url, payload, {
                    headers: getStealthHeaders(apiKey),
                    httpsAgent: proxyAgent,
                    httpAgent: proxyAgent,
                    proxy: false,
                    timeout: 60000
                });

                const resultText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                const usageTokens = response.data?.usageMetadata?.totalTokenCount || 0;

                if (!resultText) throw new Error("Empty response from Gemini");

                if (apiKey && usageTokens > 0) {
                    keyService.recordKeyUsage(apiKey, usageTokens, currentModel).catch(() => {});
                }

                return {
                    reply: resultText,
                    token_usage: usageTokens + (extraTokenUsage || 0),
                    model: 'salesmanchatbot-pro-plus',
                    upstream_model: currentModel
                };

            } catch (err) {
                lastError = err;
                const statusCode = err.response?.status;
                const errorMsg = (err.message || '').toLowerCase();

                console.warn(`[ProPlus Text] ${currentModel} attempt ${modelRetryCount + 1} failed: ${err.message}`);

                if (apiKey) {
                    const isRetryable = statusCode === 429 || statusCode === 401 || statusCode >= 500 ||
                        errorMsg.includes('limit') || errorMsg.includes('quota') ||
                        errorMsg.includes('key') || errorMsg.includes('timeout');

                    if (isRetryable) {
                        modelRetryCount++;
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }
                }
                break;
            }
        }
    }

    return {
        reply: null,
        error: lastError?.message || "All ProPlus text models failed",
        token_usage: 0,
        model: 'salesmanchatbot-pro-plus'
    };
}

function buildMessages({ userMessage, history, pageConfig, senderName }) {
    const messages = [];
    const systemPrompt = pageConfig?.text_prompt || "You are a helpful AI sales assistant.";
    const ownerName = pageConfig?.owner_name || 'the business';

    messages.push({
        role: 'user',
        content: `${systemPrompt}\n\n[BUSINESS CONTEXT]\nYou are an AI Salesman for "${ownerName}".\n[BUSINESS CONTEXT END]`
    });

    if (history && history.length > 0) {
        for (const msg of history.slice(-10)) {
            messages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            });
        }
    }

    messages.push({
        role: 'user',
        content: userMessage
    });

    return messages;
}

module.exports = {
    generateProPlusTextResponse,
    PRO_PLUS_TEXT_CHAIN
};
