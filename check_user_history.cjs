const { Pool } = require('pg');

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const pool = new Pool({ connectionString });

async function checkHistory() {
    try {
        const senderId = '33922150767371949';
        console.log(`Fetching history for User ${senderId} from fb_chats...`);
        
        const result = await pool.query(
            "SELECT id, text, reply_by, timestamp, ai_model FROM fb_chats WHERE recipient_id = $1 OR sender_id = $1 ORDER BY timestamp DESC LIMIT 30",
            [senderId]
        );
        
        console.log("Chat History (Newest First):");
        result.rows.forEach(row => {
            const time = row.timestamp ? new Date(Number(row.timestamp)).toLocaleString() : 'N/A';
            console.log(`[${time}] ${row.reply_by.toUpperCase()}: ${row.text} (Model: ${row.ai_model || 'N/A'})`);
            console.log('---');
        });

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkHistory();
