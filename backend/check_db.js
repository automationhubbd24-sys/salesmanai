const { Client } = require('pg');

const client = new Client({ 
    connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres' 
});

async function check() {
  try {
    await client.connect();
    console.log('--- FB Pages for Guardify BD ---');
    const res = await client.query("SELECT id, user_id, page_id, name, is_active FROM facebook_pages WHERE page_id = '468040036388093' OR name ILIKE '%Guardify%'");
    console.table(res.rows);
    
    if(res.rows.length > 0) {
       console.log('\n--- Recent Conversations for this page ---');
       const convs = await client.query("SELECT id, sender_id, page_id, updated_at FROM conversations WHERE page_id = $1 ORDER BY updated_at DESC LIMIT 5", [res.rows[0].page_id]);
       console.table(convs.rows);
       
       console.log('\n--- Checking user details ---');
       const userRes = await client.query("SELECT id, email FROM users WHERE id = $1", [res.rows[0].user_id]);
       console.table(userRes.rows);
    }
  } catch (error) {
    console.error(error);
  } finally {
    await client.end();
  }
}

check();