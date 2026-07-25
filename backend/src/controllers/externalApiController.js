const axios = require('axios');
const crypto = require('crypto');
const pgClient = require('../services/pgClient');

let schemaReady = false;
const upstreamCursors = { aistudio: 0, codex: 0 };

async function ensureDeveloperApiSchema() {
    if (schemaReady) return;

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_keys (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            name TEXT NOT NULL DEFAULT 'Default key',
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ
        )
    `);

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            modalities_in TEXT[] DEFAULT '{}',
            modalities_out TEXT[] DEFAULT '{}',
            input_price NUMERIC DEFAULT 0,
            output_price NUMERIC DEFAULT 0,
            cached_input_price NUMERIC DEFAULT 0,
            context_length INTEGER DEFAULT 0,
            released TEXT DEFAULT '',
            upstream_model TEXT NOT NULL,
            upstream_type TEXT NOT NULL DEFAULT 'aistudio',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pgClient.query(`
        ALTER TABLE developer_api_models
        ADD COLUMN IF NOT EXISTS upstream_type TEXT NOT NULL DEFAULT 'aistudio'
    `);

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_usage (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            api_key_id UUID,
            model TEXT NOT NULL,
            upstream_model TEXT NOT NULL,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            cached_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            cost NUMERIC DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pgClient.query(`
        INSERT INTO developer_api_models (
            id, name, description, modalities_in, modalities_out,
            input_price, output_price, cached_input_price, context_length, released, upstream_model, upstream_type
        ) VALUES
        ('gemini-3.1-pro-preview', 'gemini-3.1-pro-preview', 'AIStudioToProxy Gemini Pro preview model.', ARRAY['text','image','audio','video','pdf'], ARRAY['text'], 2.00, 12.00, 0.20, 1000000, 'Feb 19, 2026', 'gemini-3.1-pro-preview', 'aistudio'),
        ('gemini-3.5-flash', 'gemini-3.5-flash', 'AIStudioToProxy Gemini Flash model.', ARRAY['text','image','audio','video','pdf'], ARRAY['text'], 1.50, 9.00, 0.15, 1000000, 'May 19, 2026', 'gemini-3.5-flash', 'aistudio'),
        ('gemini-3-flash-preview', 'gemini-3-flash-preview', 'AIStudioToProxy Gemini Flash preview model.', ARRAY['text','image','audio','video','pdf'], ARRAY['text'], 0.50, 3.00, 0.05, 1000000, 'Dec 17, 2025', 'gemini-3-flash-preview', 'aistudio'),
        ('gpt-5.5', 'gpt-5.5', 'codex-proxy GPT model.', ARRAY['text','image'], ARRAY['text'], 5.00, 30.00, 0.50, 1000000, 'Apr 25, 2026', 'gpt-5.5', 'codex'),
        ('gpt-5.4-mini', 'gpt-5.4-mini', 'codex-proxy GPT mini model.', ARRAY['text','image'], ARRAY['text'], 0.75, 4.50, 0.075, 400000, 'Mar 17, 2026', 'gpt-5.4-mini', 'codex'),
        ('codex-auto-review', 'codex-auto-review', 'codex-proxy automated code review model.', ARRAY['text'], ARRAY['text'], 0.75, 4.50, 0.075, 400000, 'custom', 'codex-auto-review', 'codex')
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            modalities_in = EXCLUDED.modalities_in,
            modalities_out = EXCLUDED.modalities_out,
            input_price = EXCLUDED.input_price,
            output_price = EXCLUDED.output_price,
            cached_input_price = EXCLUDED.cached_input_price,
            context_length = EXCLUDED.context_length,
            released = EXCLUDED.released,
            upstream_model = EXCLUDED.upstream_model,
            upstream_type = EXCLUDED.upstream_type,
            status = 'active',
            updated_at = NOW()
    `);

    schemaReady = true;
}

function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

function maskKey(key) {
    if (!key) return '';
    if (key.length <= 12) return `${key.slice(0, 4)}...`;
    return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

function createUserApiKey() {
    return `sk-scb-${crypto.randomBytes(32).toString('hex')}`;
}

function getAuthBearer(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return '';
    return authHeader.replace('Bearer ', '').trim();
}

async function validateDeveloperApiKey(req) {
    await ensureDeveloperApiSchema();
    const apiKey = getAuthBearer(req);
    if (!apiKey) {
        return { error: { status: 401, message: 'Missing or invalid Authorization header', type: 'invalid_request_error', code: 'unauthorized' } };
    }

    const result = await pgClient.query(
        `SELECT k.id AS api_key_id, k.user_id, k.status, uc.balance
         FROM developer_api_keys k
         LEFT JOIN user_configs uc ON uc.user_id = k.user_id
         WHERE k.key_hash = $1
         LIMIT 1`,
        [hashKey(apiKey)]
    );

    const row = result.rows[0];
    if (!row) {
        return { error: { status: 401, message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } };
    }
    if (row.status !== 'active') {
        return { error: { status: 403, message: 'API key is disabled', type: 'invalid_request_error', code: 'key_disabled' } };
    }

    return { userConfig: row };
}

function readEnv(name) {
    return String(process.env[name] || process.env[name.toUpperCase()] || '').trim();
}

function getProxyUpstreams(type) {
    const normalizedType = type === 'codex' ? 'codex' : 'aistudio';
    const prefixes = normalizedType === 'codex'
        ? ['CODEX_PROXY', 'PUBLIC_CODEX_PROXY', 'GPT']
        : ['AISTUDIO_PROXY', 'PUBLIC_AISTUDIO_PROXY', 'GEMINI'];

    const indexes = new Set();
    for (const key of Object.keys(process.env)) {
        for (const prefix of prefixes) {
            const lowerPrefix = prefix.toLowerCase();
            const pattern = new RegExp(`^(${prefix}|${lowerPrefix})_(BASE_URL|INTERNAL_KEY|API_KEY)_(\\d+)$`, 'i');
            const match = key.match(pattern);
            if (match) indexes.add(Number(match[3]));
        }
    }

    return [...indexes].sort((a, b) => a - b).map(index => {
        let baseURL = '';
        let apiKey = '';
        for (const prefix of prefixes) {
            baseURL = baseURL || readEnv(`${prefix}_BASE_URL_${index}`);
            apiKey = apiKey || readEnv(`${prefix}_INTERNAL_KEY_${index}`) || readEnv(`${prefix}_API_KEY_${index}`);
        }
        if (!baseURL || !apiKey) return null;
        return {
            type: normalizedType,
            index,
            baseURL: baseURL.replace(/\/+$/, ''),
            apiKey
        };
    }).filter(Boolean);
}

function pickProxyUpstream(type) {
    const normalizedType = type === 'codex' ? 'codex' : 'aistudio';
    const upstreams = getProxyUpstreams(normalizedType);
    if (upstreams.length === 0) {
        throw new Error(
            normalizedType === 'codex'
                ? 'No codex-proxy upstream configured. Set CODEX_PROXY_BASE_URL_1 and CODEX_PROXY_INTERNAL_KEY_1.'
                : 'No AIStudio proxy upstream configured. Set AISTUDIO_PROXY_BASE_URL_1 and AISTUDIO_PROXY_INTERNAL_KEY_1.'
        );
    }
    const selected = upstreams[upstreamCursors[normalizedType] % upstreams.length];
    upstreamCursors[normalizedType] = (upstreamCursors[normalizedType] + 1) % upstreams.length;
    return selected;
}

async function getModel(modelId) {
    await ensureDeveloperApiSchema();
    const result = await pgClient.query(
        `SELECT * FROM developer_api_models WHERE id = $1 AND status = 'active' LIMIT 1`,
        [modelId]
    );
    return result.rows[0] || null;
}

function extractUsageTokens(usage = {}) {
    const inputDetails = usage.prompt_tokens_details || usage.input_tokens_details || {};
    const outputDetails = usage.completion_tokens_details || usage.output_tokens_details || {};
    const promptTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
    const completionTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
    const cachedTokens = Number(
        inputDetails.cached_tokens ||
        inputDetails.cache_read_tokens ||
        usage.cached_tokens ||
        usage.cache_read_input_tokens ||
        0
    );
    const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
    return {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        reasoningTokens: Number(outputDetails.reasoning_tokens || usage.reasoning_tokens || 0)
    };
}

function calculateCost(modelRow, usage) {
    const { promptTokens, completionTokens, cachedTokens } = extractUsageTokens(usage);
    const billablePrompt = Math.max(promptTokens - cachedTokens, 0);
    const inputCost = (billablePrompt / 1000000) * Number(modelRow?.input_price || 0);
    const cachedCost = (cachedTokens / 1000000) * Number(modelRow?.cached_input_price || 0);
    const outputCost = (completionTokens / 1000000) * Number(modelRow?.output_price || 0);
    return Number((inputCost + cachedCost + outputCost).toFixed(8));
}

async function logUsage({ userConfig, modelRow, usage }) {
    const { promptTokens, completionTokens, cachedTokens, totalTokens } = extractUsageTokens(usage);
    const cost = calculateCost(modelRow, usage);

    await pgClient.query(
        `INSERT INTO developer_api_usage
         (user_id, api_key_id, model, upstream_model, prompt_tokens, completion_tokens, cached_tokens, total_tokens, cost)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
        [userConfig.user_id, userConfig.api_key_id, modelRow.id, modelRow.upstream_model, promptTokens, completionTokens, cachedTokens, totalTokens, cost]
    );

    await pgClient.query('UPDATE developer_api_keys SET last_used_at = NOW() WHERE id = $1::uuid', [userConfig.api_key_id]);
    return cost;
}

