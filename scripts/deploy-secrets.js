/**
 * VAIDYA BOTANICALS: Secure Worker Secret Deployment Script
 * Pushes required production/staging secrets from .env.local to Cloudflare Workers
 * using wrangler secret bulk over stdin.
 *
 * Never prints or leaks secrets in stdout or stderr.
 */

require('dotenv').config({ path: '.env.local' });
const { spawnSync } = require('child_process');

function deploySecrets() {
    console.log('[Secret Deployment]: Preparing secrets for vaidya-botanicals-staging...');

    const secrets = {};
    if (process.env.ADMIN_JWT_SECRET) secrets.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
    if (process.env.ADMIN_PROFILE_ID) secrets.ADMIN_PROFILE_ID = process.env.ADMIN_PROFILE_ID;
    if (process.env.ADMIN_PHONE_E164) secrets.ADMIN_PHONE_E164 = process.env.ADMIN_PHONE_E164;
    if (process.env.CLOUDINARY_API_SECRET) secrets.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
    if (process.env.TWOFACTOR_API_KEY) secrets.TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;

    const secretKeys = Object.keys(secrets);
    console.log(`[Secret Deployment]: Identified ${secretKeys.length} secrets: ${secretKeys.join(', ')}`);

    const jsonPayload = JSON.stringify(secrets);

    const res = spawnSync('npx.cmd', ['wrangler', 'secret', 'bulk'], {
        input: jsonPayload,
        encoding: 'utf8',
        shell: true
    });

    if (res.status !== 0) {
        console.error('[Secret Deployment Failed]:', res.stderr || res.stdout);
        process.exit(1);
    }

    console.log('[Secret Deployment]: Successfully deployed secrets to Cloudflare Workers!');
}

if (require.main === module) {
    deploySecrets();
}

module.exports = deploySecrets;

