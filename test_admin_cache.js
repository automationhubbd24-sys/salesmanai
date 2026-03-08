const pgClient = require('./backend/src/services/pgClient');

async function repairAndTest() {
    try {
        console.log('--- Step 1: Repairing Database Schema (Adding Columns) ---');
        
        const tables = ['fb_message_database', 'whatsapp_message_database'];
        for (const table of tables) {
            console.log(`Checking table: ${table}`);
            await pgClient.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS semantic_cache_enabled boolean DEFAULT false`);
            await pgClient.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS semantic_cache_threshold numeric DEFAULT 0.96`);
            await pgClient.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS embed_enabled boolean DEFAULT false`);
            console.log(`Columns verified/added for ${table}`);
        }

        // Ensure UNIQUE constraint for Messenger upsert
        try {
            await pgClient.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_message_database_page_id_unique') THEN
                        ALTER TABLE fb_message_database ADD CONSTRAINT fb_message_database_page_id_unique UNIQUE (page_id);
                        RAISE NOTICE 'Unique constraint added to fb_message_database(page_id)';
                    END IF;
                END $$;
            `);
        } catch (e) {
            console.log('Constraint notice:', e.message);
        }

        console.log('\n--- Step 2: Testing Messenger Query ---');
        const messengerSql = `
            SELECT 
                'messenger' AS platform,
                COALESCE(pam.page_id, fb.page_id) AS id,
                COALESCE(pam.name, fb.page_id) AS name,
                COALESCE(fb.semantic_cache_enabled, false) AS semantic_cache_enabled,
                COALESCE(fb.semantic_cache_threshold, 0.96) AS semantic_cache_threshold,
                COALESCE(fb.embed_enabled, false) AS embed_enabled,
                COALESCE(pam.created_at, fb.created_at, NOW()) AS created_at
            FROM page_access_token_message pam
            FULL OUTER JOIN fb_message_database fb ON fb.page_id = pam.page_id
        `;
        const messengerRes = await pgClient.query(messengerSql);
        console.log(`Messenger Rows Found: ${messengerRes.rows.length}`);
        if (messengerRes.rows.length > 0) {
            console.log('Sample Row:', JSON.stringify(messengerRes.rows[0], null, 2));
        }

        console.log('\n--- Step 3: Testing WhatsApp Query ---');
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
        const whatsappRes = await pgClient.query(whatsappSql);
        console.log(`WhatsApp Rows Found: ${whatsappRes.rows.length}`);
        if (whatsappRes.rows.length > 0) {
            console.log('Sample Row:', JSON.stringify(whatsappRes.rows[0], null, 2));
        }

        console.log('\n--- Final Summary ---');
        console.log(`Total Records for Admin List: ${messengerRes.rows.length + whatsappRes.rows.length}`);

    } catch (err) {
        console.error('\n!!! TEST FAILED !!!');
        console.error('Error Name:', err.name);
        console.error('Error Message:', err.message);
        console.error('Stack:', err.stack);
    } finally {
        process.exit();
    }
}

repairAndTest();
