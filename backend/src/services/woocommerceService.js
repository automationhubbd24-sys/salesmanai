const WooCommerce = require("@woocommerce/woocommerce-rest-api");
const WooCommerceRestApi = WooCommerce.default || WooCommerce;

/**
 * Import products from WooCommerce Store
 * @param {string} userId - Supabase User ID
 * @param {string} url - Store URL
 * @param {string} consumerKey - CK
 * @param {string} consumerSecret - CS
 */
async function importProducts(userId, url, consumerKey, consumerSecret) {
    if (!url || !consumerKey || !consumerSecret) {
        throw new Error("Missing WooCommerce credentials");
    }

    const api = new WooCommerceRestApi({
        url: url,
        consumerKey: consumerKey,
        consumerSecret: consumerSecret,
        version: "wc/v3"
    });

    try {
        // Fetch Products (Limit 100 for now)
        const response = await api.get("products", { per_page: 50 });
        const wcProducts = response.data;

        if (!wcProducts || wcProducts.length === 0) {
            return { count: 0, message: "No products found in WooCommerce store." };
        }

        let importedCount = 0;

        for (const p of wcProducts) {
            // Map Data
            // Handle Description: remove HTML tags if needed, or keep them. 
            // Simple strip tags for description as our UI is simple text
            const description = (p.short_description || p.description || "").replace(/<[^>]*>?/gm, '');
            
            // Image
            const imageUrl = p.images && p.images.length > 0 ? p.images[0].src : null;

            // Variants Logic
            // If type is 'variable', we might want to fetch variations or just store it as is.
            // For now, let's map base fields.
            
            // Price & Stock
            const price = p.price || 0;
            const stock = typeof p.stock_quantity === 'number' ? p.stock_quantity : 0;
            
            // Construct Variant Array if needed (for our system compatibility)
            // But we are moving to top-level fields for simple products.
            // Let's populate variants JSON anyway for backward compat or if it's a variable product
            let variants = [];
            if (p.type === 'variable') {
                // We could fetch variations here, but that's N+1 API calls.
                // For MVP, just mark it as imported variable product or add a default variant
                variants.push({
                    name: "Default",
                    price: price,
                    currency: "BDT", // Default or need to fetch store currency
                    available: p.stock_status === 'instock'
                });
            } else {
                variants.push({
                    name: "Standard",
                    price: price,
                    currency: "BDT",
                    available: p.stock_status === 'instock'
                });
            }

            const productData = {
                user_id: userId,
                name: p.name,
                description: description.substring(0, 500), // Limit length
                image_url: imageUrl,
                price: price,
                currency: "BDT",
                stock: stock,
                is_active: p.status === 'publish',
                variants: variants // Keep for compatibility
            };

            const { query } = require('./pgClient');

            const existingRes = await query(
                'SELECT id FROM products WHERE user_id = $1 AND name = $2 LIMIT 1',
                [userId, p.name]
            );

            if (existingRes.rows.length > 0) {
                const existing = existingRes.rows[0];
                try {
                    await query(
                        `UPDATE products
                         SET name = $1,
                             description = $2,
                             keywords = $3,
                             image_url = $4,
                             price = $5,
                             stock = $6,
                             currency = $7,
                             variants = $8,
                             updated_at = NOW()
                         WHERE id = $9`,
                        [
                            productData.name,
                            productData.description,
                            productData.keywords,
                            productData.image_url,
                            productData.price,
                            productData.stock,
                            productData.currency,
                            productData.variants,
                            existing.id
                        ]
                    );
                    importedCount++;
                } catch (error) {
                    console.error(`[WC Import] Error updating ${p.name}:`, error.message);
                }
            } else {
                try {
                    await query(
                        `INSERT INTO products
                            (user_id, name, description, keywords, image_url, price, stock, currency, variants, is_active)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                        [
                            productData.user_id,
                            productData.name,
                            productData.description,
                            productData.keywords,
                            productData.image_url,
                            productData.price,
                            productData.stock,
                            productData.currency,
                            productData.variants,
                            productData.is_active
                        ]
                    );
                    importedCount++;
                } catch (error) {
                    console.error(`[WC Import] Error importing ${p.name}:`, error.message);
                }
            }
        }

        return { count: importedCount, message: `Successfully imported ${importedCount} products.` };

    } catch (error) {
        console.error("[WC Import] API Error:", error.message);
        throw new Error("Failed to connect to WooCommerce: " + error.message);
    }
}

module.exports = {
    importProducts
};
