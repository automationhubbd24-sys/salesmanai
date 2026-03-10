const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres'
});

async function migrate() {
    try {
        await client.connect();
        console.log("Starting DB Migration for api_engine_configs...");

        const columns = [
            'text_provider_override',
            'vision_provider_override',
            'voice_provider_override',
            'text_model',
            'vision_model',
            'voice_model',
            'text_rpm', 'text_rpd', 'text_rph',
            'vision_rpm', 'vision_rpd', 'vision_rph',
            'voice_rpm', 'voice_rpd', 'voice_rph'
        ];

        for (const col of columns) {
            try {
                await client.query(`ALTER TABLE api_engine_configs ADD COLUMN IF NOT EXISTS ${col} TEXT`);
                console.log(`Column ${col} checked/added.`);
            } catch (err) {
                console.warn(`Could not add column ${col}: ${err.message}`);
            }
        }

        // Ensure primary key or unique constraint on provider
        try {
            await client.query(`ALTER TABLE api_engine_configs ADD UNIQUE (provider)`);
        } catch (e) {}

        console.log("Migration completed successfully.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await client.end();
    }
}

migrate();
