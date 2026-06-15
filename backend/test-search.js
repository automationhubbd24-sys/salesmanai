
process.env.DATABASE_URL = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
const { Client } = require('pg');

const dbUrl = process.env.DATABASE_URL;

async function test() {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    const pageId = 'official_1480791229918104';

    // Manually test resolveResourceSearchContext
    let contextType = null;
    let isWhatsapp = false;
    let resourceIds = [];
    let userId = null;

    // Step 1: resolvePageContextType
    const sId = String(pageId);
    console.log('Step 1: resolvePageContextType for', sId);
    const waRes = await client.query('SELECT 1 FROM whatsapp_message_database WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1 LIMIT 1', [sId]);
    if (waRes.rows.length > 0) {
        contextType = 'whatsapp';
        isWhatsapp = true;
    }
    console.log('contextType:', contextType);

    // Step 2: Get userId
    console.log('Step 2: Get userId');
    let userResult = await client.query('SELECT user_id FROM whatsapp_sessions WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1 LIMIT 1', [sId]);
    if (userResult.rows.length > 0) {
        userId = userResult.rows[0].user_id;
    } else {
        userResult = await client.query('SELECT user_id FROM whatsapp_message_database WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1 LIMIT 1', [sId]);
        if (userResult.rows.length > 0) {
            userId = userResult.rows[0].user_id;
        }
    }
    console.log('userId:', userId);

    // Step 3: Get resourceIds for WhatsApp
    console.log('Step 3: Get resourceIds');
    const waData = await client.query('SELECT session_name, waba_id, phone_number_id FROM whatsapp_message_database WHERE session_name = $1 OR waba_id = $1 OR phone_number_id = $1 ORDER BY CASE WHEN session_name = $1 THEN 0 WHEN waba_id = $1 THEN 1 WHEN phone_number_id = $1 THEN 2 ELSE 3 END LIMIT 1', [sId]);
    if (waData.rows.length > 0) {
        const row = waData.rows[0];
        resourceIds = Array.from(new Set([sId, row.session_name, row.waba_id, row.phone_number_id].map(v => String(v || '').trim()).filter(Boolean)));
    }
    console.log('resourceIds:', resourceIds);

    // Now test appendAssignmentFilter manually
    console.log('Step 4: Test search products');
    const latestSql = `SELECT id, name, user_id, allowed_wa_sessions FROM products WHERE is_active = true AND user_id::text = $1::text AND (allowed_wa_sessions::jsonb @> jsonb_build_array($2::text) OR allowed_wa_sessions::jsonb @> jsonb_build_array($3::text) OR allowed_wa_sessions::jsonb @> jsonb_build_array($4::text)) ORDER BY id DESC LIMIT 5`;
    const latestParams = [String(userId), ...resourceIds];
    console.log('SQL:', latestSql);
    console.log('Params:', latestParams);
    const productsResult = await client.query(latestSql, latestParams);
    console.log('Products found:', productsResult.rows);

    // Now check what happens without the allowed filter
    console.log('Step 5: Check all products for this user');
    const allUserProducts = await client.query('SELECT id, name, allowed_wa_sessions FROM products WHERE is_active = true AND user_id::text = $1::text', [String(userId)]);
    console.log('All user products:', allUserProducts.rows);

    await client.end();
}

test().catch(console.error);
