try {
    require('dotenv').config();
} catch (_) {}

const DEFAULT_VOICE_PROMPT = "Transcribe the attached audio exactly. The speaker is most likely using Bangla/Bengali, including Bangladeshi colloquial speech and regional dialects such as Sylheti, Dhakaiya, Chattogrami, Barishali, Rangpuri, Noakhali, or mixed Bangla-English. Do not translate or summarize. Keep Bangla words in Bangla script when possible. If a word is unclear, infer from Bangladeshi customer-chat context. Output ONLY the transcription text.";
const DEFAULT_AUDIO_URL = "https://cdn.fbsbx.com/v/t59.3654-21/755538552_1649017729523978_664719215485325532_n.aac/audioclip-1784959164000-8128.aac?sdl=1&_nc_cat=100&ccb=1-7&_nc_sid=d61c36&_nc_ohc=VXXn_IRNCeMQ7kNvwGBiFRa&_nc_oc=AdpiIbG87Id3vmreKCKDhzUsam_0dLVqBtxd40P1YuEMrt68mbIrZfSRGNy4obYuAekRUV_zjY9pq-DoxPVR9VwW&_nc_ad=z-m&_nc_cid=0&_nc_zt=7&_nc_ht=cdn.fbsbx.com&_nc_gid=3UDts1KH2NDyrhrpGaDGgQ&oh=03_Q7cD5wEN4I9RqBBVY0ODxyKCSUqGrQUnby4401gamGcIoOJxAw&oe=6A6A24D1";

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i++) {
        const current = argv[i];
        if (!current.startsWith('--')) continue;
        const key = current.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
            continue;
        }
        parsed[key] = next;
        i += 1;
    }
    return parsed;
}

function getValue(args, key, envKey, fallback = '') {
    return String(args[key] || process.env[envKey] || fallback).trim();
}

function mapMimeType(contentType, audioUrl) {
    const value = String(contentType || '').toLowerCase();
    const url = String(audioUrl || '').toLowerCase();

    if (value.includes('opus') || value.includes('ogg')) return 'audio/ogg';
    if (value.includes('mp3') || value.includes('mpeg')) return 'audio/mpeg';
    if (value.includes('wav')) return 'audio/wav';
    if (value.includes('aac') || value.includes('mp4') || value.includes('m4a')) return 'audio/mp4';

    if (url.includes('.mp4') || url.includes('.aac') || url.includes('.m4a')) return 'audio/mp4';
    if (url.includes('.mp3') || url.includes('.mpeg')) return 'audio/mpeg';
    if (url.includes('.wav')) return 'audio/wav';
    return 'audio/ogg';
}

function getFileFormat(mimeType) {
    if (mimeType === 'audio/mpeg') return 'mp3';
    if (mimeType === 'audio/mp4') return 'mp4';
    if (mimeType === 'audio/wav') return 'wav';
    if (mimeType === 'audio/ogg') return 'ogg';
    return (String(mimeType || '').split('/')[1] || 'mp3').trim();
}

function truncate(text, max = 220) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value;
    return `${value.slice(0, max - 3)}...`;
}

function buildTargets(args) {
    const customBaseUrl = getValue(args, 'custom-base-url', 'CUSTOM_BASE_URL', 'http://lgc4kgs08k844kok08kws400.72.62.196.104.sslip.io/v1');
    const customApiKey = getValue(args, 'custom-api-key', 'CUSTOM_API_KEY');
    const customModelsRaw = getValue(args, 'custom-models', 'CUSTOM_MODELS', 'gemini-3.6-flash,gemini-3.5-flash');
    const customModels = customModelsRaw.split(',').map((item) => item.trim()).filter(Boolean);

    const openrouterApiKey = getValue(args, 'openrouter-api-key', 'OPENROUTER_API_KEY');
    const openrouterModel = getValue(args, 'openrouter-model', 'OPENROUTER_MODEL', 'groq');

    const targets = [];

    for (const model of customModels) {
        targets.push({
            kind: 'custom',
            label: `custom:${model}`,
            baseUrl: customBaseUrl,
            model,
            apiKey: customApiKey
        });
    }

    targets.push({
        kind: 'openrouter',
        label: `openrouter:${openrouterModel}`,
        baseUrl: 'https://openrouter.ai/api/v1',
        model: openrouterModel,
        apiKey: openrouterApiKey
    });

    return targets;
}

