function parseStoredMediaList(rawValue) {
    if (Array.isArray(rawValue)) return rawValue;
    if (typeof rawValue !== 'string' || !rawValue.trim()) return [];

    try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return rawValue
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
}

function productHasVariantDrivenMedia(product) {
    return (
        Array.isArray(product?.sku_matrix) && product.sku_matrix.length > 0
    ) || (
        Array.isArray(product?.variants) && product.variants.length > 1
    );
}

function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return url;

    // Auto-fix old Supabase URLs to new R2 domain
    // Old: https://tbkgipmtrggdykyknfcm.supabase.co/storage/v1/object/public/product-images/path/to/img.jpg
    // New: https://storage.salesmanchatbot.online/product-images/path/to/img.jpg
    if (url.includes('supabase.co/storage/v1/object/public/')) {
        const parts = url.split('/storage/v1/object/public/');
        if (parts.length > 1 && process.env.S3_PUBLIC_URL) {
            const publicBase = process.env.S3_PUBLIC_URL.replace(/\/$/, '');
            return `${publicBase}/${parts[1]}`;
        }
    }

    return url;
}

function buildResolvedProductMediaContext(product, options = {}) {
    const {
        queryText = '',
        preferredSkuKey = null,
        normalizeImageUrl: customNormalize = (value) => normalizeImageUrl(value),
        resolveProductSkuSelection
    } = options;

    if (typeof resolveProductSkuSelection !== 'function') {
        throw new Error('resolveProductSkuSelection is required');
    }

    const resolved = resolveProductSkuSelection(product, queryText, preferredSkuKey);
    const baseProduct = resolved.product || product;
    const selectedSku = resolved.selectedSku || null;
    
    // By default (isolate_sku_images = false), we treat products as not having variant media so that ALL images are shown.
    // If isolate_sku_images is enabled, we strictly check for SKU level images
    const hasVariantMedia = baseProduct?.isolate_sku_images ? productHasVariantDrivenMedia(baseProduct) : false;
    
    const mediaImages = [];
    const mediaVideos = [];

    if (selectedSku && hasVariantMedia) {
        // Collect all available SKU images
        const skuImages = Array.isArray(selectedSku.image_urls) ? selectedSku.image_urls : (selectedSku.image_url ? [selectedSku.image_url] : []);
        
        if (skuImages.length > 0) {
            skuImages.forEach(url => {
                const normalized = normalizeImageUrl(url);
                if (normalized) mediaImages.push(normalized);
            });
        } else {
            // Fallback to primary if SKU has no specific images
            const normalizedPrimary = normalizeImageUrl(baseProduct?.image_url);
            if (normalizedPrimary) mediaImages.push(normalizedPrimary);
        }
    } else {
        // Include SKU images if requested and they aren't isolated
        if (selectedSku) {
            const skuImages = Array.isArray(selectedSku.image_urls) ? selectedSku.image_urls : (selectedSku.image_url ? [selectedSku.image_url] : []);
            skuImages.forEach(url => {
                const normalized = normalizeImageUrl(url);
                if (normalized) mediaImages.push(normalized);
            });
        }

        const normalizedPrimary = normalizeImageUrl(baseProduct?.image_url);
        if (normalizedPrimary) mediaImages.push(normalizedPrimary);

        if (!hasVariantMedia) {
            parseStoredMediaList(baseProduct?.additional_images).forEach((url) => {
                const normalized = normalizeImageUrl(url);
                if (normalized) mediaImages.push(normalized);
            });
        }
    }

    if (selectedSku?.video_url) {
        const normalizedSkuVideo = normalizeImageUrl(selectedSku.video_url);
        if (normalizedSkuVideo) mediaVideos.push(normalizedSkuVideo);
    } else {
        const normalizedProductVideo = normalizeImageUrl(baseProduct?.video_url);
        if (normalizedProductVideo) mediaVideos.push(normalizedProductVideo);
    }

    return {
        product: baseProduct,
        selectedSku,
        missingAttributes: Array.isArray(resolved?.missingAttributes) ? resolved.missingAttributes : [],
        matches: Array.isArray(resolved?.matches) ? resolved.matches : [],
        mentionedValues: Array.isArray(resolved?.mentionedValues) ? resolved.mentionedValues : [],
        hasVariantMedia,
        mediaImages: Array.from(new Set(mediaImages.filter(Boolean))),
        mediaVideos: Array.from(new Set(mediaVideos.filter(Boolean)))
    };
}

module.exports = {
    parseStoredMediaList,
    productHasVariantDrivenMedia,
    buildResolvedProductMediaContext
};
