
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const OWNER_EMAIL = 'automationhubbd24@gmail.com';
const MEMBER_EMAIL = 'xbluewhalebd@gmail.com';
const OWNER_ID = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';

async function simulateRequest(role, email, userId, teamOwnerParam) {
    console.log(`\n=== Simulating ${role} Request ===`);
    console.log(`Email: ${email}, UserID: ${userId}, TeamOwner: ${teamOwnerParam}`);

    // 1. Controller Logic: Determine Effective User
    let effectiveUserId = userId;
    let isTeamMember = false;
    let allowedPageIds = null;
    let targetUserId = userId;

    if (teamOwnerParam) {
        // Check Team Membership
        const teamRes = await pool.query(
            'SELECT owner_email FROM team_members WHERE LOWER(member_email) = LOWER($1) AND LOWER(owner_email) = LOWER($2) AND status = $3',
            [email, teamOwnerParam, 'active']
        );
        
        if (teamRes.rows.length > 0) {
            console.log("  -> Team Membership Found");
            const ownerRes = await pool.query('SELECT id FROM users WHERE email = $1', [teamOwnerParam]);
            effectiveUserId = ownerRes.rows[0].id;
            targetUserId = effectiveUserId;
            isTeamMember = true;
            
            // Fetch Permissions
            const permRes = await pool.query(
                'SELECT permissions FROM team_members WHERE member_email = $1 AND owner_email = $2 AND status = $3',
                [email, teamOwnerParam, 'active']
            );
            
            let teamPages = [];
            if (permRes.rows.length > 0) {
                permRes.rows.forEach(row => {
                    const perms = row.permissions || {};
                    if (Array.isArray(perms.fb_pages)) teamPages.push(...perms.fb_pages);
                    if (Array.isArray(perms.wa_sessions)) teamPages.push(...perms.wa_sessions);
                });
            }
            
            // Personal Pages
            const personalRes = await pool.query('SELECT page_id FROM page_access_token_message WHERE user_id = $1', [userId]);
            const personalPages = personalRes.rows.map(r => r.page_id);
            
            allowedPageIds = [...new Set([...teamPages, ...personalPages])].map(String);
            console.log(`  -> Allowed Pages: ${JSON.stringify(allowedPageIds)}`);
        } else {
             console.log("  -> No Team Membership Found (or self-reference)");
        }
    }

    // 2. DB Service Logic
    console.log(`  -> Querying DB with: UserID=${targetUserId}, AllowedPages=${allowedPageIds ? allowedPageIds.length : 'NULL'}`);
    
    let params = [];
    let whereClause = '';
    
    // PageID is NULL in this scenario
    params.push(targetUserId); // $1
    whereClause = 'user_id = $1';
    
    if (allowedPageIds !== null && allowedPageIds.length > 0) {
        const perms = allowedPageIds.map(String);
        params.push(perms); // $2
        whereClause += ` AND (
            (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb)
            OR 
            EXISTS (
                SELECT 1 
                FROM jsonb_array_elements_text(allowed_page_ids) AS elem 
                WHERE elem = ANY($${params.length}::text[])
            )
        )`;
    }
    
    console.log(`  -> SQL: SELECT count(*) FROM products WHERE ${whereClause}`);
    console.log(`  -> Params: ${JSON.stringify(params)}`);
    
    const res = await pool.query(`SELECT id, name, user_id, allowed_page_ids FROM products WHERE ${whereClause}`, params);
    console.log(`  -> Result: Found ${res.rows.length} products`);
    if (res.rows.length > 0) {
        console.log(`     Sample: ${res.rows[0].name} (Owner: ${res.rows[0].user_id})`);
    }
}

(async () => {
    try {
        // Scenario 1: Owner (No Team Owner param)
        await simulateRequest('OWNER', OWNER_EMAIL, OWNER_ID, null);

        // Scenario 2: Team Member (With Team Owner param)
        // Need to get Member ID first
        const memberRes = await pool.query('SELECT id FROM users WHERE email = $1', [MEMBER_EMAIL]);
        const memberId = memberRes.rows[0].id;
        await simulateRequest('MEMBER', MEMBER_EMAIL, memberId, OWNER_EMAIL);

        // Scenario 3: Team Member (WITHOUT Team Owner param - Current Bug)
        await simulateRequest('MEMBER_NO_PARAM', MEMBER_EMAIL, memberId, null);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
})();
