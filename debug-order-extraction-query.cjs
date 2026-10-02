const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function pickTrace(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    user_message_id: row.user_message_id,
    bot_message_id: row.bot_message_id,
    user_preview: row.ai_data?.final_user_message_preview,
    reply_final: row.ai_data?.reply_final,
    ai_order_details: row.ai_data?.order_details,
    order_payload: row.order_data?.order_payload,
    order_error: row.order_data?.order_error
  };
}

async function main() {
  const sender = '28369395912670104';
  const page = '658762267328000';

  const orders = await pool.query(
    'select id,page_id,sender_id,customer_name,product_name,number,location,product_quantity,price,status,created_at,updated_at from fb_order_tracking where sender_id=$1 order by created_at desc limit 5',
    [sender]
  );
  console.log('ORDERS', JSON.stringify(orders.rows, null, 2));

  const chats = await pool.query(
    `select id,text,timestamp,status,reply_by,created_at,sender_name
     from fb_chats
     where sender_id=$1 and page_id=$2
     order by timestamp asc, created_at asc`,
    [sender, page]
  );
  console.log('CHATS', JSON.stringify(chats.rows, null, 2));

  const traces = await pool.query(
    `select id,user_message_id,bot_message_id,ai_data,order_data,created_at
     from ai_message_traces
     where sender_id=$1 and page_id=$2
     order by created_at asc`,
    [sender, page]
  );
  console.log('TRACES', JSON.stringify(traces.rows.map(pickTrace), null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
