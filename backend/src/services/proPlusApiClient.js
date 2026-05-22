const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DEFAULT_PRO_PLUS_API_BASE_URL = 'https://gemini.salesmanchatbot.online/';
const PRO_PLUS_API_BASE_URL = (process.env.PRO_PLUS_API_BASE_URL || DEFAULT_PRO_PLUS_API_BASE_URL).replace(/\/+$/, '');
const DEFAULT_PRO_PLUS_MODEL = process.env.PRO_PLUS_DEFAULT_MODEL || 'gemini-3-flash-preview';
const PRO_PLUS_SINGLE_MODEL_OPTIONS = [
    'gemini-2.5-flash',
    'gemini-2.5-computer-use-preview-10-2025',
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro',
    'gemini-2.5-pro-preview-tts',
    'gemini-3-flash-preview',
    'gemini-3-pro-image-preview',
    'gemini-3-pro-preview',
    'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-flash-tts-preview',
    'gemini-3.1-pro-preview',
    'gemini-embedding-001',
    'gemini-embedding-2',
    'gemini-embedding-2-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-pro-latest',
    'gemini-robotics-er-1.6-preview',
    'gemma-4-26b-a4b-it',
    'gemma-4-31b-it',
    'imagen-4.0-fast-generate-001',
    'imagen-4.0-generate-001',
    'imagen-4.0-ultra-generate-001'
];
const DIRECT_PRO_PLUS_API_KEY = 'sk-fa8d1997a7838fdc6fdb1f51c763bd36ae0bbec5d153d527';
let cachedApiKey = null;

function getLocalTestApiKey() {
    try {
        const testFilePath = path.resolve(__dirname, '../../../test-api.cjs');
        if (!fs.existsSync(testFilePath)) return null;

        const source = fs.readFileSync(testFilePath, 'utf8');
        const match = source.match(/API_KEY\s*=\s*'([^']+)'/);
        return match ? match[1] : null;
    } catch (_) {
        return null;
    }
}

function getFallbackProPlusApiKey() {
    if (cachedApiKey) return cachedApiKey;

    cachedApiKey =
        process.env.PRO_PLUS_API_KEY ||
        process.env.SALESMANCHATBOT_API_KEY ||
        process.env.EXTERNAL_API_KEY ||
        getLocalTestApiKey() ||
        DIRECT_PRO_PLUS_API_KEY ||
        null;

    return cachedApiKey;
}

function getProPlusApiBaseUrl(pageConfig = {}) {
    const customBaseUrl = String(pageConfig?.custom_base_url || pageConfig?.base_url || '').trim();
    return (customBaseUrl || PRO_PLUS_API_BASE_URL).replace(/\/+$/, '');
}

function isCustomProPlusEndpointConfigured(pageConfig = {}) {
    return Boolean(String(pageConfig?.custom_base_url || pageConfig?.base_url || '').trim());
}

function getProPlusApiKey(pageConfig = {}) {
    if (isCustomProPlusEndpointConfigured(pageConfig)) {
        const pageApiKey = String(pageConfig?.api_key || '').trim();
        return pageApiKey || null;
    }

    return getFallbackProPlusApiKey();
}

function createHeaders(pageConfig = {}) {
    const apiKey = getProPlusApiKey(pageConfig);
    if (!apiKey) {
        throw new Error('Pro Plus external API key not configured');
    }

    return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
}

async function createChatCompletion(payload, timeout = 60000, pageConfig = {}) {
    const baseUrl = getProPlusApiBaseUrl(pageConfig);
    const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
        headers: createHeaders(pageConfig),
        timeout
    });

    return response.data;
}

async function createEmbedding(payload, timeout = 30000, pageConfig = {}) {
    const baseUrl = getProPlusApiBaseUrl(pageConfig);
    const response = await axios.post(`${baseUrl}/embeddings`, payload, {
        headers: createHeaders(pageConfig),
        timeout
    });

    return response.data;
}

function getConfiguredProPlusModel(pageConfig = {}) {
    const requestedModel = String(pageConfig?.pro_plus_model || pageConfig?.chat_model || '').trim();
    return requestedModel || DEFAULT_PRO_PLUS_MODEL;
}

module.exports = {
    PRO_PLUS_API_BASE_URL,
    DEFAULT_PRO_PLUS_MODEL,
    PRO_PLUS_SINGLE_MODEL_OPTIONS,
    getProPlusApiKey,
    getProPlusApiBaseUrl,
    isCustomProPlusEndpointConfigured,
    getConfiguredProPlusModel,
    createChatCompletion,
    createEmbedding
};
