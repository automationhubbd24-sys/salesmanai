const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres:GoKeD0hpf7UIekl9Rs7K613WZlpdS9BH4I2QuJRaMEYeXahDgEwB9zGPKQUX8niz@72.62.196.104:5432/postgres' });

(async () => {
    try {
        await client.connect();
        
        console.log("=== Checking Mystery User ===");
        const res = await client.query("SELECT id, email FROM users WHERE id = '8481a0bb-6c39-4a5c-a92b-a5a69056860c'");
        console.log('User 8481:', res.rows[0]);

        console.log("\n=== Checking Product 627 ===");
        const prod = await client.query("SELECT id, name, is_active FROM products WHERE id = '627'");
        console.log('Product 627:', prod.rows[0]);

        console.log("\n=== Checking Product 610 ===");
        const prod2 = await client.query("SELECT id, name, is_active FROM products WHERE id = '610'");
        console.log('Product 610:', prod2.rows[0]);

        await client.end();
    } catch (e) {
        console.error(e);
    }
})();
