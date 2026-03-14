const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runMigration() {
    try {
        console.log("Running migration to add audio_detection column...");
        await pool.query(`
            ALTER TABLE public.fb_message_database 
            ADD COLUMN IF NOT EXISTS audio_detection boolean DEFAULT false;
        `);
        console.log("Migration successful!");
    } catch (error) {
        console.error("Migration failed:", error);
    } finally {
        await pool.end();
    }
}

runMigration();
