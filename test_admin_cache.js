const pgClient = require('./backend/src/services/pgClient');

async function testQuery() {
    try {
        console.log('--- Testing Messenger Query ---');
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
            console.log('First 3 rows:', JSON.stringify(messengerRes.rows.slice(0, 3), null, 2));
        }

        console.log('\n--- Testing WhatsApp Query ---');
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
            console.log('First 3 rows:', JSON.stringify(whatsappRes.rows.slice(0, 3), null, 2));
        }

        console.log('\n--- Table Count Summary ---');
        const pamCount = await pgClient.query('SELECT COUNT(*) FROM page_access_token_message');
        const fbCount = await pgClient.query('SELECT COUNT(*) FROM fb_message_database');
        const wmdCount = await pgClient.query('SELECT COUNT(*) FROM whatsapp_message_database');
        console.log(`page_access_token_message: ${pamCount.rows[0].count}`);
        console.log(`fb_message_database: ${fbCount.rows[0].count}`);
        console.log(`whatsapp_message_database: ${wmdCount.rows[0].count}`);

    } catch (err) {
        console.error('Test Failed:', err.message);
    } finally {
        process.exit();
    }
}

testQuery();
