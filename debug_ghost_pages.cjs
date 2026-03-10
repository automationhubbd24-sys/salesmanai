const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function debugGhostPages() {
    try {
        await client.connect();
        console.log('Connected to database.');

        const targetEmails = ['xbluewhalebd@gmail.com', 'automationhubbd24@gmail.com', 'automationhubbd@gmail.com'];
        
        for (const targetEmail of targetEmails) {
            console.log(`\n--- Investigating for: ${targetEmail} ---`);

            // 1. Check Direct Page Ownership
            const myPages = await client.query(
                'SELECT * FROM page_access_token_message WHERE email = $1',
                [targetEmail]
            );
            console.log(`\n[Direct Pages] Count: ${myPages.rows.length}`);
            myPages.rows.forEach(r => console.log(` - ${r.page_name || r.name || 'Unknown'} (${r.page_id}) [Owner: ${r.email}]`));

            // 2. Check Team Memberships (Where targetEmail is a member)
            const memberships = await client.query(
                'SELECT * FROM team_members WHERE member_email = $1',
                [targetEmail]
            );
            console.log(`\n[Team Memberships as Member] Count: ${memberships.rows.length}`);
            memberships.rows.forEach(r => console.log(` - Member of Owner: ${r.owner_email} (Status: ${r.status})`));

             // 3. Check Team Ownerships (Where targetEmail is the owner)
            const ownerships = await client.query(
                'SELECT * FROM team_members WHERE owner_email = $1',
                [targetEmail]
            );
            console.log(`\n[Team Memberships as Owner] Count: ${ownerships.rows.length}`);
            ownerships.rows.forEach(r => console.log(` - Has Member: ${r.member_email} (Status: ${r.status})`));

            // 4. Simulate GET /pages Logic (Simplified)
            // Logic: Get pages where email = target OR email IN (owners where target is member)
            const ownerEmails = memberships.rows.map(r => r.owner_email);
            const allEmails = [targetEmail, ...ownerEmails];
            
            console.log(`\n[Simulated Access List] Emails: ${JSON.stringify(allEmails)}`);

            if (allEmails.length > 0) {
                const visiblePages = await client.query(
                    `SELECT * FROM page_access_token_message WHERE email = ANY($1::text[])`,
                    [allEmails]
                );
                console.log(`\n[Visible Pages via Logic] Count: ${visiblePages.rows.length}`);
                visiblePages.rows.forEach(r => console.log(` - ${r.page_name || r.name || 'Unknown'} (${r.page_id}) [Owner: ${r.email}]`));
            }
        }

        // 5. Global Check for 'azaharlifrimuck714420'
        console.log(`\n--- Global Check for azaharlifrimuck714420 ---`);
        const azaharTeam = await client.query(
            "SELECT * FROM team_members WHERE member_email LIKE '%azaharlifrimuck714420%' OR owner_email LIKE '%azaharlifrimuck714420%'"
        );
        console.log(`[Team Check] Count: ${azaharTeam.rows.length}`);
        
        const azaharPages = await client.query(
            "SELECT * FROM page_access_token_message WHERE email LIKE '%azaharlifrimuck714420%'"
        );
        console.log(`[Page Owner Check] Count: ${azaharPages.rows.length}`);
        azaharPages.rows.forEach(r => console.log(` - Page: ${r.page_name} Owner: ${r.email}`));

        // Check user_configs for this email
        const azaharConfig = await client.query(
            "SELECT * FROM user_configs WHERE email LIKE '%azaharlifrimuck714420%'"
        );
        console.log(`[Config Check] Count: ${azaharConfig.rows.length}`);

        // Check if there are any other tables? Maybe invitations?
        try {
             const invitations = await client.query("SELECT * FROM team_invitations WHERE invitee_email LIKE '%azaharlifrimuck714420%' OR inviter_email LIKE '%azaharlifrimuck714420%'");
             console.log(`[Invitations Check] Count: ${invitations.rows.length}`);
             invitations.rows.forEach(r => console.log(` - Inviter: ${r.inviter_email} Invitee: ${r.invitee_email}`));
        } catch (e) {
            console.log("No team_invitations table or error: " + e.message);
        }


    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

debugGhostPages();
