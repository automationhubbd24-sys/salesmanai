
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const query = (text, params) => pool.query(text, params);

async function getProducts(userId, page = 1, limit = 20, searchQuery = null, pageId = null, allowedPageIds = null) {
    console.log(`[DB] getProducts Called - User: ${userId}, PageID: ${pageId}, AllowedPages: ${JSON.stringify(allowedPageIds)}`);
    const offset = (page - 1) * limit;

    let params = [];
    let whereClause = '';

    // 1. Base Filter: User & Page Context
    let isPageOwner = false;
    if (pageId) {
        try {
            const ownerCheck = await query('SELECT user_id FROM page_access_token_message WHERE page_id = $1', [String(pageId)]);
            if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].user_id === userId) {
                isPageOwner = true;
                console.log(`[DB] User ${userId} is OWNER of Page ${pageId}.`);
            } else {
                console.log(`[DB] User ${userId} is NOT owner. Real Owner: ${ownerCheck.rows[0]?.user_id}`);
            }
        } catch (e) {
            console.error("[DB] Page Owner Check Failed:", e);
        }
    }

    if (pageId) {
        // params.push(userId); // Move inside
        // params.push(String(pageId)); // Move inside
        
        if (isPageOwner || !allowedPageIds || (Array.isArray(allowedPageIds) && allowedPageIds.length === 0)) {
              params.push(userId); // $1
              params.push(String(pageId)); // $2
              whereClause = `user_id = $1 AND (
                  allowed_page_ids IS NULL 
                  OR allowed_page_ids::jsonb = '[]'::jsonb 
                  OR allowed_page_ids::jsonb @> jsonb_build_array($2::text)
              )`;
          } else {
            params.push(userId); // $1
            params.push(String(pageId)); // $2
            const perms = allowedPageIds.map(String);
            params.push(perms); // $3
            
            whereClause = `(
                (user_id = $1 AND (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb))
                OR
                (allowed_page_ids::jsonb @> jsonb_build_array($2::text) AND allowed_page_ids::jsonb ?| $3::text[] )
            )`;
        }
    } else {
        if (Array.isArray(userId)) {
            params.push(userId); // $1
            whereClause = 'user_id = ANY($1)';
        } else {
            params.push(userId); // $1
            whereClause = 'user_id = $1';
        }
    }

    if (allowedPageIds !== null && allowedPageIds.length > 0) {
        const perms = allowedPageIds.map(String);
        params.push(perms);
        whereClause += ` AND (
            (allowed_page_ids IS NULL OR allowed_page_ids::jsonb = '[]'::jsonb)
            OR 
            EXISTS (
                SELECT 1 
                FROM jsonb_array_elements_text(allowed_page_ids) AS elem 
                WHERE elem = ANY($${params.length}::text[])
            )
        )`;
    }

    console.log(`[DBDebug] Query: SELECT count(*) FROM products WHERE ${whereClause}`);
    console.log(`[DBDebug] Params:`, params);

    const countResult = await query(
        `SELECT COUNT(*)::int AS cnt
         FROM products
         WHERE ${whereClause}`,
        params
    );

    console.log(`[DB] Found ${countResult.rows[0].cnt} products.`);
    
    if (countResult.rows[0].cnt > 0) {
        const dataResult = await query(
            `SELECT id, name, user_id FROM products WHERE ${whereClause} LIMIT 1`,
            params
        );
        console.log("Sample:", dataResult.rows[0]);
    }
}

const OWNER_ID = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
const PAGE_ID = '1018705751321580';

(async () => {
    try {
        console.log("--- TEST OWNER ---");
        await getProducts(OWNER_ID, 1, 20, null, PAGE_ID, null);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
})();
