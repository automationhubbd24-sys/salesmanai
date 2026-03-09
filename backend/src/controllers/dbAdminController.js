const pgClient = require('../services/pgClient');

function isSafeIdentifier(name) {
    return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

exports.listTables = async (req, res) => {
    try {
        const result = await pgClient.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_type = 'BASE TABLE'
             ORDER BY table_name`
        );
        res.json({ success: true, tables: result.rows.map(r => r.table_name) });
    } catch (error) {
        console.error('DB Admin listTables error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getTableData = async (req, res) => {
    try {
        const table = req.params.table;
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const offset = parseInt(req.query.offset || '0', 10);

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }

        const columnsResult = await pgClient.query(
            `SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = $1
             ORDER BY ordinal_position`,
            [table]
        );

        const dataResult = await pgClient.query(
            `SELECT *
             FROM ${table}
             ORDER BY 1
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        res.json({
            success: true,
            columns: columnsResult.rows,
            rows: dataResult.rows,
            limit,
            offset,
        });
    } catch (error) {
        console.error('DB Admin getTableData error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.insertRow = async (req, res) => {
    try {
        const table = req.params.table;
        const row = req.body && req.body.row;

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        if (!row || typeof row !== 'object') {
            return res.status(400).json({ success: false, error: 'Missing row payload' });
        }

        const columns = Object.keys(row);
        if (columns.length === 0) {
            return res.status(400).json({ success: false, error: 'Row has no columns' });
        }

        for (const col of columns) {
            if (!isSafeIdentifier(col)) {
                return res.status(400).json({ success: false, error: `Invalid column name: ${col}` });
            }
        }

        const values = Object.values(row);
        const placeholders = values.map((_, idx) => `$${idx + 1}`);

        const queryText = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`;
        const result = await pgClient.query(queryText, values);

        res.json({ success: true, row: result.rows[0] });
    } catch (error) {
        console.error('DB Admin insertRow error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateRow = async (req, res) => {
    try {
        const table = req.params.table;
        const { keyColumn, keyValue, row } = req.body || {};

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        if (!isSafeIdentifier(keyColumn || '')) {
            return res.status(400).json({ success: false, error: 'Invalid key column' });
        }
        if (!row || typeof row !== 'object') {
            return res.status(400).json({ success: false, error: 'Missing row payload' });
        }

        const columns = Object.keys(row).filter(col => col !== keyColumn);
        if (columns.length === 0) {
            return res.status(400).json({ success: false, error: 'Nothing to update' });
        }

        for (const col of columns) {
            if (!isSafeIdentifier(col)) {
                return res.status(400).json({ success: false, error: `Invalid column name: ${col}` });
            }
        }

        const setFragments = columns.map((col, idx) => `${col} = $${idx + 1}`);
        const values = columns.map(col => row[col]);
        values.push(keyValue);
        const keyIndex = values.length;

        const queryText = `UPDATE ${table} SET ${setFragments.join(', ')} WHERE ${keyColumn} = $${keyIndex} RETURNING *`;
        const result = await pgClient.query(queryText, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Row not found' });
        }

        res.json({ success: true, row: result.rows[0] });
    } catch (error) {
        console.error('DB Admin updateRow error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteRow = async (req, res) => {
    try {
        const table = req.params.table;
        const { keyColumn, keyValue } = req.body || {};

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        if (!isSafeIdentifier(keyColumn || '')) {
            return res.status(400).json({ success: false, error: 'Invalid key column' });
        }

        const queryText = `DELETE FROM ${table} WHERE ${keyColumn} = $1`;
        const result = await pgClient.query(queryText, [keyValue]);

        res.json({ success: true, deletedCount: result.rowCount || 0 });
    } catch (error) {
        console.error('DB Admin deleteRow error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.runSql = async (req, res) => {
    try {
        const sql = req.body && req.body.sql;
        if (!sql || typeof sql !== 'string' || !sql.trim()) {
            return res.status(400).json({ success: false, error: 'SQL query is required' });
        }

        const text = sql.trim();
        if (/drop\s+database/i.test(text)) {
            return res.status(400).json({ success: false, error: 'DROP DATABASE is not allowed' });
        }

        const result = await pgClient.query(text);

        res.json({
            success: true,
            rows: result.rows || [],
            fields: Array.isArray(result.fields) ? result.fields.map(f => f.name) : [],
            rowCount: typeof result.rowCount === 'number' ? result.rowCount : null,
            command: result.command || null,
        });
    } catch (error) {
        console.error('DB Admin runSql error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createTable = async (req, res) => {
    try {
        const table = req.body && req.body.table;
        const columns = (req.body && req.body.columns) || [];

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        if (!Array.isArray(columns) || columns.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one column is required' });
        }

        const columnDefs = [];
        for (const col of columns) {
            const name = col && col.name;
            const type = col && col.type;
            const nullable = Boolean(col && col.nullable);

            if (!isSafeIdentifier(name || '')) {
                return res.status(400).json({ success: false, error: `Invalid column name: ${name}` });
            }
            if (typeof type !== 'string' || !type.trim()) {
                return res.status(400).json({ success: false, error: `Invalid type for column: ${name}` });
            }

            const defParts = [`${name} ${type.trim()}`];
            if (!nullable) {
                defParts.push('NOT NULL');
            }
            columnDefs.push(defParts.join(' '));
        }

        const sql = `CREATE TABLE IF NOT EXISTS public.${table} (${columnDefs.join(', ')})`;
        await pgClient.query(sql);

        res.json({ success: true });
    } catch (error) {
        console.error('DB Admin createTable error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addColumn = async (req, res) => {
    try {
        const table = req.params.table;
        const column = req.body && req.body.column;

        if (!isSafeIdentifier(table)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        if (!column || typeof column !== 'object') {
            return res.status(400).json({ success: false, error: 'Column payload is required' });
        }

        const name = column.name;
        const type = column.type;
        const nullable = Boolean(column.nullable);

        if (!isSafeIdentifier(name || '')) {
            return res.status(400).json({ success: false, error: `Invalid column name: ${name}` });
        }
        if (typeof type !== 'string' || !type.trim()) {
            return res.status(400).json({ success: false, error: 'Invalid column type' });
        }

        const parts = [`ADD COLUMN IF NOT EXISTS ${name} ${type.trim()}`];
        if (!nullable) {
            parts.push('NOT NULL');
        }

        const sql = `ALTER TABLE public.${table} ${parts.join(' ')}`;
        await pgClient.query(sql);

        res.json({ success: true });
    } catch (error) {
        console.error('DB Admin addColumn error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// --- Semantic Cache: Global Embedding Config (Admin Only) ---
exports.getEmbeddingGlobalConfig = async (req, res) => {
    try {
        const pgClient = require('../services/pgClient');
        
        // Quick Repair for openrouter_engine_config
        try {
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS public.openrouter_engine_config (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    config_type TEXT UNIQUE DEFAULT 'best_models',
                    text_model TEXT,
                    text_model_details JSONB,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await pgClient.query(`ALTER TABLE openrouter_engine_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
            await pgClient.query(`ALTER TABLE openrouter_engine_config ADD COLUMN IF NOT EXISTS text_model_details JSONB`);
        } catch (e) {
            console.warn('Embedding config table repair warning:', e.message);
        }

        const result = await pgClient.query(
            `SELECT text_model, text_model_details
             FROM openrouter_engine_config
             WHERE config_type = $1
             LIMIT 1`,
            ['embedding_global']
        );

        const row = result.rows[0] || null;
        const details = (row && row.text_model_details) || {};

        const payload = {
            model: (row && row.text_model) || '',
            base_url: details.base_url || '',
            api_key: details.api_key || '',
            provider: details.provider || 'openai'
        };

        res.json({ success: true, config: payload });
    } catch (error) {
        console.error('DB Admin getEmbeddingGlobalConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveEmbeddingGlobalConfig = async (req, res) => {
    try {
        const { model, base_url, api_key, provider } = req.body || {};
        const pgClient = require('../services/pgClient');

        // Quick Repair
        try {
            await pgClient.query(`ALTER TABLE openrouter_engine_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
            await pgClient.query(`ALTER TABLE openrouter_engine_config ADD COLUMN IF NOT EXISTS text_model_details JSONB`);
        } catch (e) {
            console.warn('Embedding save config table repair warning:', e.message);
        }

        const details = {
            base_url: base_url || '',
            api_key: api_key || '',
            provider: provider || ''
        };

        const result = await pgClient.query(
            `INSERT INTO openrouter_engine_config 
                (config_type, text_model, text_model_details, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (config_type)
             DO UPDATE SET
                text_model = EXCLUDED.text_model,
                text_model_details = EXCLUDED.text_model_details,
                updated_at = NOW()
             RETURNING *`,
            ['embedding_global', model || '', details]
        );

        const row = result.rows[0] || null;
        res.json({ success: true, config: row });
    } catch (error) {
        console.error('DB Admin saveEmbeddingGlobalConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getSemanticCacheConfigs = async (req, res) => {
    try {
        // 1. Ensure columns exist first (Migration)
        try {
            // Messenger table
            await pgClient.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='audio_detection') THEN
                        ALTER TABLE fb_message_database ADD COLUMN audio_detection boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN semantic_cache_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='semantic_cache_threshold') THEN
                        ALTER TABLE fb_message_database ADD COLUMN semantic_cache_threshold numeric DEFAULT 0.96;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='embed_enabled') THEN
                        ALTER TABLE fb_message_database ADD COLUMN embed_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_message_database' AND column_name='created_at') THEN
                        ALTER TABLE fb_message_database ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
                    END IF;
                END $$;
            `);
            
            // WhatsApp table
            await pgClient.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='semantic_cache_enabled') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN semantic_cache_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='semantic_cache_threshold') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN semantic_cache_threshold numeric DEFAULT 0.96;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='embed_enabled') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN embed_enabled boolean DEFAULT false;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='created_at') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='push_name') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN push_name text;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='ai_provider') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN ai_provider text;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='chat_model') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN chat_model text;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='voice_model') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN voice_model text;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_message_database' AND column_name='cheap_engine') THEN
                        ALTER TABLE whatsapp_message_database ADD COLUMN cheap_engine boolean DEFAULT true;
                    END IF;
                END $$;
            `);
            
            // pam table (page_access_token_message)
            await pgClient.query(`ALTER TABLE page_access_token_message ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
            
            // UNIQUE constraint for upsert
            await pgClient.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_message_database_page_id_unique') THEN
                        ALTER TABLE fb_message_database ADD CONSTRAINT fb_message_database_page_id_unique UNIQUE (page_id);
                    END IF;
                END $$;
            `);
        } catch (migrationError) {
            console.warn('Migration error in getSemanticCacheConfigs:', migrationError.message);
        }

        // 2. Fetch Data with careful column checking
        // We use subqueries to handle potential column missing errors during the very first run
        const messengerSql = `
            SELECT 
                'messenger' AS platform,
                page_id AS id,
                name,
                semantic_cache_enabled,
                semantic_cache_threshold,
                embed_enabled,
                created_at
            FROM (
                SELECT 
                    pam.page_id, 
                    COALESCE(pam.name, pam.page_id) as name, 
                    COALESCE(fb.semantic_cache_enabled, false) as semantic_cache_enabled, 
                    COALESCE(fb.semantic_cache_threshold, 0.96) as semantic_cache_threshold, 
                    COALESCE(fb.embed_enabled, false) as embed_enabled, 
                    COALESCE(pam.created_at, NOW()) as created_at
                FROM page_access_token_message pam
                LEFT JOIN fb_message_database fb ON fb.page_id = pam.page_id
                UNION
                SELECT 
                    fb.page_id, 
                    fb.page_id as name, 
                    COALESCE(fb.semantic_cache_enabled, false) as semantic_cache_enabled, 
                    COALESCE(fb.semantic_cache_threshold, 0.96) as semantic_cache_threshold, 
                    COALESCE(fb.embed_enabled, false) as embed_enabled, 
                    COALESCE(fb.created_at, NOW()) as created_at
                FROM fb_message_database fb
                WHERE NOT EXISTS (SELECT 1 FROM page_access_token_message pam2 WHERE pam2.page_id = fb.page_id)
            ) AS combined_messenger
        `;

        const whatsappSql = `
            SELECT 
                'whatsapp' AS platform,
                session_name AS id,
                COALESCE(push_name, session_name) AS name,
                COALESCE(semantic_cache_enabled, false) AS semantic_cache_enabled,
                COALESCE(semantic_cache_threshold, 0.96) AS semantic_cache_threshold,
                COALESCE(embed_enabled, false) AS embed_enabled,
                COALESCE(created_at, NOW()) AS created_at
            FROM whatsapp_message_database
        `;

        const messengerRes = await pgClient.query(messengerSql);
        const whatsappRes = await pgClient.query(whatsappSql);

        const allConfigs = [...messengerRes.rows, ...whatsappRes.rows];
        
        // Sort manually by created_at to be safer
        allConfigs.sort((a, b) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateB - dateA;
        });

        res.json({
            success: true,
            configs: allConfigs
        });
    } catch (error) {
        console.error('DB Admin getSemanticCacheConfigs error:', error);
        // If it's a column missing error, return empty but success:true so frontend doesn't show alert
        if (error.message.includes('column') && error.message.includes('does not exist')) {
            return res.json({ success: true, configs: [], note: 'Database schema sync in progress' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateSemanticCacheConfig = async (req, res) => {
    try {
        const { platform, id, semantic_cache_enabled, semantic_cache_threshold, embed_enabled } = req.body;

        if (!platform || !id) {
            return res.status(400).json({ success: false, error: 'Platform and ID are required' });
        }

        // Quick Repair
        try {
            if (platform === 'messenger') {
                await pgClient.query(`ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS semantic_cache_enabled boolean DEFAULT false`);
                await pgClient.query(`ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS semantic_cache_threshold numeric DEFAULT 0.96`);
                await pgClient.query(`ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS embed_enabled boolean DEFAULT false`);
                await pgClient.query(`
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_message_database_page_id_unique') THEN
                            ALTER TABLE fb_message_database ADD CONSTRAINT fb_message_database_page_id_unique UNIQUE (page_id);
                        END IF;
                    END $$;
                `);
            } else {
                await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS semantic_cache_enabled boolean DEFAULT false`);
                await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS semantic_cache_threshold numeric DEFAULT 0.96`);
                await pgClient.query(`ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS embed_enabled boolean DEFAULT false`);
            }
        } catch (e) {
            console.warn('Semantic cache update repair warning:', e.message);
        }

        let sql = '';
        const params = [semantic_cache_enabled, semantic_cache_threshold, embed_enabled, id];

        if (platform === 'messenger') {
            sql = `
                INSERT INTO fb_message_database (page_id, semantic_cache_enabled, semantic_cache_threshold, embed_enabled)
                VALUES ($4, $1, $2, $3)
                ON CONFLICT (page_id) 
                DO UPDATE SET 
                    semantic_cache_enabled = EXCLUDED.semantic_cache_enabled, 
                    semantic_cache_threshold = EXCLUDED.semantic_cache_threshold, 
                    embed_enabled = EXCLUDED.embed_enabled
            `;
        } else if (platform === 'whatsapp') {
            sql = `
                UPDATE whatsapp_message_database 
                SET semantic_cache_enabled = $1, semantic_cache_threshold = $2, embed_enabled = $3
                WHERE session_name = $4
            `;
        } else {
            return res.status(400).json({ success: false, error: 'Invalid platform' });
        }

        await pgClient.query(sql, params);
        res.json({ success: true });
    } catch (error) {
        console.error('DB Admin updateSemanticCacheConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// --- Semantic Cache: Entries Management (Superadmin Only) ---
exports.getSemanticCacheEntries = async (req, res) => {
    try {
        const dbService = require('../services/dbService');
        const { page_id, session_name, limit, offset } = req.query;
        const entries = await dbService.getSemanticCacheEntries({
            page_id: page_id || null,
            session_name: session_name || null,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });
        res.json({ success: true, entries });
    } catch (error) {
        console.error('[DBAdmin] getSemanticCacheEntries error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.addSemanticCacheEntry = async (req, res) => {
    try {
        const dbService = require('../services/dbService');
        const { page_id, session_name, context_id, question, response } = req.body;
        if (!question || !response) {
            return res.status(400).json({ success: false, error: 'Question and response are required' });
        }
        
        await dbService.saveSemanticCacheEntry({
            page_id: page_id || null,
            session_name: session_name || null,
            context_id: context_id || null,
            question,
            response
        });
        
        res.json({ success: true, message: 'Manual cache entry added successfully' });
    } catch (error) {
        console.error('[DBAdmin] addSemanticCacheEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateSemanticCacheEntry = async (req, res) => {
    try {
        const dbService = require('../services/dbService');
        const { id } = req.params;
        const { question, response } = req.body;
        
        const success = await dbService.updateSemanticCacheEntry(id, { question, response });
        if (success) {
            res.json({ success: true, message: 'Cache entry updated' });
        } else {
            res.status(404).json({ success: false, error: 'Entry not found or update failed' });
        }
    } catch (error) {
        console.error('[DBAdmin] updateSemanticCacheEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deleteSemanticCacheEntry = async (req, res) => {
    try {
        const dbService = require('../services/dbService');
        const { id } = req.params;
        const success = await dbService.deleteSemanticCacheEntry(id);
        if (success) {
            res.json({ success: true, message: 'Cache entry deleted' });
        } else {
            res.status(404).json({ success: false, error: 'Entry not found' });
        }
    } catch (error) {
        console.error('[DBAdmin] deleteSemanticCacheEntry error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
