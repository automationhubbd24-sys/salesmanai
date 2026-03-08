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
            api_key: details.api_key || ''
        };

        res.json({ success: true, config: payload });
    } catch (error) {
        console.error('DB Admin getEmbeddingGlobalConfig error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.saveEmbeddingGlobalConfig = async (req, res) => {
    try {
        const { model, base_url, api_key } = req.body || {};
        const pgClient = require('../services/pgClient');

        const details = {
            base_url: base_url || '',
            api_key: api_key || ''
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
        const messengerSql = `
            SELECT 
                'messenger' as platform,
                page_id as id,
                page_name as name,
                semantic_cache_enabled,
                semantic_cache_threshold,
                embed_enabled,
                created_at
            FROM page_access_token_message
            ORDER BY created_at DESC
        `;

        const whatsappSql = `
            SELECT 
                'whatsapp' as platform,
                session_name as id,
                COALESCE(push_name, session_name) as name,
                semantic_cache_enabled,
                semantic_cache_threshold,
                embed_enabled,
                created_at
            FROM whatsapp_message_database
            ORDER BY created_at DESC
        `;

        const messengerRes = await pgClient.query(messengerSql);
        const whatsappRes = await pgClient.query(whatsappSql);

        res.json({
            success: true,
            configs: [...messengerRes.rows, ...whatsappRes.rows]
        });
    } catch (error) {
        console.error('DB Admin getSemanticCacheConfigs error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateSemanticCacheConfig = async (req, res) => {
    try {
        const { platform, id, semantic_cache_enabled, semantic_cache_threshold, embed_enabled } = req.body;

        if (!platform || !id) {
            return res.status(400).json({ success: false, error: 'Platform and ID are required' });
        }

        let sql = '';
        const params = [semantic_cache_enabled, semantic_cache_threshold, embed_enabled, id];

        if (platform === 'messenger') {
            sql = `
                UPDATE page_access_token_message 
                SET semantic_cache_enabled = $1, semantic_cache_threshold = $2, embed_enabled = $3
                WHERE page_id = $4
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
