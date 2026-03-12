const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(__dirname, 'backend', '.env');
dotenv.config({ path: envPath });

const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
    try {
        await client.connect();
        const res = await client.query("SELECT owner_email, member_email, permissions FROM team_members WHERE member_email = 'xbluewhalebd@gmail.com'");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
})();
