const fs = require('fs');
const path = require('path');
const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isSupabaseConfigured, getSupabaseAdmin } = require('../../lib/supabase');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

module.exports = async function handler(req, res) {
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { filename, mimeType, base64Data, bucketType } = req.body || {};

        if (!filename || !mimeType || !base64Data) {
            return res.status(400).json({ error: 'filename, mimeType, and base64Data are required' });
        }

        if (!ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
            return res.status(400).json({
                error: `Invalid file type: ${mimeType}. Allowed: JPEG, PNG, WebP, SVG`
            });
        }

        // Clean base64 data header if present
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
            return res.status(400).json({
                error: `File size exceeds 5MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`
            });
        }

        const ext = path.extname(filename) || '.jpg';
        const sanitizedBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const uniqueFilename = `${Date.now()}-${sanitizedBase}${ext}`;
        const targetBucket = bucketType === 'private' ? 'vaidya-support-attachments' : 'vaidya-public-assets';

        // 1. Cloudflare R2 Storage (Workers runtime)
        const r2Bucket = bucketType === 'private' ? req.env?.PRIVATE_ASSETS_BUCKET : req.env?.PUBLIC_ASSETS_BUCKET;
        if (r2Bucket) {
            const storagePath = `products/${uniqueFilename}`;
            await r2Bucket.put(storagePath, buffer, {
                httpMetadata: {
                    contentType: mimeType
                }
            });

            const publicBase = req.env?.R2_PUBLIC_URL_BASE || process.env.R2_PUBLIC_URL_BASE || 'https://assets.vaidyabotanicals.com';
            const fileUrl = bucketType === 'private'
                ? `/api/admin/download?key=${encodeURIComponent(storagePath)}`
                : `${publicBase}/${storagePath}`;

            await logAdminAction(admin.email, 'UPLOAD_IMAGE_R2', 'storage', targetBucket, { filename: uniqueFilename, storagePath });

            return res.status(200).json({
                success: true,
                url: fileUrl,
                storagePath,
                filename: uniqueFilename,
                size: buffer.length,
                mimeType
            });
        }

        // 2. Supabase Storage (Legacy / External)
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseAdmin();
            const storagePath = `products/${uniqueFilename}`;

            const { data, error } = await supabase.storage
                .from(targetBucket)
                .upload(storagePath, buffer, {
                    contentType: mimeType,
                    upsert: true
                });

            if (error) throw error;

            let fileUrl = '';
            if (bucketType === 'private') {
                // Short-lived signed URL for private attachments
                const { data: signedData } = await supabase.storage
                    .from(targetBucket)
                    .createSignedUrl(storagePath, 3600); // 1 hour validity
                fileUrl = signedData?.signedUrl || '';
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from(targetBucket)
                    .getPublicUrl(storagePath);
                fileUrl = publicUrlData.publicUrl;
            }

            await logAdminAction(admin.email, 'UPLOAD_IMAGE', 'storage', targetBucket, { filename: uniqueFilename });

            return res.status(200).json({
                success: true,
                url: fileUrl,
                storagePath,
                filename: uniqueFilename,
                size: buffer.length,
                mimeType
            });
        } else {
            // 3. Local dev fallback (Node.js filesystem)
            if (typeof __dirname === 'undefined') {
                return res.status(500).json({
                    error: 'Storage unavailable',
                    message: 'Neither R2 nor local filesystem storage is available in this runtime environment.'
                });
            }
            const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
            if (fs && fs.existsSync && !fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            const localPath = path.join(uploadsDir, uniqueFilename);
            if (fs && fs.writeFileSync) {
                fs.writeFileSync(localPath, buffer);
            }

            const fileUrl = `/uploads/${uniqueFilename}`;
            await logAdminAction(admin.email, 'UPLOAD_IMAGE_LOCAL', 'storage', 'local', { filename: uniqueFilename });

            return res.status(200).json({
                success: true,
                url: fileUrl,
                filename: uniqueFilename,
                size: buffer.length,
                mimeType
            });
        }
    } catch (err) {
        console.error('[Admin Upload Error]:', err);
        return res.status(500).json({ error: err.message || 'Image upload failed' });
    }
};
