const dbService = require('../services/dbService');
const openrouterEngineService = require('../services/openrouterEngineService');
const keyService = require('../services/keyService');
const axios = require('axios');

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

exports.getConfig = async (req, res) => {
    try {
        const { data, error } = await dbService.supabase
            .from('openrouter_engine_config')
            .select('*')
            .eq('config_type', 'best_models')
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
            throw error;
        }

        res.json({ success: true, config: data || null });
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveConfig = async (req, res) => {
    try {
        const { text_model, voice_model, image_model, text_model_details, voice_model_details, image_model_details } = req.body;

        const { data, error } = await dbService.supabase
            .from('openrouter_engine_config')
            .upsert({
                config_type: 'best_models',
                text_model,
                voice_model,
                image_model,
                text_model_details,
                voice_model_details,
                image_model_details,
                updated_at: new Date().toISOString()
            }, { onConflict: 'config_type' })
            .select()
            .single();

        if (error) throw error;

        // Update KeyService Limits immediately
        if (text_model && text_model_details) {
            updateKeyServiceLimits(text_model, text_model_details);
        }
        if (voice_model && voice_model_details) {
            updateKeyServiceLimits(voice_model, voice_model_details);
        }
        if (image_model && image_model_details) {
            updateKeyServiceLimits(image_model, image_model_details);
        }

        // Trigger Engine Update (reload config)
        await openrouterEngineService.loadConfigFromDB();

        res.json({ success: true, config: data });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

function updateKeyServiceLimits(modelId, details) {
    if (!details || !details.rpm || !details.rpd) return;
    
    // We need a way to inject these into KeyService
    // Since KeyService has dynamicLimits map, we can update that.
    // Ideally, KeyService should export a method to set limits.
    // For now, we will assume we can't directly access the map unless we exported it.
    // I will add a method to KeyService for this.
    if (keyService.setManualLimit) {
        keyService.setManualLimit(modelId, { rpm: parseInt(details.rpm), rpd: parseInt(details.rpd) });
    }
}

exports.testModel = async (req, res) => {
    const { model, type, input, apiKey } = req.body; // type: 'text', 'image', 'voice'

    if (!apiKey) {
        return res.status(400).json({ success: false, error: "API Key is required for testing." });
    }

    try {
        let responseData = {};
        let headers = {};
        const start = Date.now();

        if (type === 'text') {
            const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [{ role: 'user', content: input || "Hello, are you working?" }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://orderly-conversations.com',
                        'X-Title': 'SalesmanChatbot Test'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        } 
        else if (type === 'image') {
             // For Image Generation models (if supported via chat completions or specific endpoint)
             // OpenRouter usually does images via specific models but often standard chat format with image output?
             // Or maybe standard OpenAI Image API? OpenRouter documentation says:
             // "OpenRouter supports the OpenAI Image Generation API for some models."
             // Path: /images/generations
             
             // However, many "image" models on OpenRouter are Vision (Input) models.
             // If user means "Image Generation", we use /images/generations.
             // If user means "Vision" (Input), we use chat/completions with image_url.
             // Given "image url patalam" (I sent image url), user likely means VISION (Image Input).
             
             // User said: "image url patalam test er jonno" -> "I sent image url for testing"
             // This implies checking if the model can SEE the image. So it's a Vision model test.
             
             const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [
                        { 
                            role: 'user', 
                            content: [
                                { type: 'text', text: "What is in this image?" },
                                { type: 'image_url', image_url: { url: input } }
                            ] 
                        }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://orderly-conversations.com',
                        'X-Title': 'SalesmanChatbot Test'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        }
        else if (type === 'voice') {
            // "voice patalam" -> "I sent voice". Likely Speech-to-Text (Audio Transcription).
            // Endpoint: /audio/transcriptions
            // But usually this requires FormData file upload.
            // If user provides a URL to audio file?
            // OpenAI API supports 'file' upload.
            // Maybe user means "Text-to-Speech" (Generation)?
            // "voice patalam" (I sent voice) -> Input is voice. Output is text. (STT / ASR)
            // But if user wants to use a "Voice Model" for the chatbot, usually they mean the chatbot *speaks* back?
            // Or maybe it's a multimodal audio-in audio-out model?
            
            // For simplicity, let's assume it's a Chat Completion model that supports Audio (if available) or just STT.
            // BUT, in the context of "SalesmanChatbot", "voice_model" likely refers to the model used for STT (Transcribing user voice notes).
            // So we should test /audio/transcriptions.
            // However, that requires a file stream.
            // If the user sends a URL in the test input, we might need to fetch it then send.
            
            // Let's implement a basic check. If 'input' is a URL, we try to stream it.
            // Or, we can just try a generic "Hello" to chat completion if it's a multimodal model like GPT-4o-audio?
            
            // Let's stick to Chat Completion for now as safe default, 
            // but if it's an STT model (like whisper), this will fail.
            // I will add a special case if model name contains 'whisper'.
            
            if (model.includes('whisper')) {
                return res.status(400).json({ success: false, error: "Whisper testing not yet supported via URL." });
            }
            
            // Fallback to chat completion (Multimodal Audio Input?)
             const result = await axios.post(
                `${OPENROUTER_API_BASE}/chat/completions`,
                {
                    model: model,
                    messages: [{ role: 'user', content: input || "Hello" }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://orderly-conversations.com',
                        'X-Title': 'SalesmanChatbot Test'
                    }
                }
            );
            responseData = result.data;
            headers = result.headers;
        }

        const duration = Date.now() - start;

        // Extract Rate Limits from Headers
        const rateLimits = {
            limit: headers['x-ratelimit-limit-requests'] || headers['x-ratelimit-limit'],
            remaining: headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'],
            reset: headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset']
        };

        res.json({ 
            success: true, 
            data: responseData, 
            headers: rateLimits,
            latency: duration 
        });

    } catch (error) {
        // console.error('Test Error:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({ 
            success: false, 
            error: error.response ? error.response.data : error.message,
            headers: error.response ? error.response.headers : {}
        });
    }
};
