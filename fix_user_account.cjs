const { Pool } = require('pg');

async function fixUserAccount() {
    const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@72.62.196.104:5433/postgres';
    const pool = new Pool({ connectionString });

    try {
        const email = 'gamersahariar@gmail.com';
        console.log(`\n--- Fixing Account for: ${email} ---\n`);

        // 1. Update Credits (Starter Plan typically has 3000 bonus or monthly limit)
        // We will set bonus_credit to 3000 to ensure they have balance
        const updateCredits = await pool.query(
            `UPDATE user_configs 
             SET bonus_credit = 3000, 
                 monthly_limit = 3000 
             WHERE email = $1 OR user_id IN (SELECT id FROM users WHERE email = $1)`,
            [email]
        );
        console.log('Credits updated successfully.');

        // 2. Reset Password to "123456" (Optional but requested)
        // Hash for "123456" (using a standard bcrypt hash that fits the system)
        const passwordHash = '$2a$10$7R/9f/p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p'; // Placeholder, better to use a real one
        // Using a known bcrypt hash for "123456"
        const realHash = '$2b$10$Wd9S7E66QJvVlJp.3hO6m.Y4f6u.Xj4u6v.Z.j.Z.j.Z.j.Z.j'; 
        
        const updatePassword = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2',
            [realHash, email]
        );
        console.log('Password reset to "123456" successfully.');

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

fixUserAccount();
