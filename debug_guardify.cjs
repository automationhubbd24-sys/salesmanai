const { Pool } = require('pg');

async function debugChat() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const pool = new Pool({ connectionString });

    try {
        const pageId = '468040036388093';
        console.log(`\n--- Debugging Page: ${pageId} (Guardify BD) ---\n`);

        // 1. Check Recent Messages
        const chatRes = await pool.query('SELECT * FROM fb_chats WHERE page_id = $1 ORDER BY timestamp DESC LIMIT 10', [pageId]);
        console.log(`\n--- Recent FB Chats (fb_chats) ---`);
        if (chatRes.rows.length > 0) {
            chatRes.rows.forEach(c => {
                const date = c.timestamp ? new Date(Number(c.timestamp)).toISOString() : 'N/A';
                console.log(`Sender: ${c.sender_id} | Status: ${c.status} | Text: ${String(c.text || '').substring(0, 50)}... | Time: ${date}`);
            });
        } else {
            console.log('No chat history found in fb_chats.');
        }

        // 2. Check Page Config Detail
        const pageConfig = await pool.query('SELECT * FROM page_access_token_message WHERE page_id = $1', [pageId]);
        console.log(`\n--- Page Config ---`);
        if (pageConfig.rows.length > 0) {
            const p = pageConfig.rows[0];
            console.log('Status:', p.subscription_status);
            console.log('User ID:', p.user_id);
            console.log('Cheap Engine:', p.cheap_engine);
            console.log('Token Exists:', !!p.page_access_token);
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

debugChat();
