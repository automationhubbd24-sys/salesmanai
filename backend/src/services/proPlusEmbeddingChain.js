const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const keyService = require('./keyService');
const { createEmbedding, PRO_PLUS_API_BASE_URL, getProPlusApiBaseUrl, isCustomProPlusEndpointConfigured } = require('./proPlusApiClient');

const PRO_PLUS_EMBED_CHAIN = [
    'gemini-embedding-001',
    'gemini-embedding-2',
    'gemini-embedding-2-preview'
];

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

async function generateProPlusEmbedding(text, pageConfig = {}) {
    let lastError = null;
    const attemptedKeys = new Set();
    const proPlusBaseUrl = getProPlusApiBaseUrl(pageConfig);
    const hasCustomOpenAICompatibleEndpoint = isCustomProPlusEndpointConfigured(pageConfig);

    if (!hasCustomOpenAICompatibleEndpoint) {
        for (const model of PRO_PLUS_EMBED_CHAIN) {
            console.log(`[ProPlus Embed] Trying branded endpoint: ${model}`);
            try {
                const response = await createEmbedding({
                    model,
                    input: text
                }, 30000, pageConfig);

                const vector = response?.data?.[0]?.embedding || response?.embedding?.values || null;
                if (!vector || !Array.isArray(vector)) {
                    throw new Error('Invalid embedding response from branded endpoint');
                }

                return { vector, model: 'salesmanchatbot-pro-plus', upstream_model: model };
            } catch (err) {
                lastError = err;
                console.warn(`[ProPlus Embed] Branded endpoint ${model} failed via ${proPlusBaseUrl || PRO_PLUS_API_BASE_URL}: ${err.message}`);
            }
        }
    } else {
        console.log('[ProPlus Embed] Custom OpenAI-compatible endpoint detected; skipping /embeddings proxy and using direct Gemini embeddings.');
    }

    for (const model of PRO_PLUS_EMBED_CHAIN) {
        console.log(`[ProPlus Embed] Trying model: ${model}`);
        let apiKey = null;
        let proxyAgent = null;

        try {
            const proxyUrl = getProxyUrl(model);
            proxyAgent = createProxyAgent(proxyUrl);

            let keyData = await keyService.getSmartKey('google', model, 'embedding');
            if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                keyData = await keyService.getSmartKey('google', 'default', 'embedding');
            }

            if (!keyData || !keyData.key || attemptedKeys.has(keyData.key)) {
                console.warn(`[ProPlus Embed] Pool for ${model} exhausted.`);
                continue;
            }

            apiKey = keyData.key;
            attemptedKeys.add(apiKey);

            let url, payload;

            if (model === 'gemini-embedding-001') {
                url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
                payload = {
                    content: { parts: [{ text }] },
                    taskType: 'RETRIEVAL_DOCUMENT'
                };
            } else {
                url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
                payload = {
                    content: { parts: [{ text }] },
                    taskType: 'RETRIEVAL_DOCUMENT'
                };
            }

            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                httpsAgent: proxyAgent,
                httpAgent: proxyAgent,
                proxy: false,
                timeout: 30000
            });

            let vector = null;
            if (model === 'gemini-embedding-001') {
                vector = response.data?.embedding?.values;
            } else {
                vector = response.data?.embedding?.values;
            }

            if (!vector || !Array.isArray(vector)) {
                throw new Error("Invalid embedding response");
            }

            if (model === 'gemini-embedding-001' && vector.length === 3072) {
                vector = vector.slice(0, 1536);
            }

            if (apiKey) {
                keyService.recordKeyUsage(apiKey, vector.length, model).catch(() => {});
            }

            return { vector, model: 'salesmanchatbot-pro-plus', upstream_model: model };

        } catch (err) {
            lastError = err;
            const statusCode = err.response?.status;
            const errorMsg = (err.message || '').toLowerCase();

            console.warn(`[ProPlus Embed] ${model} failed: ${err.message}`);

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

    return { vector: null, error: lastError?.message || 'All embedding models failed', model: 'salesmanchatbot-pro-plus' };
}

module.exports = {
    generateProPlusEmbedding,
    PRO_PLUS_EMBED_CHAIN
};
