const WooCommerce = require("@woocommerce/woocommerce-rest-api");
const WooCommerceRestApi = WooCommerce.default || WooCommerce;
const { supabase } = require('./dbService');

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

            // Check if product already exists (Simple deduplication by name)
            const { data: existing } = await supabase
                .from('products')
                .select('id')
                .eq('user_id', userId)
                .eq('name', p.name)
                .maybeSingle();

            if (existing) {
                // Update existing product
                const { error } = await supabase
                    .from('products')
                    .update(productData)
                    .eq('id', existing.id);
                
                if (error) console.error(`[WC Import] Error updating ${p.name}:`, error.message);
                else importedCount++;
            } else {
                // Insert new product
                const { error } = await supabase
                    .from('products')
                    .insert(productData);

                if (!error) {
                    importedCount++;
                } else {
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
