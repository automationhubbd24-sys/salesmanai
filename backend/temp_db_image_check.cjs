const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const pageId = '442734308926132';
  const prodRes = await c.query(`
    SELECT id, name, image_url, additional_images
    FROM products 
    WHERE allowed_messenger_ids::text LIKE $1
    ORDER BY id DESC LIMIT 5
  `, [`%${pageId}%`]);
  
  console.log("=== DB Products Images ===");
  prodRes.rows.forEach(row => {
      let addImages = [];
      try { addImages = typeof row.additional_images === 'string' ? JSON.parse(row.additional_images) : (row.additional_images || []); } catch(e){}
      console.log(`Product: ${row.name} (ID: ${row.id})`);
      console.log(`Main Image: ${row.image_url ? 'Yes' : 'No'}`);
      console.log(`Additional Images Count: ${Array.isArray(addImages) ? addImages.length : 0}`);
      console.log('---');
  });

  await c.end();
})().catch(err => { console.error(err); process.exit(1); });
