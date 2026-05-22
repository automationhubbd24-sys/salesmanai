const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PRO_PLUS_API_BASE_URL = (process.env.PRO_PLUS_API_BASE_URL || 'https://api.salesmanchatbot.online/v1').replace(/\/+$/, '');
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

module.exports = {
    PRO_PLUS_API_BASE_URL,
    getProPlusApiKey,
    createChatCompletion,
    createEmbedding
};
