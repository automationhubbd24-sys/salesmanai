const db = require('./src/services/dbService');
(async () => {
  const q1 = await db.searchProductsForResource('34 size pusha bra', '442734308926132');
  const q2 = await db.searchProductsForResource('38 size pusha bra', '442734308926132');
  console.log("=== Query for 34 ===");
  console.log(JSON.stringify(q1.map(p => ({ id: p.id, name: p.name, sku: p.sku_matrix })), null, 2));
  console.log("=== Query for 38 ===");
  console.log(JSON.stringify(q2.map(p => ({ id: p.id, name: p.name, sku: p.sku_matrix })), null, 2));
  process.exit(0);
})().catch((err)=>{ console.error(err); process.exit(1); });
