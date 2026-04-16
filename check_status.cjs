const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function checkCurrentStatus() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    const targetPageId = '556398694221969';

    const result = await client.query(`
      SELECT 
        pam.page_id, 
        pam.user_id, 
        pam.subscription_status, 
        pam.message_credit, 
        pam.cheap_engine, 
        pam.api_key,
        u.email
      FROM page_access_token_message pam
      LEFT JOIN users u ON u.id = pam.user_id
      WHERE CAST(pam.page_id AS TEXT) = $1
    `, [targetPageId]);

    console.log('--- Current Page Status ---');
    if (result.rows.length > 0) {
      console.log(JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log('❌ Page not found');
    }

    // Check user config as well
    if (result.rows.length > 0 && result.rows[0].user_id) {
        const configResult = await client.query(`
            SELECT message_credit, bonus_credit, permanent_credit, daily_limit, daily_used
            FROM user_configs
            WHERE user_id::text = $1
        `, [result.rows[0].user_id]);
        console.log('\n--- User Config Status ---');
        console.log(JSON.stringify(configResult.rows[0], null, 2));
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

checkCurrentStatus();
