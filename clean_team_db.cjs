const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
const envPath = path.resolve(__dirname, 'backend', '.env');
dotenv.config({ path: envPath });

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
});

async function cleanTeamDatabase() {
    try {
        await client.connect();
        console.log('Connected to database.');

        // 1. List all current team members
        console.log('\n--- Current Team Members ---');
        const { rows: allMembers } = await client.query('SELECT * FROM team_members');
        allMembers.forEach(m => console.log(`ID: ${m.id} | Owner: ${m.owner_email} | Member: ${m.member_email} | Status: ${m.status}`));

        // 2. Identify rows to delete
        // User complained about: azaharalifrimick714420@gmail.com -> automationhubbd24@gmail.com
        // User mentioned keeping: helenaqueen010@gmail.com -> xbluewhalebd@gmail.com (as a professional example, but let's see if they want it)
        
        // Strategy: Keep ONLY helenaqueen010 -> xbluewhalebd (if it exists)
        // Delete everything else to "clean full team database" as requested.
        
        const keepOwner = 'helenaqueen010@gmail.com';
        const keepMember = 'xbluewhalebd@gmail.com';

        console.log(`\n--- Cleaning Database ---`);
        console.log(`Preserving: ${keepOwner} -> ${keepMember}`);

        const deleteQuery = `
            DELETE FROM team_members 
            WHERE NOT (owner_email = $1 AND member_email = $2)
        `;
        
        const { rowCount } = await client.query(deleteQuery, [keepOwner, keepMember]);
        console.log(`Deleted ${rowCount} rows.`);

        // 3. Verify
        console.log('\n--- Remaining Team Members ---');
        const { rows: remaining } = await client.query('SELECT * FROM team_members');
        remaining.forEach(m => console.log(`ID: ${m.id} | Owner: ${m.owner_email} | Member: ${m.member_email} | Status: ${m.status}`));

    } catch (err) {
        console.error('Error cleaning database:', err);
    } finally {
        await client.end();
    }
}

cleanTeamDatabase();
