const { Client } = require('pg');
const path = require('path');
// Fix path to point to backend/.env from root
require('dotenv').config({ path: path.resolve(__dirname, 'backend/.env') });

console.log("DB_USER:", process.env.DB_USER);
// console.log("DB_PASSWORD:", process.env.DB_PASSWORD); // Don't log password



const client = new Client({
    connectionString: process.env.DATABASE_URL
});


async function resolveProductOwnerUserId_SIMULATED(memberEmail, pageId) {
    console.log(`\n--- Simulating for Member: ${memberEmail}, Page: ${pageId || 'NONE'} ---`);
    
    // 1. Get Member ID
    const memberRes = await client.query('SELECT id FROM users WHERE email = $1', [memberEmail]);
    if (memberRes.rows.length === 0) return console.log("Member not found");
    const memberId = memberRes.rows[0].id;

    // 2. Simulate getEffectiveUserIdFromRequest (Auto-Detect)
    let effectiveUserId = memberId;
    let isTeamMember = false;
    let viewerEmail = memberEmail;

    // Check personal resources
    const ownPages = await client.query('SELECT 1 FROM page_access_token_message WHERE user_id = $1 LIMIT 1', [memberId]);
    const ownWa = await client.query('SELECT 1 FROM whatsapp_message_database WHERE user_id = $1 LIMIT 1', [memberId]);

    if (ownPages.rows.length === 0 && ownWa.rows.length === 0) {
        const teams = await client.query('SELECT owner_email FROM team_members WHERE member_email = $1 AND status = $2', [memberEmail, 'active']);
        if (teams.rows.length > 0) {
            const ownerEmail = teams.rows[0].owner_email; // Picks FIRST team
            const ownerRes = await client.query('SELECT id FROM users WHERE email = $1', [ownerEmail]);
            effectiveUserId = ownerRes.rows[0].id;
            isTeamMember = true;
            console.log(`[AutoDetect] Switched to Team Owner: ${ownerEmail} (${effectiveUserId})`);
        }
    }

    // 3. PROPOSED LOGIC: Page Context Check
    if (pageId) {
        const pageRes = await client.query(
            'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1 AND user_id IS NOT NULL LIMIT 1',
            [String(pageId)]
        );

        if (pageRes.rows.length > 0) {
            const pageOwnerId = pageRes.rows[0].user_id;
            const pageOwnerEmail = pageRes.rows[0].email;
            console.log(`[PageCheck] Page owned by: ${pageOwnerEmail} (${pageOwnerId})`);

            if (effectiveUserId === pageOwnerId) {
                console.log("RESULT: Match! Returning Effective User (Team Owner).");
                return effectiveUserId;
            }

            if (viewerEmail) {
                // Check 1: Is Viewer a member of Page Owner's Team? (Member adding to Owner's Page)
                const teamCheck = await client.query(
                    'SELECT 1 FROM team_members WHERE owner_email = $1 AND member_email = $2 AND status = $3',
                    [pageOwnerEmail, viewerEmail, 'active']
                );
                
                if (teamCheck.rows.length > 0) {
                    console.log(`[ContextSwitch] Member belongs to Page Owner's Team! Switching to Page Owner.`);
                    return pageOwnerId;
                }

                // Check 2: Is Page Owner a member of Viewer's Team? (Owner adding to Member's Page)
                const reverseTeamCheck = await client.query(
                    'SELECT 1 FROM team_members WHERE owner_email = $1 AND member_email = $2 AND status = $3',
                    [viewerEmail, pageOwnerEmail, 'active']
                );
                
                if (reverseTeamCheck.rows.length > 0) {
                    console.log(`[ContextSwitch] Page Owner (${pageOwnerEmail}) is a member of Viewer's (${viewerEmail}) Team! Assigning to Viewer (Team Owner).`);
                    return effectiveUserId;
                }
            }
            
            console.log("RESULT: Returning Page Owner (Standard Assignment).");
            return pageOwnerId;
        }
    }

    if (isTeamMember) {
        console.log("RESULT: Returning Effective User (Auto-Detected Team Owner).");
        return effectiveUserId;
    }

    console.log("RESULT: Returning Member ID (Personal).");
    return effectiveUserId;
}

async function run() {
    try {
        await client.connect();
        
        const memberEmail = 'xbluewhalebd@gmail.com';
        const owner2Email = 'automationhubbd24@gmail.com';

        // Get a page for Owner 2
        const owner2Res = await client.query('SELECT id FROM users WHERE email = $1', [owner2Email]);
        const owner2Id = owner2Res.rows[0].id;
        
        console.log(`\nChecking Pages for Owner 2 (${owner2Email}):`);
        const owner2Pages = await client.query('SELECT page_id, user_id FROM page_access_token_message WHERE user_id = $1', [owner2Id]);
        owner2Pages.rows.forEach(p => console.log(` - Page ID: ${p.page_id}`));
        
        console.log(`\nChecking Pages for Member (${memberEmail}):`);
        const memberUserRes = await client.query('SELECT id FROM users WHERE email = $1', [memberEmail]);
        const memberUserId = memberUserRes.rows[0].id;
        const memberPages = await client.query('SELECT page_id, user_id FROM page_access_token_message WHERE user_id = $1', [memberUserId]);
        memberPages.rows.forEach(p => console.log(` - Page ID: ${p.page_id}`));

        let testPageId = null;
        if (owner2Pages.rows.length > 0) testPageId = owner2Pages.rows[0].page_id;
        else if (memberPages.rows.length > 0) testPageId = memberPages.rows[0].page_id;

        console.log(`Test Page ID: ${testPageId}`);

        // TEST 1: Member adds to Owner Page (Scenario B)
        // Owner 2 Page: Sales Ai (951912431342790)
        // Member: xbluewhalebd
        const ownerPageId = '951912431342790';
        console.log(`\nTEST 1: Member (${memberEmail}) adds to Owner Page (${ownerPageId})`);
        await resolveProductOwnerUserId_SIMULATED(memberEmail, ownerPageId);

        // TEST 2: Owner adds to Member Page (Scenario A)
        // Member Page: Note Master (666370203227659)
        // Owner: automationhubbd24
        const memberPageId = '666370203227659';
        console.log(`\nTEST 2: Owner (${owner2Email}) adds to Member Page (${memberPageId})`);
        await resolveProductOwnerUserId_SIMULATED(owner2Email, memberPageId);

        // Scenario 1: No Page
        await resolveProductOwnerUserId_SIMULATED(memberEmail, null);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
