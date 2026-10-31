/**
 * VAIDYA BOTANICALS - Static Asset Sync Utility
 * Prepares the ./public directory for Cloudflare Workers Static Assets
 * Copies storefront, private login, and admin interface while preserving source files for server.js.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyFileSafe(src, dest) {
    if (fs.existsSync(src)) {
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
        console.log(`[Asset Sync]: Copied ${path.relative(ROOT_DIR, src)} -> ${path.relative(ROOT_DIR, dest)}`);
    }
}

function syncAssets() {
    console.log('[Asset Sync]: Preparing static assets in ./public for Cloudflare Workers...');
    ensureDir(PUBLIC_DIR);

    // 1. Storefront SPA
    copyFileSafe(path.join(ROOT_DIR, 'index.html'), path.join(PUBLIC_DIR, 'index.html'));

    // 2. Private Login Entrance
    copyFileSafe(path.join(ROOT_DIR, 'private-login.html'), path.join(PUBLIC_DIR, 'private-login.html'));

    // 3. Admin Management SPA
    copyFileSafe(path.join(ROOT_DIR, 'admin', 'index.html'), path.join(PUBLIC_DIR, 'admin', 'index.html'));

    console.log('[Asset Sync]: Static assets synchronization complete.');
}

if (require.main === module) {
    syncAssets();
}

module.exports = { syncAssets };

