
const { Client } = require('pg');
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function checkSessionProducts() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        const sessionId = 'bottow_wh03lz';
        
        // 1. Check products explicitly assigned to this session
        const res = await client.query(
            "SELECT id, name, user_id, allowed_page_ids, allowed_wa_sessions FROM products WHERE allowed_wa_sessions::jsonb @> jsonb_build_array($1::text)",
            [sessionId]
        );
        
        console.log(`\n--- Products assigned to WA Session: ${sessionId} ---`);
        if (res.rows.length === 0) {
            console.log("No products found for this session ID.");
        } else {
            console.table(res.rows);
        }

        // 2. Check the session owner in the database
        const sessionRes = await client.query(
            "SELECT user_id, email, session_name FROM whatsapp_message_database WHERE session_name = $1",
            [sessionId]
        );
        console.log(`\n--- WhatsApp Session Info for: ${sessionId} ---`);
        console.table(sessionRes.rows);

        // 3. Check for Global products (no pages/sessions assigned) for this user
        if (sessionRes.rows.length > 0) {
            const ownerId = sessionRes.rows[0].user_id;
            const globalRes = await client.query(
                "SELECT id, name FROM products WHERE user_id = $1 AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb) AND (allowed_wa_sessions IS NULL OR allowed_wa_sessions::jsonb = '[]'::jsonb) LIMIT 5",
                [ownerId]
            );
            console.log(`\n--- Global Products for Owner (${ownerId}) ---`);
            console.table(globalRes.rows);
        }

    } catch (e) {
        console.error("Check Failed:", e.message);
    } finally {
        await client.end();
    }
}

checkSessionProducts();
