const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function updateSchema() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        console.log("--- Updating Database Schema ---");
        
        // 1. Rename allowed_page_ids to allowed_messenger_ids if it exists
        // Or just add allowed_messenger_ids as a clear column
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='allowed_messenger_ids') THEN
                    ALTER TABLE products ADD COLUMN allowed_messenger_ids JSONB DEFAULT '[]'::jsonb;
                END IF;
            END $$;
        `);
        console.log("Column 'allowed_messenger_ids' ensured.");

        // 2. Data Migration: Copy from allowed_page_ids to allowed_messenger_ids 
        // but ONLY IDs that are not WA sessions.
        // Also ensure allowed_wa_sessions is clean.
        
        const products = await client.query("SELECT id, allowed_page_ids, allowed_wa_sessions FROM products");
        for (const p of products.rows) {
            let oldPageIds = Array.isArray(p.allowed_page_ids) ? p.allowed_page_ids : [];
            let oldWaSessions = Array.isArray(p.allowed_wa_sessions) ? p.allowed_wa_sessions : [];
            
            // All unique IDs
            const allIds = Array.from(new Set([...oldPageIds, ...oldWaSessions]));
            
            const messengerIds = allIds.filter(id => !id.startsWith('bottow_') && !id.startsWith('session_'));
            const waSessions = allIds.filter(id => id.startsWith('bottow_') || id.startsWith('session_'));
            
            await client.query(
                'UPDATE products SET allowed_messenger_ids = $1::jsonb, allowed_wa_sessions = $2::jsonb WHERE id = $3',
                [JSON.stringify(messengerIds), JSON.stringify(waSessions), p.id]
            );
        }
        console.log("Data migrated to new structure.");

    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
        process.exit();
    }
}

updateSchema();
