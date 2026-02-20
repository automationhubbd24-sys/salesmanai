const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// DB Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const param = args.slice(1).join(' ');

    if (!command) {
        console.log(`
Usage: node fb_page_manager.js <command> [param]

Commands:
  list            - List all Facebook pages and their config status
  repair          - Auto-create missing configs for all pages
  delete <pageId> - Force delete a page and all its data (DB + Unsubscribe)
  info <pageId>   - Show detailed info for a specific page
  sql <query>     - Run a raw SQL query (Be careful!)
`);
        process.exit(0);
    }

    try {
        switch (command) {
            case 'list':
                await listPages();
                break;
            case 'repair':
                await repairConfigs();
                break;
            case 'delete':
                if (!param) throw new Error('Page ID required for delete');
                await deletePage(param);
                break;
            case 'info':
                        if (!param) throw new Error('Page ID required for info');
                        await pageInfo(param);
                        break;
                    case 'schema':
                        await checkSchema();
                        break;
                    case 'sql':
                        if (!param) throw new Error('SQL query required');
                await runSql(param);
                break;
            default:
                console.error('Unknown command');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

async function listPages() {
    console.log('--- Facebook Pages ---');
    const res = await pool.query(`
        SELECT t.page_id, t.name, t.email, c.id as config_id 
        FROM page_access_token_message t
        LEFT JOIN fb_message_database c ON t.page_id = c.page_id
    `);
    
    if (res.rows.length === 0) {
        console.log('No pages found.');
        return;
    }

    console.table(res.rows.map(r => ({
        PageID: r.page_id,
        Name: r.name,
        Email: r.email,
        ConfigStatus: r.config_id ? 'OK' : 'MISSING (Needs Repair)'
    })));
}

async function repairConfigs() {
    console.log('--- Repairing Configs ---');
    const res = await pool.query(`
        SELECT t.page_id, t.name 
        FROM page_access_token_message t
        LEFT JOIN fb_message_database c ON t.page_id = c.page_id
        WHERE c.id IS NULL
    `);

    if (res.rows.length === 0) {
        console.log('All pages have configs. No repair needed.');
        return;
    }

    console.log(`Found ${res.rows.length} pages without config. Creating...`);
    
    for (const row of res.rows) {
        try {
            await pool.query(
                `INSERT INTO fb_message_database (page_id, text_prompt) VALUES ($1, $2)`,
                [row.page_id, 'You are a helpful sales assistant.']
            );
            console.log(`[OK] Created config for ${row.name} (${row.page_id})`);
        } catch (e) {
            console.error(`[ERR] Failed to create config for ${row.page_id}:`, e.message);
        }
    }
    console.log('Repair complete.');
}

async function pageInfo(pageId) {
    console.log(`--- Info for Page ${pageId} ---`);
    
    const tokenRes = await pool.query('SELECT * FROM page_access_token_message WHERE page_id = $1', [pageId]);
    if (tokenRes.rows.length === 0) {
        console.log('Token Table: NOT FOUND');
    } else {
        console.log('Token Table: FOUND');
        console.log(tokenRes.rows[0]);
    }

    const configRes = await pool.query('SELECT * FROM fb_message_database WHERE page_id = $1', [pageId]);
    if (configRes.rows.length === 0) {
        console.log('Config Table: NOT FOUND');
    } else {
        console.log('Config Table: FOUND');
        console.log(configRes.rows[0]);
    }
}

async function deletePage(pageId) {
    console.log(`--- Deleting Page ${pageId} ---`);

    // 1. Get Token for Unsubscribe
    const tokenRes = await pool.query('SELECT page_access_token FROM page_access_token_message WHERE page_id = $1', [pageId]);
    const token = tokenRes.rows[0]?.page_access_token;

    if (token) {
        try {
            console.log('Attempting to unsubscribe app from Facebook...');
            await axios.delete(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
                params: { access_token: token }
            });
            console.log('[OK] Unsubscribed successfully.');
        } catch (e) {
            console.error('[WARN] Failed to unsubscribe:', e.response?.data || e.message);
        }
    } else {
        console.log('[WARN] No access token found. Skipping unsubscribe.');
    }

    // 2. Delete from all tables
    const tables = [
        'fb_chats',
        'fb_order_tracking',
        'backend_chat_histories',
        'fb_comments',
        'label_actions',
        'page_prompts',
        'fb_message_database',
        'page_access_token_message'
    ];

    for (const table of tables) {
        try {
            const res = await pool.query(`DELETE FROM ${table} WHERE page_id = $1`, [pageId]);
            console.log(`[OK] Deleted ${res.rowCount} rows from ${table}`);
        } catch (e) {
            // Check if column exists before complaining (some tables might not have page_id or exist)
            if (e.code === '42703') { // Undefined column
                console.log(`[SKIP] Table ${table} does not have page_id column.`);
            } else if (e.code === '42P01') { // Undefined table
                 console.log(`[SKIP] Table ${table} does not exist.`);
            } else {
                console.error(`[ERR] Failed to delete from ${table}:`, e.message);
            }
        }
    }
    console.log('Deletion complete.');
}

async function checkSchema() {
    console.log("Checking schema...");
    try {
        const tables = ['fb_message_database', 'page_access_token_message'];
        for (const table of tables) {
            console.log(`\nTable: ${table}`);
            const res = await pool.query(
                `SELECT column_name, data_type, is_nullable
                 FROM information_schema.columns 
                 WHERE table_name = $1`,
                [table]
            );
            res.rows.forEach(r => console.log(` - ${r.column_name}: ${r.data_type} (${r.is_nullable})`));
        }
    } catch (err) {
        console.error("Schema check failed:", err.message);
    }
}

async function runSql(query) {
    console.log(`Executing: ${query}`);
    const res = await pool.query(query);
    console.table(res.rows);
}

main();
