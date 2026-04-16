const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function fixUserPlan() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    const email = 'ovulationtestbd@gmail.com';

    console.log(`--- Updating Subscription Plan for ${email} ---`);
    const updateResult = await client.query(`
      UPDATE user_configs
      SET 
        subscription_plan = 'active',
        updated_at = NOW()
      WHERE LOWER(email) = LOWER($1)
      RETURNING user_id, email, subscription_plan, message_credit, permanent_credit
    `, [email]);

    if (updateResult.rows.length > 0) {
      console.log('✅ Updated user_configs:', updateResult.rows[0]);
    } else {
      console.log('❌ User not found in user_configs');
    }

    // Also ensure page status is active
    const updatePage = await client.query(`
      UPDATE page_access_token_message
      SET 
        subscription_status = 'active',
        updated_at = NOW()
      WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = LOWER($1))
      RETURNING page_id, subscription_status
    `, [email]);

    if (updatePage.rows.length > 0) {
      console.log('✅ Updated page_access_token_message rows:', updatePage.rows.length);
      updatePage.rows.forEach(r => console.log(`   Page ${r.page_id}: status set to ${r.subscription_status}`));
    }

    console.log('\n🚀 Done! Plan set to active. System should now allow replies.');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

fixUserPlan();
