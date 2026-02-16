const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

// Initialize Supabase (Reuse env vars)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const BUCKET_NAME = 'product-images';

/**
 * Uploads and optimizes an image for product entry.
 * @param {Buffer} fileBuffer - The file buffer from multer.
 * @param {string} mimeType - The original mime type.
 * @param {string} userId - The user ID (for folder organization).
 * @returns {Promise<string>} - The public URL of the uploaded image.
 */
async function uploadProductImage(fileBuffer, mimeType, userId) {
    try {
        // 1. Optimize Image with Sharp
        // Resize to max 1024px width/height, convert to JPEG for maximum WhatsApp/FB compatibility
        const optimizedBuffer = await sharp(fileBuffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();

        // 2. Generate Unique Filename
        const timestamp = Date.now();
        const filename = `${userId}/${timestamp}.jpg`;

        // 3. Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(filename, optimizedBuffer, {
                contentType: 'image/jpeg',
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            throw new Error(`Supabase Upload Error: ${error.message}`);
        }

        // 4. Get Public URL
        const { data: publicData } = supabase.storage
            .from(BUCKET_NAME)
            .getPublicUrl(filename);

        return publicData.publicUrl;

    } catch (error) {
        console.error("[ImageService] Upload Failed:", error);
        throw error;
    }
}

module.exports = {
    uploadProductImage
};
