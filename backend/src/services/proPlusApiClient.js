const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PRO_PLUS_API_BASE_URL = (process.env.PRO_PLUS_API_BASE_URL || 'https://api.salesmanchatbot.online/v1').replace(/\/+$/, '');
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

function getProPlusApiKey() {
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

function createHeaders() {
    const apiKey = getProPlusApiKey();
    if (!apiKey) {
        throw new Error('Pro Plus external API key not configured');
    }

    return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
}

async function createChatCompletion(payload, timeout = 60000) {
    const response = await axios.post(`${PRO_PLUS_API_BASE_URL}/chat/completions`, payload, {
        headers: createHeaders(),
        timeout
    });

    return response.data;
}

async function createEmbedding(payload, timeout = 30000) {
    const response = await axios.post(`${PRO_PLUS_API_BASE_URL}/embeddings`, payload, {
        headers: createHeaders(),
        timeout
    });

    return response.data;
}

function getConfiguredProPlusModel(pageConfig = {}) {
    const requestedModel = String(pageConfig?.pro_plus_model || '').trim();
    if (PRO_PLUS_SINGLE_MODEL_OPTIONS.includes(requestedModel)) {
        return requestedModel;
    }
    return DEFAULT_PRO_PLUS_MODEL;
}

module.exports = {
    PRO_PLUS_API_BASE_URL,
    DEFAULT_PRO_PLUS_MODEL,
    PRO_PLUS_SINGLE_MODEL_OPTIONS,
    getProPlusApiKey,
    getConfiguredProPlusModel,
    createChatCompletion,
    createEmbedding
};
