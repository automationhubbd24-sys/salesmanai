const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const UPLOAD_ROOT = process.env.IMAGE_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'product-images');

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
        const userFolder = String(userId || 'anonymous');
        const dirPath = path.join(UPLOAD_ROOT, userFolder);
        const fileName = `${timestamp}.jpg`;
        const filePath = path.join(dirPath, fileName);

        await fs.promises.mkdir(dirPath, { recursive: true });
        await fs.promises.writeFile(filePath, optimizedBuffer);

        const base = PUBLIC_BASE_URL.replace(/\/$/, '');
        const relativeUrl = `/uploads/product-images/${encodeURIComponent(userFolder)}/${encodeURIComponent(fileName)}`;

        return `${base}${relativeUrl}`;

    } catch (error) {
        console.error("[ImageService] Upload Failed:", error);
        throw error;
    }
}

module.exports = {
    uploadProductImage
};
