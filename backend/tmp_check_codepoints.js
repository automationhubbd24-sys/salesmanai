const { Client } = require('pg');
const session = 'official_2557742014603031_751467468050798';
const cp = (value) => Array.from(String(value || '')).map((char) => char.codePointAt(0).toString(16)).join(' ');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const config = await client.query(
    `SELECT lock_emojis, unlock_emojis, block_emoji, unblock_emoji
     FROM whatsapp_message_database
     WHERE session_name = $1 LIMIT 1`,
    [session]
  );
  console.log('CONFIG_CODEPOINTS', JSON.stringify(config.rows.map(row => ({
    lock_emojis: cp(row.lock_emojis),
    unlock_emojis: cp(row.unlock_emojis),
    block_emoji: cp(row.block_emoji),
    unblock_emoji: cp(row.unblock_emoji)
  })), null, 2));
  const recent = await client.query(
    `SELECT text, recipient_id, timestamp FROM whatsapp_chats
     WHERE session_name = $1 AND reply_by = 'admin'
     ORDER BY timestamp DESC LIMIT 8`,
    [session]
  );




  console.log('ADMIN_CODEPOINTS', JSON.stringify(recent.rows.map(row => ({
    recipient_id: row.recipient_id,
    text_codepoints: cp(row.text),
    timestamp: row.timestamp
  })), null, 2));
  await client.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
