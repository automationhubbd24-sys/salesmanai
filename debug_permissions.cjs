const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
});

async function checkPermissions() {
    try {
        await client.connect();
        
        console.log("=== Permission Check ===");
        const memberEmail = 'xbluewhalebd@gmail.com';
        const ownerEmail = 'automationhubbd24@gmail.com';
        
        const res = await client.query(
            'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2',
            [memberEmail, ownerEmail]
        );
        
        if (res.rows.length > 0) {
            console.log("Permissions:", JSON.stringify(res.rows[0].permissions, null, 2));
        } else {
            console.log("No team entry found.");
        }
        
        console.log("\n=== Page 666370203227659 Info ===");
        const pageRes = await client.query(
            'SELECT name, user_id FROM page_access_token_message WHERE page_id = $1',
            ['666370203227659']
        );
        if (pageRes.rows.length > 0) {
            console.log(`Page Name: ${pageRes.rows[0].name}`);
            console.log(`Page Owner UserID: ${pageRes.rows[0].user_id}`);
        } else {
            console.log("Page not found in DB.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

checkPermissions();
