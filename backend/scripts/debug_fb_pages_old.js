const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runDebug() {
    try {
        console.log("=== Debugging Facebook Pages & Configs ===");

        // 1. Check page_access_token_message (The source of truth for connection)
        console.log("\n--- Table: page_access_token_message ---");
        const tokens = await pool.query('SELECT page_id, name, email FROM page_access_token_message');
        if (tokens.rows.length === 0) {
            console.log("No pages found in page_access_token_message.");
        } else {
            tokens.rows.forEach(row => {
                console.log(`Page ID: '${row.page_id}' (Length: ${row.page_id.length}), Name: ${row.name}, Email: ${row.email}`);
            });
        }

        // 2. Check fb_message_database (The config table)
        console.log("\n--- Table: fb_message_database ---");
        const configs = await pool.query('SELECT id, page_id, text_prompt FROM fb_message_database');
        if (configs.rows.length === 0) {
            console.log("No configs found in fb_message_database.");
        } else {
            configs.rows.forEach(row => {
                console.log(`DB ID: ${row.id}, Page ID: '${row.page_id}' (Length: ${row.page_id ? row.page_id.length : 'N/A'})`);
            });
        }

        // 3. Simulate Lookup for specific Page IDs from screenshot
        // IDs: 951912431342790, 997118700148575, 987398041126801
        const targetIds = ['951912431342790', '997118700148575', '987398041126801'];
        console.log("\n--- Simulating Lookup Logic ---");

        for (const id of targetIds) {
            console.log(`\nChecking ID: '${id}'`);
            
            // Step A: Is Integer?
            const isInteger = /^\d+$/.test(id) && Number(id) < 2147483647;
            console.log(`  Is Integer ( < 2B )? ${isInteger}`);

            let configRow = null;

            // Step B: Lookup by DB ID
            if (isInteger) {
                console.log(`  Looking up by ID=${id}...`);
                const res = await pool.query('SELECT * FROM fb_message_database WHERE id = $1', [parseInt(id)]);
                if (res.rows.length > 0) {
                    console.log("  FOUND by ID.");
                    configRow = res.rows[0];
                }
            } else {
                console.log(`  Skipping lookup by ID (not small integer).`);
            }

            // Step C: Lookup by Page ID
            if (!configRow) {
                console.log(`  Looking up by Page ID='${id}'...`);
                const res = await pool.query('SELECT * FROM fb_message_database WHERE page_id = $1', [id]);
                if (res.rows.length > 0) {
                    console.log("  FOUND by Page ID.");
                    configRow = res.rows[0];
                } else {
                    console.log("  NOT FOUND by Page ID.");
                }
            }

            // Step D: Check if exists in tokens
            if (!configRow) {
                console.log(`  Checking page_access_token_message for '${id}'...`);
                const tokenRes = await pool.query('SELECT * FROM page_access_token_message WHERE page_id = $1', [id]);
                if (tokenRes.rows.length > 0) {
                    console.log("  FOUND in page_access_token_message. Should AUTO-CREATE.");
                } else {
                    console.log("  NOT FOUND in page_access_token_message. This is why it returns 404.");
                }
            }
        }

        // 4. Simulate Delete Logic
        console.log("\n--- Simulating Delete Logic ---");
        // Create a dummy page
        const dummyPageId = '999999999999999';
        console.log(`Creating dummy page ${dummyPageId}...`);
        await pool.query("INSERT INTO page_access_token_message (page_id, name, email) VALUES ($1, 'Dummy', 'test@test.com') ON CONFLICT DO NOTHING", [dummyPageId]);
        await pool.query("INSERT INTO fb_message_database (page_id, text_prompt) VALUES ($1, 'test') ON CONFLICT DO NOTHING", [dummyPageId]);

        console.log("Deleting dummy page...");
        try {
            await pool.query('DELETE FROM fb_chats WHERE page_id = $1', [dummyPageId]);
            await pool.query('DELETE FROM fb_order_tracking WHERE page_id = $1', [dummyPageId]);
            await pool.query('DELETE FROM backend_chat_histories WHERE page_id = $1', [dummyPageId]);
            await pool.query('DELETE FROM fb_comments WHERE page_id = $1', [dummyPageId]);
            await pool.query('DELETE FROM label_actions WHERE page_id = $1', [dummyPageId]);
            await pool.query('DELETE FROM page_prompts WHERE page_id = $1', [dummyPageId]);
            
            await pool.query('DELETE FROM fb_message_database WHERE page_id = $1', [dummyPageId]);
            console.log("Deleted from fb_message_database");

            await pool.query('DELETE FROM page_access_token_message WHERE page_id = $1', [dummyPageId]);
            console.log("Deleted from page_access_token_message");
            
            console.log("Delete SUCCESS");
        } catch (e) {
            console.error("Delete FAILED:", e);
        }

    } catch (error) {
        console.error("Debug Error:", error);
    } finally {
        await pool.end();
    }
}

runDebug();
