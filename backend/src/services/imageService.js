const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Configure S3 Client if env vars are present
let s3Client = null;
if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
    s3Client = new S3Client({
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY
        },
        forcePathStyle: true // Required for MinIO/Coolify usually
    });
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const UPLOAD_ROOT = process.env.IMAGE_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'product-images');

/**
 * Uploads and optimizes an image for product entry.
 * @param {Buffer} fileBuffer - The file buffer from multer.
 * @param {string} mimeType - The original mime type.
 * @param {string} userId - The user ID (for folder organization).
 * @param {string} [baseUrl] - The base URL (optional, defaults to env or localhost).
 * @returns {Promise<string>} - The public URL of the uploaded image.
 */
async function uploadProductImage(fileBuffer, mimeType, userId, baseUrl) {
    try {
        let finalBuffer = fileBuffer;
        let extension = 'jpg';
        let contentType = mimeType;

        // Check if optimization is skipped to save CPU
        if (process.env.SKIP_IMAGE_OPTIMIZATION === 'true') {
            // Use original extension based on mimeType
            if (mimeType === 'image/png') extension = 'png';
            else if (mimeType === 'image/webp') extension = 'webp';
            else if (mimeType === 'image/gif') extension = 'gif';
            // contentType remains as original mimeType
        } else {
            // 1. Optimize Image with Sharp (CPU Intensive)
            // Resize to max 1024px width/height, convert to JPEG for maximum WhatsApp/FB compatibility
            finalBuffer = await sharp(fileBuffer)
                .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80, mozjpeg: true })
                .toBuffer();
            extension = 'jpg';
            contentType = 'image/jpeg';
        }

        // 2. Generate Unique Filename
        const timestamp = Date.now();
        const userFolder = String(userId || 'anonymous');
        const fileName = `${timestamp}.${extension}`;

        // 3. Upload to S3 (if configured) or Local Disk
        if (s3Client && process.env.S3_BUCKET) {
            const key = `product-images/${userFolder}/${fileName}`;
            const command = new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: key,
                Body: finalBuffer,
                ContentType: contentType,
                ACL: 'public-read' // Optional, depends on bucket policy
            });

            await s3Client.send(command);

            // Construct S3 URL
            // If S3_PUBLIC_URL is defined, use it (for CDN/Custom Domain)
            // Otherwise construct from endpoint
            if (process.env.S3_PUBLIC_URL) {
                return `${process.env.S3_PUBLIC_URL}/${key}`;
            } else {
                // Fallback to endpoint/bucket/key
                const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, '');
                return `${endpoint}/${process.env.S3_BUCKET}/${key}`;
            }

        } else {
            // Local Disk Fallback
            const dirPath = path.join(UPLOAD_ROOT, userFolder);
            const filePath = path.join(dirPath, fileName);

            await fs.promises.mkdir(dirPath, { recursive: true });
            await fs.promises.writeFile(filePath, finalBuffer);

            // Construct URL
            const base = baseUrl ? baseUrl.replace(/\/$/, '') : PUBLIC_BASE_URL.replace(/\/$/, '');
            const relativeUrl = `/uploads/product-images/${encodeURIComponent(userFolder)}/${encodeURIComponent(fileName)}`;

            return `${base}${relativeUrl}`;
        }

    } catch (error) {
        console.error("[ImageService] Upload Failed:", error);
        throw error;
    }
}

module.exports = {
    uploadProductImage
};
