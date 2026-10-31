/**
 * VAIDYA BOTANICALS: Cloudflare Hyperdrive Setup Script
 * Provisions a Cloudflare Hyperdrive configuration for Neon PostgreSQL
 * using the dedicated least-privilege vaidya_runtime role.
 *
 * Never prints or leaks database passwords or sensitive connection strings.
 */

require('dotenv').config({ path: '.env.local' });
const { spawnSync } = require('child_process');

function setupHyperdrive() {
    const connStr = process.env.DATABASE_URL_RUNTIME;
    if (!connStr) {
        console.error('ERROR: DATABASE_URL_RUNTIME not found in .env.local');
        process.exit(1);
    }

    const url = new URL(connStr);
    if (url.username !== 'vaidya_runtime') {
        console.error('SECURITY ERROR: Expected vaidya_runtime role, but found:', url.username);
        process.exit(1);
    }

    console.log('[Hyperdrive Setup]: Inspecting existing Cloudflare Hyperdrive configurations...');

    // 1. Check existing Hyperdrive configs
    const listRes = spawnSync('npx.cmd', ['wrangler', 'hyperdrive', 'list'], {
        encoding: 'utf8',
        shell: true
    });

    if (listRes.status !== 0) {
        console.error('[Hyperdrive Setup Error]:', listRes.stderr || listRes.stdout);
        process.exit(1);
    }

    // Check if vaidya-neon-hyperdrive exists
    const listOutput = listRes.stdout || '';
    const match = listOutput.match(/([a-f0-9]{32})/i) || listOutput.match(/([a-f0-9-]{36})/i);

    if (listOutput.includes('vaidya-neon-hyperdrive') && match) {
        console.log(`[Hyperdrive Setup]: Found existing Hyperdrive configuration: ${match[1]}`);
        return match[1];
    }

    console.log('[Hyperdrive Setup]: Creating Hyperdrive config "vaidya-neon-hyperdrive" with least-privilege vaidya_runtime...');

    // 2. Create Hyperdrive config
    const createRes = spawnSync('npx.cmd', [
        'wrangler', 'hyperdrive', 'create', 'vaidya-neon-hyperdrive',
        '--connection-string', connStr
    ], {
        encoding: 'utf8',
        shell: true
    });

    const createOutput = (createRes.stdout || '') + (createRes.stderr || '');
    if (createRes.status !== 0) {
        // Redact any password if present in error
        const sanitized = createOutput.replace(/:[^:@]+@/g, ':***@');
        console.error('[Hyperdrive Setup Failed]:', sanitized);
        process.exit(1);
    }

    // Extract ID
    const idMatch = createOutput.match(/id:\s*([a-f0-9]{32})/i) ||
                    createOutput.match(/id:\s*([a-f0-9-]{36})/i) ||
                    createOutput.match(/([a-f0-9]{32})/i) ||
                    createOutput.match(/([a-f0-9-]{36})/i);

    if (!idMatch) {
        const sanitized = createOutput.replace(/:[^:@]+@/g, ':***@');
        console.log('[Hyperdrive Output (Redacted)]:\n', sanitized);
        console.error('ERROR: Could not parse Hyperdrive ID from output');
        process.exit(1);
    }

    const hyperdriveId = idMatch[1];
    console.log(`[Hyperdrive Setup]: Successfully created Hyperdrive config!`);
    console.log(`[Hyperdrive Setup]: ID = ${hyperdriveId}`);
    return hyperdriveId;
}

if (require.main === module) {
    try {
        setupHyperdrive();
    } catch (e) {
        console.error('Fatal error:', e.message);
        process.exit(1);
    }
}

module.exports = setupHyperdrive;

