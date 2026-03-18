const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
const envPath = path.join(__dirname, 'backend', '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    console.error("Backend .env file not found at:", envPath);
    process.exit(1);
}

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function debug() {
    try {
        await client.connect();
        console.log("Connected to database.");

        const users = [
            'xbluewhalebd@gmail.com',
            'automationhubbd@gmail.com',
            'automationhubbd24@gmail.com',
            'azaharlifrimick714420@gmail.com' // Mentioned by user as appearing in workspace
        ];

        console.log("\n=== Checking Users ===");
        const userRes = await client.query('SELECT id, email, created_at FROM users WHERE email = ANY($1)', [users]);
        console.table(userRes.rows);

        console.log("\n=== Checking Messenger Pages (page_access_token_message) ===");
        const pageRes = await client.query(`
            SELECT id, page_id, name, email, user_id 
            FROM page_access_token_message 
            WHERE email = ANY($1) OR user_id IN (SELECT id FROM users WHERE email = ANY($1))
        `, [users]);
        console.table(pageRes.rows);

        console.log("\n=== Checking Team Memberships (team_members) ===");
        const teamRes = await client.query(`
            SELECT id, owner_email, member_email, status, permissions 
            FROM team_members 
            WHERE owner_email = ANY($1) OR member_email = ANY($1)
        `, [users]);
        console.table(teamRes.rows);

        console.log("\n=== Checking WhatsApp Sessions (whatsapp_message_database) ===");
        const waRes = await client.query(`
            SELECT id, session_name, user_id, api_key, ai_provider 
            FROM whatsapp_message_database 
            WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))
        `, [users]);
        console.table(waRes.rows);
        
        console.log("\n=== Checking User Configs (API Keys) ===");
         const configRes = await client.query(`
            SELECT uc.user_id, u.email, uc.api_key, uc.provider 
            FROM user_configs uc
            JOIN users u ON uc.user_id = u.id
            WHERE u.email = ANY($1)
        `, [users]);
        console.table(configRes.rows);


    } catch (err) {
        console.error("Error:", err);
    } finally {
        await client.end();
    }
}

debug();
