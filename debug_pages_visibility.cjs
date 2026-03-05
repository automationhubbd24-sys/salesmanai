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

async function check() {
    try {
        await client.connect();
        console.log("Connected to database.");

        const emails = [
            'xbluewhalebd@gmail.com',
            'automationhubbd@gmail.com',
            'automationhubbd24@gmail.com',
            'helenaqueen010@gmail.com'
        ];

        console.log("\n=== 1. Personal Pages (page_access_token_message) ===");
        for (const email of emails) {
            const res = await client.query(
                'SELECT id, page_id, name, email, user_id FROM page_access_token_message WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))',
                [email]
            );
            console.log(`\nUser: ${email} (Count: ${res.rowCount})`);
            if (res.rowCount > 0) console.table(res.rows);
        }

        console.log("\n=== 4. User Configs / IDs ===");
        for (const email of emails) {
             const res = await client.query(
                'SELECT * FROM user_configs WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))',
                [email]
             );
             if (res.rowCount > 0) {
                 console.log(`User Config for ${email}:`, res.rows[0]);
             } else {
                 console.log(`No User Config for ${email}`);
             }
        }

        console.log("\n=== 2. Team Memberships (team_members) ===");
        for (const email of emails) {
            // As Member
            const memberRes = await client.query(
                'SELECT id, owner_email, member_email, status, permissions FROM team_members WHERE LOWER(TRIM(member_email)) = LOWER(TRIM($1))',
                [email]
            );
            console.log(`\nMember: ${email} (Count: ${memberRes.rowCount})`);
            if (memberRes.rowCount > 0) {
                memberRes.rows.forEach(r => {
                    console.log(`  - Owner: ${r.owner_email}, Status: ${r.status}`);
                    console.log(`    Permissions: ${JSON.stringify(r.permissions)}`);
                });
            }

            // As Owner
            const ownerRes = await client.query(
                'SELECT id, owner_email, member_email, status FROM team_members WHERE LOWER(TRIM(owner_email)) = LOWER(TRIM($1))',
                [email]
            );
            console.log(`Owner: ${email} (Has ${ownerRes.rowCount} members)`);
        }

        console.log("\n=== 3. Simulate GET /pages Logic for xbluewhalebd@gmail.com ===");
        const userEmail = 'xbluewhalebd@gmail.com';
        
        // Scenario A: Personal Workspace
        console.log("\n--- Scenario A: Personal Workspace (No team_owner) ---");
        const personalPages = await client.query(
            'SELECT page_id, name, email FROM page_access_token_message WHERE email = $1',
            [userEmail]
        );
        console.log(`Found ${personalPages.rowCount} pages.`);
        if (personalPages.rowCount > 0) console.table(personalPages.rows);

        // Scenario B: Team Workspace (automationhubbd@gmail.com)
        const teamOwner1 = 'automationhubbd@gmail.com';
        console.log(`\n--- Scenario B: Team Workspace (${teamOwner1}) ---`);
        const teamRes1 = await client.query(
            'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
            [userEmail, teamOwner1, 'active']
        );
        if (teamRes1.rowCount === 0) {
            console.log("No active team membership found.");
        } else {
            console.log("Team membership found.");
            const permissions = teamRes1.rows[0].permissions;
            const fbPages = permissions.fb_pages || [];
            console.log("Shared Pages IDs:", fbPages);
            if (fbPages.length > 0) {
                 const pagesRes = await client.query(
                    'SELECT page_id, name, email FROM page_access_token_message WHERE page_id = ANY($1::text[])',
                    [fbPages.map(String)]
                );
                console.table(pagesRes.rows);
            }
        }

        // Scenario C: Team Workspace (automationhubbd24@gmail.com)
        const teamOwner2 = 'automationhubbd24@gmail.com';
        console.log(`\n--- Scenario C: Team Workspace (${teamOwner2}) ---`);
        const teamRes2 = await client.query(
            'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
            [userEmail, teamOwner2, 'active']
        );
        if (teamRes2.rowCount === 0) {
            console.log("No active team membership found.");
        } else {
            console.log("Team membership found.");
            const permissions = teamRes2.rows[0].permissions;
            const fbPages = permissions.fb_pages || [];
            console.log("Shared Pages IDs:", fbPages);
            if (fbPages.length > 0) {
                 const pagesRes = await client.query(
                    'SELECT page_id, name, email FROM page_access_token_message WHERE page_id = ANY($1::text[])',
                    [fbPages.map(String)]
                );
                console.table(pagesRes.rows);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        console.log("\n=== 5. ALL Pages in System (Debug) ===");
const allPagesRes = await client.query(`SELECT id, page_id, name, email FROM page_access_token_message`);
console.table(allPagesRes.rows);

console.log("\n=== 6. ALL Team Memberships for xbluewhalebd (Fuzzy Search) ===");
const allTeamsRes = await client.query(`SELECT * FROM team_members WHERE member_email ILIKE '%xbluewhalebd%'`);
console.table(allTeamsRes.rows);

console.log("\n=== 7. ALL Team Memberships for automationhubbd24 (Owner Check) ===");
const autoHubTeamsRes = await client.query(`SELECT * FROM team_members WHERE owner_email ILIKE '%automationhubbd24%'`);
console.table(autoHubTeamsRes.rows);

await client.end();
    }
}

check();