exports.handleChatCompletion = async (req, res) => {
    try {
        const { userConfig, error } = await validateDeveloperApiKey(req);
        if (error) return res.status(error.status).json({ error: { message: error.message, type: error.type, code: error.code } });

        const requestedModel = req.body?.model;
        if (!requestedModel) {
            return res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error', code: 'missing_model' } });
        }
        const modelRow = await getModel(requestedModel);
        if (!modelRow) {
            return res.status(404).json({ error: { message: `Model ${requestedModel} not found`, type: 'invalid_request_error', code: 'model_not_found' } });
        }

        if (!Array.isArray(req.body?.messages)) {
            return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
        }

        const upstream = pickProxyUpstream(modelRow.upstream_type);
        const upstreamBody = { ...req.body, model: modelRow.upstream_model };
        const targetUrl = `${upstream.baseURL}/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${upstream.apiKey}`,
            'HTTP-Referer': process.env.PUBLIC_SITE_URL || 'https://salesmanchatbot.online',
            'X-Title': 'SalesmanChatbot Developer API'
        };

        if (req.body.stream) {
            const response = await axios.post(targetUrl, upstreamBody, {
                headers,
                responseType: 'stream',
                timeout: 120000,
                validateStatus: () => true
            });
            if (response.status >= 400) {
                const chunks = [];
                response.data.on('data', chunk => chunks.push(chunk));
                response.data.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    res.status(response.status).send(text);
                });
                return;
            }
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            response.data.pipe(res);
            return;
        }

        const response = await axios.post(targetUrl, upstreamBody, {
            headers,
            timeout: 120000,
            validateStatus: () => true
        });

        if (response.status >= 400) {
            return res.status(response.status).json(response.data);
        }

        const data = response.data || {};
        if (data.model) data.model = modelRow.id;
        if (data.usage) {
            const cost = await logUsage({ userConfig, modelRow, usage: data.usage });
            data.usage.cost = cost;
        }

        return res.json(data);
    } catch (error) {
        console.error('[DeveloperAPI] Chat error:', error);
        return res.status(500).json({ error: { message: error.message, type: 'api_error' } });
    }
};

