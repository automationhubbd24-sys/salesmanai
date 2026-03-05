const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres',
});

const PAGE_ID = '106524637410742'; // Rimu's shop

async function checkSchema() {
    try {
        await client.connect();
        console.log(`Checking schema for user_configs...`);
        
        const res = await client.query(`
            SELECT * FROM user_configs LIMIT 1
        `);
        
        if (res.rows.length > 0) {
            console.log("Columns found:");
            console.log(Object.keys(res.rows[0]));
        } else {
            console.log("Table is empty.");
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkSchema();
