const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
});

// Mock Request Helpers
async function mockResolveProductOwner(baseUserId, pageId, teamOwnerEmail = null) {
    // Replicating the logic from productController.js
    // We need to simulate the DB calls
    
    // 1. Resolve Effective User
    let effectiveUserId = baseUserId;
    let isTeamMember = false;
    
    if (teamOwnerEmail) {
        const teamRes = await client.query(
            'SELECT owner_email FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
            ['xbluewhalebd@gmail.com', teamOwnerEmail, 'active'] // Assuming acting as member xbluewhalebd
        );
        if (teamRes.rows.length > 0) {
            const ownerRes = await client.query('SELECT id FROM users WHERE email = $1', [teamOwnerEmail]);
            effectiveUserId = ownerRes.rows[0].id;
            isTeamMember = true;
        }
    }
    
    if (isTeamMember) {
        return { userId: effectiveUserId, note: "Team Owner (Context)" };
    }
    
    // 2. Fallback: Page Owner
    if (pageId) {
        const pageRes = await client.query(
            'SELECT user_id, email FROM page_access_token_message WHERE page_id = $1',
            [pageId]
        );
        if (pageRes.rows.length > 0 && pageRes.rows[0].user_id) {
            return { userId: pageRes.rows[0].user_id, note: `Page Owner (${pageRes.rows[0].email})` };
        }
    }
    
    // 3. Fallback
    return { userId: effectiveUserId, note: "Effective User (Personal)" };
}

async function runDebug() {
    try {
        await client.connect();
        
        console.log("=== Debugging Product Ownership Logic ===");
        
        // 1. Setup Data
        // Owner: automationhubbd24@gmail.com
        const ownerRes = await client.query("SELECT id, email FROM users WHERE email = 'automationhubbd24@gmail.com'");
        const ownerId = ownerRes.rows[0].id;
        const ownerEmail = ownerRes.rows[0].email;
        
        // Member: xbluewhalebd@gmail.com
        const memberRes = await client.query("SELECT id, email FROM users WHERE email = 'xbluewhalebd@gmail.com'");
        const memberId = memberRes.rows[0].id;
        const memberEmail = memberRes.rows[0].email;
        
        console.log(`Owner: ${ownerEmail} (${ownerId})`);
        console.log(`Member: ${memberEmail} (${memberId})`);
        
        // Find a page owned by the Member
        const memberPageRes = await client.query("SELECT page_id, name, user_id FROM page_access_token_message WHERE user_id = $1 LIMIT 1", [memberId]);
        let memberPageId = memberPageRes.rows.length > 0 ? memberPageRes.rows[0].page_id : null;
        console.log(`Page owned by Member: ${memberPageId || 'None'}`);

        // If no page owned by member, try to find one where member is just assigned? 
        // For this repro, we need a page that might cause the issue. 
        // If member owns NO pages, then the "Owner creating product shows in member page" might mean something else.
        // Let's assume the user meant "Product created by Owner is assigned to Member".
        
        // SCENARIO 1: Owner creates product for a Page owned by Member
        if (memberPageId) {
            console.log("\n--- Scenario 1: Owner creates product for Page owned by Member ---");
            const result = await mockResolveProductOwner(ownerId, memberPageId, null);
            console.log(`Result UserID: ${result.userId} (${result.note})`);
            
            if (result.userId === memberId) {
                console.log("❌ ISSUE: Product assigned to Member, not Owner!");
            } else {
                console.log("✅ OK: Product assigned to Owner.");
            }
        } else {
            console.log("Skipping Scenario 1 (No page owned by member found)");
        }
        
        // SCENARIO 2: Member creates product (Team Context)
        console.log("\n--- Scenario 2: Member creates product (Team Context) ---");
        // Member acting in Owner's team
        const result2 = await mockResolveProductOwner(memberId, null, ownerEmail);
        console.log(`Result UserID: ${result2.userId} (${result2.note})`);
        
        if (result2.userId === ownerId) {
            console.log("✅ OK: Product assigned to Owner.");
        } else {
            console.log("❌ ISSUE: Product assigned to Member!");
        }
        
        // SCENARIO 3: Member creates product (Personal Context / Mistake)
        console.log("\n--- Scenario 3: Member creates product (No Team Context) ---");
        const result3 = await mockResolveProductOwner(memberId, null, null);
        console.log(`Result UserID: ${result3.userId} (${result3.note})`);
         if (result3.userId === memberId) {
            console.log("ℹ️ INFO: Product assigned to Member (Personal). This creates 'Invisible' products in Team View.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

runDebug();
