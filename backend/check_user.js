
const { Client } = require('pg');
const DATABASE_URL = 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres';

async function checkUser() {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
        await client.connect();
        const res = await client.query("SELECT id, email FROM users WHERE email = 'automationhubbd24@gmail.com'");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e.message);
    } finally {
        await client.end();
    }
}

checkUser();