async function downloadAudio(audioUrl) {
    const response = await fetch(audioUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) {
        throw new Error(`Audio download failed with status ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const mimeType = mapMimeType(contentType, audioUrl);

    return {
        buffer,
        contentType,
        mimeType,
        format: getFileFormat(mimeType)
    };
}

async function callCustomTarget(target, audio, voicePrompt) {
    const normalizedBaseUrl = target.baseUrl.replace(/\/+$/, '');
    const prefersChatCompletions = /gemini/i.test(target.model) || /gemini/i.test(normalizedBaseUrl);

    const callCustomTranscriptions = async () => {
        const formData = new FormData();
        const blob = new Blob([audio.buffer], { type: audio.mimeType });
        formData.append('file', blob, `audio.${audio.format}`);
        formData.append('model', target.model);
        formData.append('language', 'bn');
        formData.append('prompt', 'Bangladeshi Bangla customer voice note. Possible dialects: Sylheti, Dhakaiya, Chattogrami, Barishali, Rangpuri, Noakhali. Mixed Bangla-English is common.');

        const response = await fetch(`${normalizedBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${target.apiKey}`
            },
            body: formData,
            signal: AbortSignal.timeout(90000)
        });
        return response;
    };

    const callCustomChatCompletions = async () => {
        const payload = {
            model: target.model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: voicePrompt },
                    {
                        type: 'input_audio',
                        input_audio: {
                            data: audio.buffer.toString('base64'),
                            format: audio.format
                        }
                    }
                ]
            }]
        };

        return fetch(`${normalizedBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.apiKey}`
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(90000)
        });
    };

    if (prefersChatCompletions) {
        try {
            const response = await callCustomChatCompletions();
            if (!response.ok) {
                const errorBody = await safeJson(response);
                throw createHttpError(response.status, errorBody, `Custom chat request failed with status ${response.status}`);
            }
            const data = await response.json();
            return {
                text: data?.choices?.[0]?.message?.content || '',
                usage: data?.usage || null,
                endpoint: '/chat/completions',
                raw: data
            };
        } catch (error) {
            const statusCode = error.status;
            const errorMessage = String(error.message || '').toLowerCase();
            const canFallback = [404, 405, 406, 408, 415, 422, 429, 500, 501, 502, 503, 504].includes(statusCode) ||
                errorMessage.includes('not found') ||
                errorMessage.includes('unsupported') ||
                errorMessage.includes('invalid');
            if (!canFallback) throw error;
        }
    }

    const response = await callCustomTranscriptions();
    if (!response.ok) {
        const errorBody = await safeJson(response);
        throw createHttpError(response.status, errorBody, `Custom transcription request failed with status ${response.status}`);
    }
    const data = await response.json();
    return {
        text: data?.text || '',
        usage: data?.usage || null,
        endpoint: '/audio/transcriptions',
        raw: data
    };
}

async function callOpenRouterTarget(target, audio) {
    const payload = {
        model: target.model,
        input_audio: {
            data: audio.buffer.toString('base64'),
            format: audio.format
        },
        language: 'bn'
    };

    const response = await fetch(`${target.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${target.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://salesmanchatbot.local',
            'X-Title': 'SalesmanChatbot Audio Test'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) {
        const errorBody = await safeJson(response);
        throw createHttpError(response.status, errorBody, `OpenRouter transcription request failed with status ${response.status}`);
    }
    const data = await response.json();

    return {
        text: data?.text || '',
        usage: data?.usage || null,
        endpoint: '/audio/transcriptions',
        raw: data
    };
}

function createHttpError(status, data, message) {
    const error = new Error(message);
    error.status = status;
    error.data = data;
    return error;
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (_) {
        try {
            return await response.text();
        } catch (_) {
            return null;
        }
    }
}

async function testTarget(target, audio, voicePrompt) {
    const startedAt = Date.now();
    try {
        if (!target.apiKey) {
            throw new Error(`Missing API key for ${target.label}`);
        }

        let result;
        if (target.kind === 'custom') {
            result = await callCustomTarget(target, audio, voicePrompt);
        } else if (target.kind === 'openrouter') {
            result = await callOpenRouterTarget(target, audio);
        } else {
            throw new Error(`Unsupported target kind: ${target.kind}`);
        }

        return {
            label: target.label,
            status: result.text ? 'success' : 'empty',
            endpoint: result.endpoint,
            elapsedMs: Date.now() - startedAt,
            transcript: String(result.text || '').trim(),
            usage: result.usage,
            raw: result.raw
        };
    } catch (error) {
        return {
            label: target.label,
            status: 'error',
            endpoint: target.kind === 'custom' ? 'custom' : '/audio/transcriptions',
            elapsedMs: Date.now() - startedAt,
            transcript: '',
            usage: null,
            error: {
                message: error.message,
                    status: error.status || null,
                    data: error.data || null
            }
        };
    }
}

function printSummary(audioUrl, audio, results) {
    console.log('\n============================================================');
    console.log('AUDIO TRANSCRIPTION COMPARISON');
    console.log('============================================================');
    console.log(`Audio URL   : ${audioUrl}`);
    console.log(`Content-Type: ${audio.contentType || 'unknown'}`);
    console.log(`Mapped MIME : ${audio.mimeType}`);
    console.log(`Size        : ${(audio.buffer.length / 1024).toFixed(2)} KB`);

    for (const result of results) {
        console.log('\n------------------------------------------------------------');
        console.log(`Target   : ${result.label}`);
        console.log(`Status   : ${result.status}`);
        console.log(`Endpoint : ${result.endpoint}`);
        console.log(`Latency  : ${result.elapsedMs} ms`);
        if (result.usage) {
            console.log(`Usage    : ${JSON.stringify(result.usage)}`);
        }
        if (result.transcript) {
            console.log(`Preview  : ${truncate(result.transcript)}`);
            console.log('Transcript:');
            console.log(result.transcript);
        }
        if (result.error) {
            console.log(`Error    : ${result.error.message}`);
            if (result.error.status) console.log(`HTTP     : ${result.error.status}`);
            if (result.error.data) console.log(`Details  : ${truncate(JSON.stringify(result.error.data), 500)}`);
        }
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const audioUrl = getValue(args, 'audio-url', 'AUDIO_URL', DEFAULT_AUDIO_URL);
    const voicePrompt = getValue(args, 'voice-prompt', 'VOICE_PROMPT', DEFAULT_VOICE_PROMPT);
    const targets = buildTargets(args);

    console.log(`[Setup] Downloading audio from ${audioUrl}`);
    const audio = await downloadAudio(audioUrl);
    console.log(`[Setup] Downloaded ${(audio.buffer.length / 1024).toFixed(2)} KB as ${audio.mimeType}`);

    const results = [];
    for (const target of targets) {
        console.log(`\n[Run] Testing ${target.label}`);
        const result = await testTarget(target, audio, voicePrompt);
        results.push(result);
    }

    printSummary(audioUrl, audio, results);

    const failed = results.filter((result) => result.status === 'error').length;
    if (failed === results.length) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('[Fatal]', error.message);
    process.exit(1);
});
