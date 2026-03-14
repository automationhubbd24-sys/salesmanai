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

async function strictClean() {
    try {
        await client.connect();
        console.log("Connected to database for strict cleanup.");

        // 1. Delete ALL team members
        console.log("Deleting ALL entries from team_members...");
        await client.query('DELETE FROM team_members');

        // 2. Insert the Allowed Pairs
        const allowedPairs = [
            {
                owner: 'helenaqueen010@gmail.com',
                member: 'xbluewhalebd@gmail.com',
                permissions: { "fb_pages": [], "products": [], "features": [] } // Default permissions, can be updated later
            },
            {
                owner: 'azaharalifrimick714420@gmail.com',
                member: 'automationhubbd24@gmail.com',
                permissions: { "fb_pages": [], "products": [], "features": [] }
            }
        ];

        console.log("Restoring ONLY allowed pairs...");

        for (const pair of allowedPairs) {
            // Check if user exists first to avoid foreign key errors (if any)
            // Assuming strict foreign keys might not be set or users exist.
            // We will just insert. If it fails due to missing user, we log it.
            
            // We need to make sure we don't violate constraints if they exist.
            // But we just deleted everything, so we are good on uniqueness.
            
            await client.query(`
                INSERT INTO team_members (owner_email, member_email, status, permissions, created_at)
                VALUES ($1, $2, 'active', $3, NOW())
            `, [pair.owner, pair.member, pair.permissions]);
            
            console.log(`Restored: Owner ${pair.owner} -> Member ${pair.member}`);
        }

        console.log("Strict cleanup complete.");

    } catch (err) {
        console.error("Error during cleanup:", err);
    } finally {
        await client.end();
    }
}

strictClean();
