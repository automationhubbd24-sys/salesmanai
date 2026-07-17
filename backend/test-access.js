
require('dotenv').config();
const { Client } = require('pg');
const dbService = require('./src/services/dbService');

// Let's test with the database from the user
const dbUrl = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';

async function test() {
    // First, let's connect and check some data
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    console.log('Connected to database!');

    // 1. Check what's in whatsapp_message_database
    const waResult = await client.query('SELECT * FROM whatsapp_message_database LIMIT 5');
    console.log('whatsapp_message_database:', waResult.rows);

    // 2. Check what's in products table
    const productsResult = await client.query('SELECT id, name, allowed_wa_sessions, allowed_messenger_ids FROM products LIMIT 10');
    console.log('products:', productsResult.rows);

    // Now, let's test resolveResourceSearchContext with a page_id from the user's example
    if (waResult.rows.length > 0) {
        const testPageId = waResult.rows[0].session_name; // Or waba_id, phone_number_id
        console.log('Testing resolveResourceSearchContext with page_id:', testPageId);
        const result = await dbService.resolveResourceSearchContext(testPageId);
        console.log('resolveResourceSearchContext result:', result);

        // Let's test searchProductsForResource
        const products = await dbService.searchProductsForResource('', testPageId);
        console.log('searchProductsForResource result:', products.map(p => ({ id: p.id, name: p.name })));

        // Test getResourceProductsWithMedia
        const mediaProducts = await dbService.getResourceProductsWithMedia(testPageId);
        console.log('getResourceProductsWithMedia result:', mediaProducts.map(p => ({ id: p.id, name: p.name })));
    }

    await client.end();
}

test().catch(console.error);
