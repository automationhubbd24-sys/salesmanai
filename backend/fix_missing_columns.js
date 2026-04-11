const { Client } = require('pg');
require('dotenv').config();

const connectionString = 'postgres://postgres:KNCyFJA3h3NJdfQJ4QgDGJ76bSX0ApnjTbXB5aPFiSEeUeYMB2XVecXbrQXxi4bA@sg4wkgwk8oss8kwgkcsgws8k:5432/postgres';

async function fix() {
  const client = new Client({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const queries = [
      'ALTER TABLE fb_message_database ADD COLUMN IF NOT EXISTS engine_override VARCHAR(255)',
      'ALTER TABLE whatsapp_message_database ADD COLUMN IF NOT EXISTS engine_override VARCHAR(255)'
    ];

    for (const q of queries) {
      console.log(`Executing: ${q}`);
      await client.query(q);
    }

    console.log('All columns added successfully!');
  } catch (err) {
    console.error('Error executing queries:', err);
  } finally {
    await client.end();
  }
}

fix();
