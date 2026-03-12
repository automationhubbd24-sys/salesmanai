
const { Client } = require('pg');
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function migrate() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("Connected to DB for migration.");

        // 1. Get all products to check allowed_page_ids
        const res = await client.query("SELECT id, name, allowed_page_ids, allowed_wa_sessions FROM products");
        
        for (const row of res.rows) {
            let fbIds = Array.isArray(row.allowed_page_ids) ? row.allowed_page_ids : [];
            let waIds = Array.isArray(row.allowed_wa_sessions) ? row.allowed_wa_sessions : [];
            let changed = false;

            // WhatsApp IDs typically start with 'bottow_' or are recognized as such
            const newFbIds = fbIds.filter(id => {
                if (id.startsWith('bottow_')) {
                    if (!waIds.includes(id)) waIds.push(id);
                    changed = true;
                    return false;
                }
                return true;
            });

            if (changed) {
                console.log(`Updating product ${row.id} (${row.name}): Moving WhatsApp IDs to correct column.`);
                await client.query(
                    "UPDATE products SET allowed_page_ids = $1, allowed_wa_sessions = $2 WHERE id = $3",
                    [JSON.stringify(newFbIds), JSON.stringify(waIds), row.id]
                );
            }
        }
        console.log("Migration (ID Cleanup) complete.");

    } catch (e) {
        console.error("Migration failed:", e.message);
    } finally {
        await client.end();
    }
}

migrate();
