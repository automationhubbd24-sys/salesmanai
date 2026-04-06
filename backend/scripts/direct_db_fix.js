const { Client } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function migrate() {
    const client = new Client({
        connectionString: connectionString,
        ssl: false // Assuming no SSL based on provided string, but can be adjusted
    });

    try {
        await client.connect();
        console.log('Connected to database successfully');

        const queries = [
            // api_engine_configs columns
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpm INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpd INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS text_tpmo INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpm INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpd INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS vision_tpmo INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpm INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpd INTEGER DEFAULT 0;`,
            `ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS voice_tpmo INTEGER DEFAULT 0;`,
            
            // api_list columns (just in case they are missing too)
            `ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpm_limit INTEGER DEFAULT 0;`,
            `ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpd_limit INTEGER DEFAULT 0;`,
            `ALTER TABLE api_list ADD COLUMN IF NOT EXISTS tpmo_limit INTEGER DEFAULT 0;`,
            `ALTER TABLE api_list ADD COLUMN IF NOT EXISTS usage_tokens_month BIGINT DEFAULT 0;`,
            `ALTER TABLE api_list ADD COLUMN IF NOT EXISTS last_month_checked TEXT DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM');`,
            // NEW: Add temperature to page_prompts for user-level control
            `ALTER TABLE page_prompts ADD COLUMN IF NOT EXISTS temperature NUMERIC DEFAULT 0.7;`
        ];

        for (const query of queries) {
            try {
                await client.query(query);
                console.log(`Executed: ${query}`);
            } catch (err) {
                console.error(`Error executing: ${query}`, err.message);
            }
        }

        console.log('Migration completed successfully');
    } catch (err) {
        console.error('Database connection error:', err.stack);
    } finally {
        await client.end();
    }
}

migrate();
