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

async function testLogic() {
    try {
        await client.connect();
        console.log("Connected to database.");

        const userEmail = 'xbluewhalebd@gmail.com';
        const requestedOwner = 'automationhubbd24@gmail.com';

        console.log(`Testing logic for User: ${userEmail}, Requested Owner: ${requestedOwner}`);

        // 2. Fetch Personal Pages
        let myPages = [];
        if (!requestedOwner || requestedOwner === userEmail) {
            console.log("Fetching Personal Pages...");
            const { rows } = await client.query(
                'SELECT * FROM page_access_token_message WHERE email = $1',
                [userEmail]
            );
            myPages = rows;
        } else {
            console.log("Skipping Personal Pages (Team Context)");
        }
        console.log("My Pages:", myPages.length);

        // 3. Fetch Shared Pages (Team Members)
        let sharedPageIds = [];
        if (userEmail && requestedOwner && requestedOwner !== userEmail) {
            console.log("Fetching Shared Pages...");
            const { rows: teamData } = await client.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                [userEmail, requestedOwner, 'active']
            );
            console.log("Team Data Rows:", teamData.length);
            if (teamData.length > 0) {
                console.log("Permissions:", JSON.stringify(teamData[0].permissions));
            }

            teamData.forEach(row => {
                if (row.permissions && row.permissions.fb_pages) {
                    const pages = row.permissions.fb_pages;
                    if (Array.isArray(pages)) {
                        sharedPageIds.push(...pages.map(id => String(id)));
                    }
                }
            });
        }
        console.log("Shared Page IDs:", sharedPageIds);

        let sharedPages = [];
        if (sharedPageIds.length > 0) {
            const { rows: sharedData } = await client.query(
                'SELECT * FROM page_access_token_message WHERE page_id = ANY($1::text[])',
                [sharedPageIds]
            );
            sharedPages = sharedData;
        }
        console.log("Shared Pages Found:", sharedPages.length);

        // 4. Combine
        const allPages = [...(myPages || []), ...sharedPages];
        console.log("Total Pages Returned:", allPages.length);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

testLogic();
