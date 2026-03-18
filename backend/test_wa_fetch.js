
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';
process.env.DATABASE_URL = DATABASE_URL;

const { query } = require('./src/services/pgClient');
const dbService = require('./src/services/dbService');

async function testWAFetch() {
    try {
        const userId = '45b7647f-8ee0-44c6-a230-ae82943ab6a6';
        const pageId = 'bottow_wh03lz';
        const strict = true;

        console.log(`\n--- Testing getProducts for WA (Strict) ---`);
        console.log(`User: ${userId}, Page: ${pageId}, Strict: ${strict}`);
        
        const result = await dbService.getProducts(userId, 1, 20, null, pageId, null, strict);
        console.log(`Found ${result.count} products.`);
        // console.log(JSON.stringify(result.data, null, 2));

        console.log(`\n--- Testing getProducts for WA (Non-Strict) ---`);
        const result2 = await dbService.getProducts(userId, 1, 20, null, pageId, null, false);
        console.log(`Found ${result2.count} products.`);
        // console.log(JSON.stringify(result2.data, null, 2));

    } catch (e) {
        console.error("Test Failed:", e.message);
    } finally {
        process.exit(0);
    }
}

testWAFetch();
