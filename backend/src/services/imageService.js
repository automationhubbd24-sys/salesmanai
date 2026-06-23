const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');

// Configure S3 Client if env vars are present
console.log("[ImageService] Checking Storage Configuration...");
console.log("S3 Config:", {
    endpoint: process.env.S3_ENDPOINT ? 'Set' : 'Not Set',
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY ? 'Set' : 'Not Set'
});
console.log("Supabase Config:", {
    url: process.env.SUPABASE_URL ? 'Set' : 'Not Set',
    bucket: process.env.SUPABASE_BUCKET,
    key: process.env.SUPABASE_KEY ? 'Set' : 'Not Set'
});

let s3Client = null;
// Only enable S3 if Supabase is NOT the intended primary, or if we want S3 specifically.
// For now, if Supabase Bucket is set, we PREFER Supabase to fix the user's issue.
const PREFER_SUPABASE = process.env.SUPABASE_BUCKET && process.env.SUPABASE_URL;

if (!PREFER_SUPABASE && process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
    console.log("[ImageService] Initializing S3 Client...");
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

// Configure Supabase Client (if S3 is not available or Supabase is preferred)
let supabase = null;
if ((!s3Client || PREFER_SUPABASE) && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    console.log("[ImageService] Initializing Supabase Client...");
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const IMAGE_UPLOAD_ROOT = process.env.IMAGE_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'product-images');
const VIDEO_UPLOAD_ROOT = process.env.VIDEO_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'product-videos');

function getExtensionFromMimeType(mimeType, fallback = 'bin') {
    const map = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
        'video/x-matroska': 'mkv'
    };
    return map[mimeType] || fallback;
}

function buildUniqueAssetName(extension) {
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${randomSuffix}.${extension}`;
}

async function uploadProductAsset(finalBuffer, contentType, userId, baseUrl, options = {}) {
    const {
        folder = 'product-images',
        uploadRoot = IMAGE_UPLOAD_ROOT,
        extension = getExtensionFromMimeType(contentType)
    } = options;

    const userFolder = String(userId || 'anonymous');
    const fileName = buildUniqueAssetName(extension);

    if (s3Client && process.env.S3_BUCKET && !process.env.SUPABASE_BUCKET) {
        const key = `${folder}/${userFolder}/${fileName}`;
        const command = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: finalBuffer,
            ContentType: contentType
        });

        await s3Client.send(command);

        if (process.env.S3_PUBLIC_URL) {
            return `${process.env.S3_PUBLIC_URL}/${key}`;
        }

        const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, '');
        return `${endpoint}/${process.env.S3_BUCKET}/${key}`;
    }

    if (supabase && process.env.SUPABASE_BUCKET) {
        const key = `${folder}/${userFolder}/${fileName}`;
        const { error } = await supabase.storage
            .from(process.env.SUPABASE_BUCKET)
            .upload(key, finalBuffer, {
                contentType,
                upsert: true
            });

        if (error) {
            console.error("[ImageService] Supabase Upload Error:", error);
            throw error;
        }

        const { data: publicUrlData } = supabase.storage
            .from(process.env.SUPABASE_BUCKET)
            .getPublicUrl(key);

        return publicUrlData.publicUrl;
    }

    const dirPath = path.join(uploadRoot, userFolder);
    const filePath = path.join(dirPath, fileName);

    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(filePath, finalBuffer);

    const base = baseUrl ? baseUrl.replace(/\/$/, '') : PUBLIC_BASE_URL.replace(/\/$/, '');
    const relativeUrl = `/uploads/${folder}/${encodeURIComponent(userFolder)}/${encodeURIComponent(fileName)}`;

    return `${base}${relativeUrl}`;
}

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

        return await uploadProductAsset(finalBuffer, contentType, userId, baseUrl, {
            folder: 'product-images',
            uploadRoot: IMAGE_UPLOAD_ROOT,
            extension
        });

    } catch (error) {
        console.error("[ImageService] Upload Failed:", error);
        throw error;
    }
}

async function uploadProductVideo(fileBuffer, mimeType, userId, baseUrl) {
    try {
        return await uploadProductAsset(fileBuffer, mimeType, userId, baseUrl, {
            folder: 'product-videos',
            uploadRoot: VIDEO_UPLOAD_ROOT,
            extension: getExtensionFromMimeType(mimeType, 'mp4')
        });
    } catch (error) {
        console.error("[ImageService] Video Upload Failed:", error);
        throw error;
    }
}

module.exports = {
    uploadProductImage,
    uploadProductVideo
};
