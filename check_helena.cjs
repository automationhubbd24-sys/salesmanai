const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(__dirname, 'backend', '.env');
dotenv.config({ path: envPath });

const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
    try {
        await client.connect();
        const res = await client.query("SELECT * FROM team_members WHERE member_email = 'helenaqueen010@gmail.com' AND owner_email = 'automationhubbd24@gmail.com'");
        console.log(`Helena membership in AutomationHub24: ${res.rowCount}`);
        if (res.rowCount > 0) console.log(res.rows[0]);
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
})();
