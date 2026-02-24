const express = require('express');
const router = express.Router();
const keyService = require('../src/services/keyService');
const dbService = require('../src/services/dbService');
const axios = require('axios');

// --- 1. ENGINE STATS & DASHBOARD ---
router.get('/stats', async (req, res) => {
    try {
        const keys = await dbService.getAllKeys();
        const active = keys.filter(k => k.status === 'active').length;
        const dead = keys.filter(k => k.status === 'disabled').length;
        
        res.json({
            engine_status: 'online',
            total_keys: keys.length,
            active_keys: active,
            dead_keys: dead,
            providers: {
                google: keys.filter(k => k.provider === 'google' || k.provider === 'gemini').length,
                openai: keys.filter(k => k.provider === 'openai').length,
                groq: keys.filter(k => k.provider === 'groq').length,
                openrouter: keys.filter(k => k.provider === 'openrouter').length
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 2. KEY MANAGEMENT (CRUD) ---
router.post('/keys', async (req, res) => {
    try {
        const { api, provider, model } = req.body;
        if (!api || !provider) return res.status(400).json({ error: "API Key and Provider required" });
        
        await dbService.addApiKey({ api, provider, model: model || 'default' });
        await keyService.updateKeyCache(true); // Force Refresh
        res.json({ success: true, message: "Key added to rotation pool" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/keys/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await dbService.deleteApiKey(id);
        await keyService.updateKeyCache(true);
        res.json({ success: true, message: "Key removed" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 3. THE CORE PROXY ENGINE (Compatible with OpenAI Client) ---
// Endpoint: /v1/chat/completions
router.post('/v1/chat/completions', async (req, res) => {
    const { model, messages, stream } = req.body;
    
    // Auto-Detect Provider if not specified via header (Internal Logic)
    let provider = 'google';
    if (model.includes('gpt')) provider = 'openai';
    else if (model.includes('llama') || model.includes('mixtral')) provider = 'groq';
    else if (model.includes('/') || model.includes(':free')) provider = 'openrouter';

    console.log(`[API Engine] Processing Request: ${provider} / ${model}`);

    // Get Best Key (Smart Rotation)
    const keyData = await keyService.getSmartKey(provider, model);

    if (!keyData) {
        console.warn(`[API Engine] ⚠️ No keys available for ${provider}/${model}`);
        return res.status(429).json({ 
            error: { 
                message: "Engine Overload: All API keys are currently rate limited or exhausted.",
                type: "insufficient_quota",
                code: 429 
            } 
        });
    }

    // Determine Upstream Target
    let targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    if (provider === 'openai') targetUrl = 'https://api.openai.com/v1/chat/completions';
    else if (provider === 'groq') targetUrl = 'https://api.groq.com/openai/v1/chat/completions';
    else if (provider === 'openrouter') targetUrl = 'https://openrouter.ai/api/v1/chat/completions';

    try {
        // Forward Request
        const response = await axios.post(targetUrl, req.body, {
            headers: {
                'Authorization': `Bearer ${keyData.key}`,
                'Content-Type': 'application/json',
                // Add optional headers if needed
            },
            responseType: stream ? 'stream' : 'json',
            timeout: 60000 // 60s Timeout
        });

        // Track Usage (If not stream)
        if (!stream && response.data?.usage) {
            keyService.recordKeyUsage(keyData.key, response.data.usage.total_tokens);
        }

        // Return Response
        if (stream) {
            response.data.pipe(res);
        } else {
            res.json(response.data);
        }

    } catch (error) {
        // Handle Upstream Errors (Block Bad Keys)
        const status = error.response?.status || 500;
        console.warn(`[API Engine] Upstream Error (${status}): ${error.message}`);

        if (status === 429 || status === 401 || status === 403) {
            console.warn(`[API Engine] Blocking Key ${keyData.key.substring(0,8)}...`);
            keyService.markKeyAsDead(keyData.key, 60000, `upstream_${status}`);
        }

        res.status(status).json(error.response?.data || { error: error.message });
    }
});

module.exports = router;