exports.listModels = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const result = await pgClient.query(
            `SELECT * FROM developer_api_models WHERE status = 'active' ORDER BY name ASC`
        );
        res.json({
            object: 'list',
            data: result.rows.map(row => ({
                id: row.id,
                object: 'model',
                created: Math.floor(new Date(row.created_at).getTime() / 1000),
                owned_by: 'salesmanchatbot',
                name: row.name,
                description: row.description,
                modalities: { input: row.modalities_in || [], output: row.modalities_out || [] },
                pricing: {
                    prompt: Number(row.input_price || 0),
                    completion: Number(row.output_price || 0),
                    cached_prompt: Number(row.cached_input_price || 0)
                },
                context_length: Number(row.context_length || 0),
                released: row.released,
                upstream_model: row.upstream_model,
                upstream_type: row.upstream_type || 'aistudio'
            }))
        });
    } catch (error) {
        res.status(500).json({ error: { message: error.message, type: 'api_error' } });
    }
};

exports.getModelDetails = async (req, res) => {
    try {
        const model = await getModel(req.params.modelId);
        if (!model) return res.status(404).json({ error: 'Model not found' });
        res.json(model);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createModel = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const { id, name, description, modalities_in, modalities_out, input_price, output_price, cached_input_price, context_length, released, upstream_model, upstream_type } = req.body || {};
        if (!id || !name || !upstream_model) return res.status(400).json({ error: 'id, name and upstream_model are required' });
        const normalizedUpstreamType = upstream_type === 'codex' ? 'codex' : 'aistudio';

        const result = await pgClient.query(
            `INSERT INTO developer_api_models
             (id, name, description, modalities_in, modalities_out, input_price, output_price, cached_input_price, context_length, released, upstream_model, upstream_type)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                modalities_in = EXCLUDED.modalities_in,
                modalities_out = EXCLUDED.modalities_out,
                input_price = EXCLUDED.input_price,
                output_price = EXCLUDED.output_price,
                cached_input_price = EXCLUDED.cached_input_price,
                context_length = EXCLUDED.context_length,
                released = EXCLUDED.released,
                upstream_model = EXCLUDED.upstream_model,
                upstream_type = EXCLUDED.upstream_type,
                status = 'active',
                updated_at = NOW()
             RETURNING *`,
            [id, name, description || '', modalities_in || ['text'], modalities_out || ['text'], input_price || 0, output_price || 0, cached_input_price || 0, context_length || 0, released || '', upstream_model, normalizedUpstreamType]
        );
        res.json({ success: true, model: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteModel = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        await pgClient.query(`UPDATE developer_api_models SET status = 'deleted', updated_at = NOW() WHERE id = $1`, [req.params.modelId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getApiKeys = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const result = await pgClient.query(
            `SELECT id, name, key_prefix, status, created_at, last_used_at
             FROM developer_api_keys WHERE user_id = $1::uuid ORDER BY created_at DESC`,
            [userId]
        );
        res.json({ keys: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createApiKey = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const name = String(req.body?.name || 'Default key').trim() || 'Default key';
        const apiKey = createUserApiKey();
        const result = await pgClient.query(
            `INSERT INTO developer_api_keys (user_id, name, key_hash, key_prefix)
             VALUES ($1::uuid, $2, $3, $4)
             RETURNING id, name, key_prefix, status, created_at`,
            [userId, name, hashKey(apiKey), maskKey(apiKey)]
        );
        res.json({ success: true, api_key: apiKey, key: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.disableApiKey = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        await pgClient.query(
            `UPDATE developer_api_keys SET status = CASE WHEN status = 'active' THEN 'disabled' ELSE 'active' END WHERE id = $1::uuid AND user_id = $2::uuid`,
            [req.params.keyId, userId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteApiKey = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        await pgClient.query(`DELETE FROM developer_api_keys WHERE id = $1::uuid AND user_id = $2::uuid`, [req.params.keyId, userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getApiKey = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const result = await pgClient.query(
            `SELECT id, name, key_prefix, status, created_at, last_used_at FROM developer_api_keys WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        res.json({ api_key: result.rows[0]?.key_prefix || null, key: result.rows[0] || null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch API key', details: error.message });
    }
};

exports.regenerateApiKey = exports.createApiKey;

exports.getUsageStats = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 20);
        const offset = (page - 1) * limit;

        const statsResult = await pgClient.query(
            `SELECT * FROM developer_api_usage WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        const countResult = await pgClient.query(`SELECT COUNT(*)::int AS total FROM developer_api_usage WHERE user_id = $1::uuid`, [userId]);
        const summaryResult = await pgClient.query(
            `SELECT
                COALESCE(SUM(cost), 0)::float AS total_cost,
                COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                COUNT(*)::int AS total_requests,
                COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN cost ELSE 0 END), 0)::float AS today_cost,
                COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_tokens ELSE 0 END), 0)::int AS today_tokens,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_requests
             FROM developer_api_usage WHERE user_id = $1::uuid`,
            [userId]
        );

        const total = countResult.rows[0]?.total || 0;
        res.json({
            stats: statsResult.rows,
            pagination: { total_records: total, total_pages: Math.max(Math.ceil(total / limit), 1), current_page: page, limit },
            summary: summaryResult.rows[0] || { total_cost: 0, total_tokens: 0, total_requests: 0, today_cost: 0, today_tokens: 0, today_requests: 0 }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch usage statistics', details: error.message });
    }
};

exports.updateUserConfig = async (req, res) => res.json({ success: true, message: 'Developer API uses AIStudioToProxy and codex-proxy upstream env pools.' });
exports.getUserConfig = async (req, res) => res.json({
    platform: 'salesmanchatbot-cloud-api',
    upstreams: {
        aistudio: getProxyUpstreams('aistudio').map(({ apiKey, ...item }) => item),
        codex: getProxyUpstreams('codex').map(({ apiKey, ...item }) => item)
    }
});
exports.transcribeAudio = async (req, res) => res.status(501).json({ error: { message: 'Use /v1/chat/completions with audio-capable models.', type: 'not_implemented' } });
