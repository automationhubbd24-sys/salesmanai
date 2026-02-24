
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const OWNER_ID = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
const PAGE_ID = '1018705751321580';
const MEMBER_EMAIL = 'xbluewhalebd@gmail.com';

(async () => {
  try {
    console.log("--- Checking Schema ---");
    const schemaRes = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'allowed_page_ids'");
    console.log("allowed_page_ids type:", schemaRes.rows[0]);

    console.log("\n--- Checking Team Member ---");
    const teamRes = await pool.query("SELECT * FROM team_members WHERE member_email = $1", [MEMBER_EMAIL]);
    console.log("Team Member:", teamRes.rows);

    console.log("\n--- Testing Owner Query ---");
    // Simulate: isPageOwner = true -> user_id = $1
    const ownerQuery = "SELECT id, name, user_id, allowed_page_ids FROM products WHERE user_id = $1";
    const ownerRes = await pool.query(ownerQuery, [OWNER_ID]);
    console.log(`Owner Query found ${ownerRes.rows.length} products.`);
    if (ownerRes.rows.length > 0) console.log(ownerRes.rows[0]);

    console.log("\n--- Testing Team Member Query ---");
    // Simulate: allowedPageIds = [PAGE_ID]
    // SQL from dbService.js
    const teamQuery = `
      SELECT id, name, user_id, allowed_page_ids FROM products 
      WHERE (
        (user_id = $1 AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb))
        OR
        (allowed_page_ids::jsonb @> jsonb_build_array($2::text) AND allowed_page_ids::jsonb ?| array[$2])
      )
    `;
    const teamResQuery = await pool.query(teamQuery, [OWNER_ID, PAGE_ID]);
    console.log(`Team Query found ${teamResQuery.rows.length} products.`);
    if (teamResQuery.rows.length > 0) console.log(teamResQuery.rows[0]);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
})();
