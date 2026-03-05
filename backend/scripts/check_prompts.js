const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        if (!line || line.trim().startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

const { query } = require('../src/services/pgClient');

async function run() {
    const summary = await query(
        `SELECT 
            COUNT(*)::int AS total,
            SUM(CASE WHEN text_prompt IS NULL OR btrim(text_prompt) = '' THEN 1 ELSE 0 END)::int AS empty_count
         FROM fb_message_database`
    );

    console.log('Summary:', summary.rows[0]);

    const emptyRows = await query(
        `SELECT id, page_id
         FROM fb_message_database
         WHERE text_prompt IS NULL OR btrim(text_prompt) = ''
         ORDER BY id DESC`
    );
    console.log('Empty prompts:', emptyRows.rows.length);
    if (emptyRows.rows.length > 0) {
        console.table(emptyRows.rows);
    }

    try {
        const latest = await query(
            `SELECT id, page_id, octet_length(text_prompt) AS prompt_bytes
             FROM fb_message_database
             WHERE text_prompt IS NOT NULL
             ORDER BY id DESC
             LIMIT 10`
        );
        console.table(latest.rows);
    } catch (err) {
        console.warn('Preview skipped due to encoding issue:', err.message);
    }
}

run().catch((e) => {
    console.error('DB check failed:', e.message);
    process.exit(1);
});
