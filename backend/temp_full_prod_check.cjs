const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const pageId = '442734308926132';
  const res = await c.query(`
    SELECT id, name, product_mode, price, stock, image_url, additional_images, attribute_schema, sku_matrix 
    FROM products 
    WHERE allowed_messenger_ids::text LIKE $1
    ORDER BY id ASC
  `, [`%${pageId}%`]);
  
  console.log(JSON.stringify(res.rows, null, 2));

  await c.end();
})().catch(err => { console.error(err); process.exit(1); });
