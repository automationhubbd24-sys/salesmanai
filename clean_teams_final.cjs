const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        
        console.log("Cleaning team_members table...");
        
        // Keep only the 2 authorized pairs
        const keepPairs = [
            { owner: 'helenaqueen010@gmail.com', member: 'xbluewhalebd@gmail.com' },
            { owner: 'azaharalifrimick714420@gmail.com', member: 'automationhubbd24@gmail.com' }
        ];

        // Construct NOT IN clause logic
        // We can't easily use NOT IN with pairs, so we'll use a DELETE with WHERE NOT (condition1 OR condition2)
        
        const conditions = keepPairs.map(p => 
            `(owner_email = '${p.owner}' AND member_email = '${p.member}')`
        ).join(' OR ');

        const query = `
            DELETE FROM team_members 
            WHERE NOT (${conditions})
        `;

        console.log("Executing:", query);
        const res = await client.query(query);
        console.log(`Deleted ${res.rowCount} rows.`);

        console.log("\nRemaining rows:");
        const remaining = await client.query("SELECT owner_email, member_email FROM team_members");
        console.table(remaining.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

run();
