
const { Client } = require('pg');
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function deepCheck() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("Connected to DB.");

        // 1. Check table structure one more time
        const tableInfo = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products'");
        console.log("\n--- Products Table Structure ---");
        console.table(tableInfo.rows);

        // 2. Check products assigned to Cosmetic Hub (1018705751321580)
        const fbId = '1018705751321580';
        const fbRes = await client.query(
            "SELECT id, name, allowed_page_ids, allowed_wa_sessions FROM products WHERE allowed_page_ids::jsonb @> jsonb_build_array($1::text)",
            [fbId]
        );
        console.log(`\n--- Products specifically for FB Page: ${fbId} ---`);
        console.log(JSON.stringify(fbRes.rows, null, 2));

        // 3. Check products assigned to WhatsApp Session (bottow_wh03lz)
        const waId = 'bottow_wh03lz';
        const waRes = await client.query(
            "SELECT id, name, allowed_page_ids, allowed_wa_sessions FROM products WHERE allowed_wa_sessions::jsonb @> jsonb_build_array($1::text)",
            [waId]
        );
        console.log(`\n--- Products specifically for WA Session: ${waId} ---`);
        console.log(JSON.stringify(waRes.rows, null, 2));

        // 4. Check if WhatsApp IDs are still stuck in allowed_page_ids
        const stuckRes = await client.query(
            "SELECT id, name, allowed_page_ids FROM products WHERE allowed_page_ids::jsonb @> jsonb_build_array($1::text)",
            [waId]
        );
        console.log(`\n--- Products with WA ID (${waId}) still in allowed_page_ids ---`);
        console.log(JSON.stringify(stuckRes.rows, null, 2));

        // 5. Check if resolvePageContextType will work
        const waCheck1 = await client.query('SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 LIMIT 1', [waId]);
        console.log(`\n--- WA Session check in whatsapp_message_database for ${waId} ---`);
        console.log(waCheck1.rows);

        const waCheck2 = await client.query('SELECT 1 FROM whatsapp_sessions WHERE session_name = $1 LIMIT 1', [waId]);
        console.log(`\n--- WA Session check in whatsapp_sessions for ${waId} ---`);
        console.log(waCheck2.rows);

        // 6. Check Product Owner vs Session Owner
        const prodOwnerRes = await client.query("SELECT user_id FROM products WHERE id = '647'");
        console.log(`\n--- Product 647 Owner: ${prodOwnerRes.rows[0].user_id} ---`);
        
        const sessionOwnerRes = await client.query("SELECT user_id FROM whatsapp_message_database WHERE session_name = $1", [waId]);
        console.log(`\n--- WA Session Owner: ${sessionOwnerRes.rows[0].user_id} ---`);

    } catch (e) {
        console.error("Deep Check Failed:", e.message);
    } finally {
        await client.end();
    }
}

deepCheck();
