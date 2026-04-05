const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
});

async function verifyAutoDetect() {
    try {
        await client.connect();
        
        const memberEmail = 'xbluewhalebd@gmail.com';
        console.log(`Checking Auto-Detect logic for ${memberEmail}...`);
        
        const userRes = await client.query('SELECT id FROM users WHERE email = $1', [memberEmail]);
        const userId = userRes.rows[0].id;
        
        // 1. Check Personal Resources
        const ownPages = await client.query('SELECT 1 FROM page_access_token_message WHERE user_id = $1 LIMIT 1', [userId]);
        const ownWa = await client.query('SELECT 1 FROM whatsapp_message_database WHERE user_id = $1 LIMIT 1', [userId]);
        
        console.log(`Own Pages: ${ownPages.rows.length}`);
        console.log(`Own WA: ${ownWa.rows.length}`);
        
        if (ownPages.rows.length === 0 && ownWa.rows.length === 0) {
            console.log("✅ User has NO personal resources. Auto-detect candidate.");
            
            // 2. Check Team Membership
            const teams = await client.query('SELECT owner_email FROM team_members WHERE member_email = $1 AND status = $2', [memberEmail, 'active']);
            console.log(`Teams found: ${teams.rows.length}`);
            teams.rows.forEach(t => console.log(` - ${t.owner_email}`));
            
            if (teams.rows.length > 0) {
                console.log(`👉 Would auto-switch to: ${teams.rows[0].owner_email}`);
            }
        } else {
            console.log("❌ User HAS personal resources. Auto-detect skipped.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

verifyAutoDetect();
