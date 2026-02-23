const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, 'backend/.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        
        console.log("Starting Product Migration for Team Members...");

        // 1. Find potential Team Members with products
        // We look for users who are MEMBERS in team_members and have products in 'products' table
        const res = await client.query(`
            SELECT DISTINCT p.user_id, u.email 
            FROM products p
            JOIN users u ON p.user_id = u.id
            JOIN team_members tm ON tm.member_email = u.email
            WHERE tm.status = 'active'
        `);

        if (res.rows.length === 0) {
            console.log("No products found belonging to Team Members.");
            return;
        }

        console.log(`Found ${res.rows.length} users with products who are ALSO listed as team members.`);
        
        for (const row of res.rows) {
            const memberId = row.user_id;
            const memberEmail = row.email;

            console.log(`\nChecking User: ${memberEmail} (${memberId})`);
            
            // 2. Check if this member is a Team Member (ALWAYS migrate if they are in a team)
            // PREVIOUSLY: We skipped if they had personal resources.
            // NEW POLICY: If they are a team member, we assume their work belongs to the team.
            // Especially for xbluewhalebd who has a page but wants team visibility.
            
            // 3. Find their Team Owner
            const teamRes = await client.query('SELECT owner_email FROM team_members WHERE member_email = $1 AND status = \'active\'', [memberEmail]);
            
            if (teamRes.rows.length > 0) {
                let ownerEmail = teamRes.rows[0].owner_email;
                
                // Prioritize automationhubbd24
                const preferredOwner = 'automationhubbd24@gmail.com';
                const foundPreferred = teamRes.rows.find(row => row.owner_email === preferredOwner);
                if (foundPreferred) {
                    ownerEmail = preferredOwner;
                    console.log(` -> Prioritizing preferred team owner: ${ownerEmail}`);
                }

                console.log(` -> Found Team Owner: ${ownerEmail}`);
                
                const ownerUserRes = await client.query('SELECT id FROM users WHERE email = $1', [ownerEmail]);
                
                if (ownerUserRes.rows.length > 0) {
                    const ownerId = ownerUserRes.rows[0].id;
                    
                    console.log(` -> Moving products from ${memberEmail} to Team Owner ${ownerEmail} (${ownerId})...`);
                    
                    const updateRes = await client.query(
                        'UPDATE products SET user_id = $1 WHERE user_id = $2 RETURNING id',
                        [ownerId, memberId]
                    );
                    
                    console.log(`    ✅ Moved ${updateRes.rowCount} products.`);
                } else {
                    console.log(`    ❌ Owner ${ownerEmail} not found in users table.`);
                }
            } else {
                console.log(`    ❌ No active team owner found. Skipping.`);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
