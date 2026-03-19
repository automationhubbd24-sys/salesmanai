const { Client } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function checkSchema() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log("Connected to DB successfully.");

        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log("\n--- Tables Found ---");
        console.log(tables.join(', '));

        const expectedTables = [
            'page_access_token_message', 'fb_chats', 'fb_message_database', 'user_configs',
            'wp_chats', 'whatsapp_chats', 'conversation_state', 'wpp_debounce',
            'whatsapp_debounce', 'backend_chat_histories', 'error_logs', 'fb_contacts',
            'whatsapp_contacts', 'whatsapp_message_database', 'ai_usage_logs',
            'api_engine_configs', 'engine_configs', 'api_list', 'products',
            'api_usage_stats', 'openrouter_engine_config', 'openrouter_engine_keys',
            'fb_order_tracking', 'whatsapp_order_tracking', 'fb_comments',
            'payment_transactions', 'whatsapp_sessions', 'fb_n8n_debounce',
            'label_actions', 'page_prompts', 'users'
        ];

        const missingTables = expectedTables.filter(t => !tables.includes(t));
        if (missingTables.length > 0) {
            console.log("\n--- Missing Tables ---");
            console.log(missingTables.join(', '));
        } else {
            console.log("\nAll expected tables are present.");
        }

        console.log("\n--- Column Check for Critical Tables ---");
        const criticalTables = ['page_access_token_message', 'fb_order_tracking', 'whatsapp_order_tracking', 'whatsapp_message_database'];
        
        for (const table of criticalTables) {
            if (!tables.includes(table)) continue;
            const columnsRes = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            console.log(`\nTable: ${table}`);
            columnsRes.rows.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));
        }

    } catch (err) {
        console.error("DB Error:", err.message);
    } finally {
        await client.end();
    }
}

checkSchema();
