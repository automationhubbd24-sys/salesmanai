
const pg = require('pg');
const { Client } = pg;
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, 'backend/.env') });

async function migrate() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: false
    });

    try {
        await client.connect();
        console.log("Connected to DB for migration...");

        // Add is_combo and combo_items columns
        await client.query(`
            ALTER TABLE products 
            ADD COLUMN IF NOT EXISTS is_combo BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS combo_items JSONB DEFAULT '[]'::jsonb
        `);
        console.log("Added is_combo and combo_items columns to products table.");

    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        await client.end();
    }
}

migrate();
