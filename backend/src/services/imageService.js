const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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
// For now, we want to prioritize S3/R2 over Supabase for migration
const PREFER_S3 = process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY;
const PREFER_SUPABASE = !PREFER_S3 && process.env.SUPABASE_BUCKET && process.env.SUPABASE_URL;

if (PREFER_S3) {
    console.log("[ImageService] Initializing S3 Client (R2/S3 Priority)...");
    s3Client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY
        },
        forcePathStyle: true
    });
}

// Configure Supabase Client (only if S3 is not available)
let supabase = null;
if (!s3Client && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
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

    if (s3Client && process.env.S3_BUCKET) {
        const key = `${folder}/${userFolder}/${fileName}`;
        const command = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: finalBuffer,
            ContentType: contentType
        });

        await s3Client.send(command);

        if (process.env.S3_PUBLIC_URL) {
            const publicUrlBase = process.env.S3_PUBLIC_URL.replace(/\/$/, '');
            return `${publicUrlBase}/${key}`;
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

function extractSupabaseKey(assetUrl) {
    if (!assetUrl || !process.env.SUPABASE_BUCKET) return null;

    try {
        const parsedUrl = new URL(String(assetUrl));
        const pathname = decodeURIComponent(parsedUrl.pathname || '');
        const bucket = process.env.SUPABASE_BUCKET.replace(/^\/+|\/+$/g, '');
        const match = pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
        if (!match) return null;
        if (match[1] !== bucket) return null;
        return match[2];
    } catch {
        return null;
    }
}

function extractS3Key(assetUrl) {
    if (!assetUrl || !process.env.S3_BUCKET) return null;

    try {
        const rawUrl = String(assetUrl);
        const publicBase = String(process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
        if (publicBase && rawUrl.startsWith(`${publicBase}/`)) {
            return decodeURIComponent(rawUrl.slice(publicBase.length + 1));
        }

        const parsedUrl = new URL(rawUrl);
        const pathname = decodeURIComponent(parsedUrl.pathname || '');
        const bucketPrefix = `/${String(process.env.S3_BUCKET).replace(/^\/+|\/+$/g, '')}/`;
        if (pathname.startsWith(bucketPrefix)) {
            return pathname.slice(bucketPrefix.length);
        }
    } catch {
        return null;
    }

    return null;
}

function extractLocalAssetPath(assetUrl) {
    if (!assetUrl) return null;

    const tryResolve = (pathname) => {
        const normalizedPath = decodeURIComponent(String(pathname || '').split('?')[0]);
        const imagePrefix = '/uploads/product-images/';
        const videoPrefix = '/uploads/product-videos/';

        if (normalizedPath.startsWith(imagePrefix)) {
            const relativeParts = normalizedPath.slice(imagePrefix.length).split('/').filter(Boolean);
            return path.join(IMAGE_UPLOAD_ROOT, ...relativeParts);
        }

        if (normalizedPath.startsWith(videoPrefix)) {
            const relativeParts = normalizedPath.slice(videoPrefix.length).split('/').filter(Boolean);
            return path.join(VIDEO_UPLOAD_ROOT, ...relativeParts);
        }

        return null;
    };

    try {
        return tryResolve(new URL(String(assetUrl)).pathname);
    } catch {
        return tryResolve(String(assetUrl));
    }
}

async function deleteProductAsset(assetUrl) {
    if (!assetUrl) return false;

    const supabaseKey = extractSupabaseKey(assetUrl);
    if (supabaseKey && supabase && process.env.SUPABASE_BUCKET) {
        const { error } = await supabase.storage.from(process.env.SUPABASE_BUCKET).remove([supabaseKey]);
        if (error) {
            console.error('[ImageService] Supabase Delete Error:', error);
            throw error;
        }
        return true;
    }

    const s3Key = extractS3Key(assetUrl);
    if (s3Key && s3Client && process.env.S3_BUCKET) {
        await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: s3Key
        }));
        return true;
    }

    const localFilePath = extractLocalAssetPath(assetUrl);
    if (localFilePath) {
        try {
            await fs.promises.unlink(localFilePath);
            return true;
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }

    return false;
}

async function deleteProductAssets(assetUrls = []) {
    const uniqueUrls = Array.from(new Set(
        (Array.isArray(assetUrls) ? assetUrls : [assetUrls])
            .map((assetUrl) => String(assetUrl || '').trim())
            .filter(Boolean)
    ));

    if (uniqueUrls.length === 0) {
        return { attempted: 0, deleted: 0 };
    }

    let deleted = 0;
    await Promise.all(uniqueUrls.map(async (assetUrl) => {
        try {
            const removed = await deleteProductAsset(assetUrl);
            if (removed) {
                deleted += 1;
            }
        } catch (error) {
            console.error(`[ImageService] Failed to delete asset ${assetUrl}:`, error.message || error);
        }
    }));

    return { attempted: uniqueUrls.length, deleted };
}

module.exports = {
    uploadProductImage,
    uploadProductVideo,
    deleteProductAssets
};
