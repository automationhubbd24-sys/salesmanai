require('dotenv').config();
const { query } = require('./backend/src/services/pgClient');

async function check() {
    try {
        const res = await query('SELECT id, page_id, session_name, question_norm FROM semantic_cache LIMIT 50');
        console.log('Total entries:', res.rowCount);
        console.log('Sample entries:', JSON.stringify(res.rows, null, 2));
        
        const counts = await query('SELECT page_id, COUNT(*) as cnt FROM semantic_cache GROUP BY page_id');
        console.log('Counts per page_id:', JSON.stringify(counts.rows, null, 2));
        
        const sessions = await query('SELECT session_name, COUNT(*) as cnt FROM semantic_cache GROUP BY session_name');
        console.log('Counts per session_name:', JSON.stringify(sessions.rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}

check();
