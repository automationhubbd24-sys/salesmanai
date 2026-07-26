const axios = require('axios');
const crypto = require('crypto');
const pgClient = require('../services/pgClient');

let schemaReady = false;
const upstreamCursors = { aistudio: 0, codex: 0, gemini: 0, gpt: 0, custom: 0 };
const responseCache = new Map();

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
    await pgClient.query(`ALTER TABLE developer_api_models ADD COLUMN IF NOT EXISTS max_tokens INTEGER DEFAULT 0`);
    await pgClient.query(`ALTER TABLE developer_api_models ADD COLUMN IF NOT EXISTS max_requests_per_day INTEGER DEFAULT 0`);
    await pgClient.query(`ALTER TABLE developer_api_models ADD COLUMN IF NOT EXISTS cache_enabled BOOLEAN DEFAULT true`);
    await pgClient.query(`ALTER TABLE developer_api_models ADD COLUMN IF NOT EXISTS admin_published BOOLEAN DEFAULT false`);

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_servers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'custom',
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            supported_models TEXT[] DEFAULT '{}',
            max_tokens INTEGER DEFAULT 0,
            max_requests_per_minute INTEGER DEFAULT 0,
            max_requests_per_hour INTEGER DEFAULT 0,
            max_requests_per_day INTEGER DEFAULT 0,
            max_tokens_per_day INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_response_cache (
            cache_key TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            response JSONB NOT NULL,
            prompt_tokens INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS developer_api_usage (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            api_key_id UUID,
            server_id UUID,
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

    await pgClient.query(`ALTER TABLE developer_api_usage ADD COLUMN IF NOT EXISTS server_id UUID`);

    await pgClient.query(`UPDATE developer_api_models SET status = 'deleted' WHERE COALESCE(admin_published, false) = false`);

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

async function pickConfiguredUpstream(modelRow) {
    const result = await pgClient.query(
        `SELECT * FROM developer_api_servers
         WHERE status = 'active'
           AND (provider = $1 OR $1 = 'custom' OR provider = 'custom')
           AND (cardinality(supported_models) = 0 OR $2 = ANY(supported_models) OR $3 = ANY(supported_models))
         ORDER BY updated_at DESC`,
        [modelRow.upstream_type || 'custom', modelRow.id, modelRow.upstream_model]
    );
    if (!result.rows.length) return null;
    const key = modelRow.upstream_type || 'custom';
    const selected = result.rows[upstreamCursors[key] % result.rows.length];
    upstreamCursors[key] = (upstreamCursors[key] + 1) % result.rows.length;
    return {
        id: selected.id,
        type: selected.provider,
        baseURL: selected.base_url.replace(/\/+$/, ''),
        apiKey: selected.api_key,
        limits: selected
    };
}

async function pickProxyUpstream(modelRow) {
    const configured = await pickConfiguredUpstream(modelRow);
    if (configured) return configured;
    const normalizedType = modelRow.upstream_type === 'codex' ? 'codex' : 'aistudio';
    const upstreams = getProxyUpstreams(normalizedType);
    if (upstreams.length === 0) {
        throw new Error(
            normalizedType === 'codex'
                ? 'No codex-proxy upstream configured. Add an admin server or set CODEX_PROXY_BASE_URL_1 and CODEX_PROXY_INTERNAL_KEY_1.'
                : 'No AIStudio proxy upstream configured. Add an admin server or set AISTUDIO_PROXY_BASE_URL_1 and AISTUDIO_PROXY_INTERNAL_KEY_1.'
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

function buildCacheKey(modelRow, body) {
    const payload = JSON.stringify({ model: modelRow.id, messages: body.messages, temperature: body.temperature || 0, tools: body.tools || null });
    return crypto.createHash('sha256').update(payload).digest('hex');
}

async function readCachedResponse(cacheKey) {
    if (responseCache.has(cacheKey)) return responseCache.get(cacheKey);
    const result = await pgClient.query('SELECT response FROM developer_api_response_cache WHERE cache_key = $1 LIMIT 1', [cacheKey]);
    const cached = result.rows[0]?.response || null;
    if (cached) responseCache.set(cacheKey, cached);
    return cached;
}

async function writeCachedResponse(cacheKey, modelRow, data) {
    const usage = extractUsageTokens(data.usage || {});
    await pgClient.query(
        `INSERT INTO developer_api_response_cache (cache_key, model, response, prompt_tokens)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, prompt_tokens = EXCLUDED.prompt_tokens, created_at = NOW()`,
        [cacheKey, modelRow.id, JSON.stringify(data), usage.promptTokens]
    );
    responseCache.set(cacheKey, data);
}

async function enforceUpstreamLimits(upstream) {
    if (!upstream?.id || !upstream.limits) return null;

    const checks = [
        { field: 'max_requests_per_minute', interval: '1 minute', label: 'per-minute' },
        { field: 'max_requests_per_hour', interval: '1 hour', label: 'hourly' },
        { field: 'max_requests_per_day', interval: '1 day', label: 'daily' }
    ];

    for (const check of checks) {
        const limit = Number(upstream.limits[check.field] || 0);
        if (limit <= 0) continue;

        const result = await pgClient.query(
            `SELECT COUNT(*)::int AS requests
             FROM developer_api_usage
             WHERE server_id = $1::uuid
               AND created_at >= NOW() - ($2::interval)`,
            [upstream.id, check.interval]
        );

        if (Number(result.rows[0]?.requests || 0) >= limit) {
            return {
                status: 429,
                error: {
                    message: `Upstream server ${check.label} request limit reached`,
                    type: 'rate_limit_error',
                    code: `upstream_${check.field}`
                }
            };
        }
    }

    const tokenLimit = Number(upstream.limits.max_tokens_per_day || 0);
    if (tokenLimit > 0) {
        const tokenResult = await pgClient.query(
            `SELECT COALESCE(SUM(total_tokens), 0)::int AS tokens
             FROM developer_api_usage
             WHERE server_id = $1::uuid AND created_at >= CURRENT_DATE`,
            [upstream.id]
        );
        if (Number(tokenResult.rows[0]?.tokens || 0) >= tokenLimit) {
            return { status: 429, error: { message: 'Upstream server daily token limit reached', type: 'rate_limit_error', code: 'upstream_token_daily_limit' } };
        }
    }

    return null;
}

async function logUsage({ userConfig, modelRow, usage, serverId = null }) {
    const { promptTokens, completionTokens, cachedTokens, totalTokens } = extractUsageTokens(usage);
    const cost = calculateCost(modelRow, usage);

    await pgClient.query(
        `INSERT INTO developer_api_usage
         (user_id, api_key_id, server_id, model, upstream_model, prompt_tokens, completion_tokens, cached_tokens, total_tokens, cost)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
        [userConfig.user_id, userConfig.api_key_id, serverId, modelRow.id, modelRow.upstream_model, promptTokens, completionTokens, cachedTokens, totalTokens, cost]
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

        if (Number(modelRow.max_requests_per_day || 0) > 0) {
            const daily = await pgClient.query(
                `SELECT COUNT(*)::int AS requests FROM developer_api_usage WHERE user_id = $1::uuid AND model = $2 AND created_at >= CURRENT_DATE`,
                [userConfig.user_id, modelRow.id]
            );
            if (Number(daily.rows[0]?.requests || 0) >= Number(modelRow.max_requests_per_day)) {
                return res.status(429).json({ error: { message: `Daily request limit reached for ${modelRow.id}`, type: 'rate_limit_error', code: 'model_daily_limit' } });
            }
        }
        if (Number(modelRow.max_tokens || 0) > 0) {
            req.body.max_tokens = Math.min(Number(req.body.max_tokens || modelRow.max_tokens), Number(modelRow.max_tokens));
        }

        const cacheKey = !req.body.stream && modelRow.cache_enabled ? buildCacheKey(modelRow, req.body) : null;
        if (cacheKey) {
            const cached = await readCachedResponse(cacheKey);
            if (cached) {
                const data = JSON.parse(JSON.stringify(cached));
                const promptTokens = Number(data.usage?.prompt_tokens || data.usage?.input_tokens || 0);
                data.model = modelRow.id;
                data.usage = {
                    ...(data.usage || {}),
                    cached_tokens: promptTokens,
                    prompt_tokens_details: { ...(data.usage?.prompt_tokens_details || {}), cached_tokens: promptTokens },
                    cache_hit: true
                };
                const cost = await logUsage({ userConfig, modelRow, usage: data.usage });
                data.usage.cost = cost;
                return res.json(data);
            }
        }

        const upstream = await pickProxyUpstream(modelRow);
        const upstreamLimitError = await enforceUpstreamLimits(upstream);
        if (upstreamLimitError) {
            return res.status(upstreamLimitError.status).json({ error: upstreamLimitError.error });
        }

        const upstreamBody = { ...req.body, model: modelRow.upstream_model };
        if (Number(upstream.limits?.max_tokens || 0) > 0) {
            upstreamBody.max_tokens = Math.min(Number(upstreamBody.max_tokens || upstream.limits.max_tokens), Number(upstream.limits.max_tokens));
        }
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
            const cost = await logUsage({ userConfig, modelRow, usage: data.usage, serverId: upstream.id || null });
            data.usage.cost = cost;
        }
        if (cacheKey) await writeCachedResponse(cacheKey, modelRow, data);

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
            `SELECT * FROM developer_api_models WHERE status = 'active' AND COALESCE(admin_published, false) = true ORDER BY name ASC`
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
        const { id, name, description, modalities_in, modalities_out, input_price, output_price, cached_input_price, context_length, released, upstream_model, upstream_type, max_tokens, max_requests_per_day, cache_enabled } = req.body || {};
        if (!id || !name || !upstream_model) return res.status(400).json({ error: 'id, name and upstream_model are required' });
        const normalizedUpstreamType = ['aistudio', 'codex', 'gemini', 'gpt', 'custom'].includes(upstream_type) ? upstream_type : 'custom';

        const result = await pgClient.query(
            `INSERT INTO developer_api_models
             (id, name, description, modalities_in, modalities_out, input_price, output_price, cached_input_price, context_length, released, upstream_model, upstream_type, max_tokens, max_requests_per_day, cache_enabled, admin_published)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)
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
                max_tokens = EXCLUDED.max_tokens,
                max_requests_per_day = EXCLUDED.max_requests_per_day,
                cache_enabled = EXCLUDED.cache_enabled,
                admin_published = true,
                status = 'active',
                updated_at = NOW()
             RETURNING *`,
            [id, name, description || '', modalities_in || ['text'], modalities_out || ['text'], input_price || 0, output_price || 0, cached_input_price || 0, context_length || 0, released || '', upstream_model, normalizedUpstreamType, max_tokens || 0, max_requests_per_day || 0, cache_enabled !== false]
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

exports.adminListModels = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const result = await pgClient.query(`SELECT * FROM developer_api_models WHERE status <> 'deleted' AND COALESCE(admin_published, false) = true ORDER BY updated_at DESC`);
        res.json({ models: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.adminListServers = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const result = await pgClient.query(`SELECT id, name, provider, base_url, supported_models, max_tokens, max_requests_per_minute, max_requests_per_hour, max_requests_per_day, max_tokens_per_day, status, created_at, updated_at FROM developer_api_servers WHERE status <> 'deleted' ORDER BY updated_at DESC`);
        res.json({ servers: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.upsertServer = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        const { id, name, provider, base_url, api_key, supported_models, max_tokens, max_requests_per_minute, max_requests_per_hour, max_requests_per_day, max_tokens_per_day, status } = req.body || {};
        if (!name || !base_url || !api_key) return res.status(400).json({ error: 'name, base_url and api_key are required' });
        const models = Array.isArray(supported_models) ? supported_models : String(supported_models || '').split(',').map(v => v.trim()).filter(Boolean);
        const result = await pgClient.query(
            `INSERT INTO developer_api_servers (id, name, provider, base_url, api_key, supported_models, max_tokens, max_requests_per_minute, max_requests_per_hour, max_requests_per_day, max_tokens_per_day, status)
             VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                provider = EXCLUDED.provider,
                base_url = EXCLUDED.base_url,
                api_key = EXCLUDED.api_key,
                supported_models = EXCLUDED.supported_models,
                max_tokens = EXCLUDED.max_tokens,
                max_requests_per_minute = EXCLUDED.max_requests_per_minute,
                max_requests_per_hour = EXCLUDED.max_requests_per_hour,
                max_requests_per_day = EXCLUDED.max_requests_per_day,
                max_tokens_per_day = EXCLUDED.max_tokens_per_day,
                status = EXCLUDED.status,
                updated_at = NOW()
             RETURNING id, name, provider, base_url, supported_models, max_tokens, max_requests_per_minute, max_requests_per_hour, max_requests_per_day, max_tokens_per_day, status, created_at, updated_at`,
            [id || null, name, provider || 'custom', base_url.replace(/\/+$/, ''), api_key, models, max_tokens || 0, max_requests_per_minute || 0, max_requests_per_hour || 0, max_requests_per_day || 0, max_tokens_per_day || 0, status || 'active']
        );
        res.json({ success: true, server: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteServer = async (req, res) => {
    try {
        await ensureDeveloperApiSchema();
        await pgClient.query(`UPDATE developer_api_servers SET status = 'deleted', updated_at = NOW() WHERE id = $1::uuid`, [req.params.serverId]);
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
        const from = req.query.from ? new Date(String(req.query.from)) : null;
        const to = req.query.to ? new Date(String(req.query.to)) : null;
        const model = String(req.query.model || '').trim();
        const filters = ['user_id = $1::uuid'];
        const params = [userId];

        if (model) {
            params.push(model);
            filters.push(`model = $${params.length}`);
        }

        if (from && !Number.isNaN(from.getTime())) {
            params.push(from.toISOString());
            filters.push(`created_at >= $${params.length}::timestamptz`);
        }
        if (to && !Number.isNaN(to.getTime())) {
            params.push(to.toISOString());
            filters.push(`created_at <= $${params.length}::timestamptz`);
        }

        const whereClause = filters.join(' AND ');
        const statsParams = [...params, limit, offset];
        const statsResult = await pgClient.query(
            `SELECT * FROM developer_api_usage WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            statsParams
        );
        const countResult = await pgClient.query(`SELECT COUNT(*)::int AS total FROM developer_api_usage WHERE ${whereClause}`, params);
        const summaryResult = await pgClient.query(
            `SELECT
                COALESCE(SUM(cost), 0)::float AS total_cost,
                COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                COUNT(*)::int AS total_requests
             FROM developer_api_usage WHERE ${whereClause}`,
            params
        );
        const modelBreakdownResult = await pgClient.query(
            `SELECT
                model,
                COUNT(*)::int AS requests,
                COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                COALESCE(SUM(cost), 0)::float AS total_cost
             FROM developer_api_usage
             WHERE ${whereClause}
             GROUP BY model
             ORDER BY requests DESC, model ASC`,
            params
        );

        const total = countResult.rows[0]?.total || 0;
        res.json({
            stats: statsResult.rows,
            model_breakdown: modelBreakdownResult.rows,
            pagination: { total_records: total, total_pages: Math.max(Math.ceil(total / limit), 1), current_page: page, limit },
            summary: summaryResult.rows[0] || { total_cost: 0, total_tokens: 0, total_requests: 0 }
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
