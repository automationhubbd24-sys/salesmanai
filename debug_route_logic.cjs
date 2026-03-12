const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment from backend folder
const envPath = path.join(__dirname, 'backend', '.env');
dotenv.config({ path: envPath });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function runDebug() {
    try {
        await client.connect();
        console.log("Connected to DB");

        // Check whatsapp_message_database schema for api_key column
        console.log("\n=== Checking whatsapp_message_database Schema ===");
        const schemaRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'whatsapp_message_database'
        `);
        console.table(schemaRes.rows.filter(r => ['api_key', 'service_api_key', 'ai_provider', 'chat_model'].includes(r.column_name)));

        // Simulate GET /pages for xbluewhalebd@gmail.com
        const userEmail = 'xbluewhalebd@gmail.com';
        const userEmail2 = 'automationhubbd24@gmail.com';

        console.log(`\n--- Checking for ${userEmail} ---`);

        // 1. Check Personal Pages
        const { rows: myPages } = await client.query(
            'SELECT * FROM page_access_token_message WHERE email = $1',
            [userEmail]
        );
        console.log(`Personal Pages: ${myPages.length}`);
        myPages.forEach(p => console.log(` - ${p.page_name} (${p.page_id})`));

        // 2. Check Team Memberships (All Owners)
        const { rows: memberships } = await client.query(
            'SELECT * FROM team_members WHERE member_email = $1',
            [userEmail]
        );
        console.log(`Team Memberships: ${memberships.length}`);
        memberships.forEach(m => {
            console.log(` - Owner: ${m.owner_email}, Status: ${m.status}`);
            if (m.permissions && m.permissions.fb_pages) {
                console.log(`   Shared Pages: ${JSON.stringify(m.permissions.fb_pages)}`);
            }
        });

        console.log(`\n--- Checking for ${userEmail2} ---`);

        // 1. Check Personal Pages
        const { rows: myPages2 } = await client.query(
            'SELECT * FROM page_access_token_message WHERE email = $1',
            [userEmail2]
        );
        console.log(`Personal Pages: ${myPages2.length}`);
        myPages2.forEach(p => console.log(` - ${p.page_name} (${p.page_id})`));

        // 2. Check Team Memberships (All Owners)
        const { rows: memberships2 } = await client.query(
            'SELECT * FROM team_members WHERE member_email = $1',
            [userEmail2]
        );
        console.log(`Team Memberships: ${memberships2.length}`);
        memberships2.forEach(m => {
            console.log(` - Owner: ${m.owner_email}, Status: ${m.status}`);
            if (m.permissions && m.permissions.fb_pages) {
                console.log(`   Shared Pages: ${JSON.stringify(m.permissions.fb_pages)}`);
            }
        });

        // 3. Check specific unwanted member
        const unwantedMember = 'azaharlifrimuck714420@gmail.com'; // guessing email format based on name
        console.log(`\n--- Checking for ${unwantedMember} ---`);
        const { rows: unwanted } = await client.query(
            'SELECT * FROM team_members WHERE member_email LIKE $1 OR owner_email LIKE $1',
            [`%${unwantedMember.split('@')[0]}%`]
        );
        console.log(`Unwanted Member Records: ${unwanted.length}`);
        unwanted.forEach(m => console.log(m));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

runDebug();
