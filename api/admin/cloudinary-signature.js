/**
 * VAIDYA BOTANICALS - Cloudinary Signed Upload Signature Generator
 * Generates official Cloudinary SHA-256 upload signatures for administrator image uploads.
 * Supported in both Cloudflare Workers (Web Crypto) and standard Node.js runtimes.
 */

const { verifyAdmin, logAdminAction } = require('../../lib/auth');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Calculates a Cloudinary SHA-256 signature according to Cloudinary's official specification:
 * - Sort parameter names alphabetically
 * - Join key=value pairs with '&'
 * - Append api_secret without delimiter
 * - Compute SHA-256 hex digest
 */
async function generateCloudinarySignature(params, apiSecret) {
    if (!apiSecret) {
        throw new Error('Cloudinary API secret is required to generate signature');
    }
    const keys = Object.keys(params).sort();
    const serialized = keys.map(k => `${k}=${params[k]}`).join('&');
    const stringToSign = serialized + apiSecret;

    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
        const enc = new TextEncoder();
        const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(stringToSign));
        return Array.from(new Uint8Array(hashBuf))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } else {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(stringToSign).digest('hex');
    }
}

module.exports = async function handler(req, res) {
    // 1. Verify administrator authentication
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const env = req.env || process.env;
        const cloudName = env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME || '';
        const apiKey = env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY || '';
        const apiSecret = env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET || '';

        // Optional pre-validation on file metadata if provided
        const { filename, mimeType, size } = req.body || {};

        if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
            return res.status(400).json({
                error: `Unsupported image format: ${mimeType}. Allowed formats: JPG, PNG, WebP, AVIF.`
            });
        }

        if (size && Number(size) > MAX_FILE_SIZE_BYTES) {
            return res.status(400).json({
                error: `File size exceeds 5MB limit (${(Number(size) / (1024 * 1024)).toFixed(2)} MB)`
            });
        }

        if (filename) {
            const lower = filename.toLowerCase();
            const hasValidExt = ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext));
            if (!hasValidExt) {
                return res.status(400).json({
                    error: `Invalid file extension for "${filename}". Allowed: .jpg, .jpeg, .png, .webp, .avif`
                });
            }
        }

        if (!cloudName || !apiKey || !apiSecret) {
            return res.status(503).json({
                error: 'Cloudinary storage is not configured',
                message: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set.'
            });
        }

        // 2. Fixed destination folder and unique public ID
        const folder = 'vaidya/products';
        const timestamp = Math.floor(Date.now() / 1000);
        let randomSuffix = '';
        if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
            randomSuffix = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
        } else {
            const crypto = require('crypto');
            randomSuffix = crypto.randomBytes(6).toString('hex');
        }
        const public_id = `prod_${Date.now()}_${randomSuffix}`;

        // 3. Prepare signable parameters (strictly sorted and whitelisted)
        const signParams = {
            folder,
            public_id,
            timestamp
        };

        // 4. Generate SHA-256 signature
        const signature = await generateCloudinarySignature(signParams, apiSecret);

        // 5. Audit log
        await logAdminAction(admin.email, 'GENERATE_CLOUDINARY_SIGNATURE', 'storage', 'cloudinary', {
            folder,
            public_id,
            timestamp
        });

        // 6. Return only permitted public parameters - NEVER expose apiSecret!
        return res.status(200).json({
            success: true,
            cloudName,
            apiKey,
            timestamp,
            signature,
            folder,
            public_id
        });
    } catch (err) {
        console.error('[Cloudinary Signature Error]:', err);
        return res.status(500).json({
            error: 'Failed to generate Cloudinary upload signature',
            message: err.message
        });
    }
};

module.exports.generateCloudinarySignature = generateCloudinarySignature;

