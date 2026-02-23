
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres' });

(async () => {
    try {
        await client.connect();
        const pageId = '997118700148575';
        
        console.log(`\n=== Checking Page Ownership for ${pageId} ===`);
        const pageRes = await client.query(
            `SELECT user_id, email, created_at FROM page_access_token_message WHERE page_id = $1`,
            [pageId]
        );
        
        console.table(pageRes.rows);

        if (pageRes.rows.length > 1) {
            console.warn("WARNING: Multiple owners/tokens found for the same page!");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
})();
