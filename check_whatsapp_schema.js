
import pg from 'pg';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

const { Client } = pg;

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function checkSchema() {
    try {
        await client.connect();
        console.log('Connected to database');

        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'whatsapp_message_database';
        `);

        // console.log('Columns in whatsapp_message_database:');
        // res.rows.forEach(row => {
        //     console.log(`- ${row.column_name} (${row.data_type})`);
        // });

        const imagePrompt = res.rows.find(r => r.column_name === 'image_prompt');
        const wait = res.rows.find(r => r.column_name === 'wait');
        const checkConversion = res.rows.find(r => r.column_name === 'check_conversion');

        if (imagePrompt && wait && checkConversion) {
            console.log('\nSUCCESS: All required columns exist.');
        } else {
            console.log('\nFAILURE: Missing columns.');
            if (!imagePrompt) console.log('- Missing: image_prompt');
            if (!wait) console.log('- Missing: wait');
            if (!checkConversion) console.log('- Missing: check_conversion');
        }

    } catch (err) {
        console.error('Error checking schema:', err);
    } finally {
        await client.end();
    }
}

checkSchema();
