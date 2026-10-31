/**
 * VAIDYA BOTANICALS - Cloudflare Workers Architecture Verification Suite
 * Verifies edge worker entrypoint, stealth admin gating, API routing,
 * R2 uploads, Hyperdrive lifecycle, and cryptographic compatibility.
 */

process.env.NODE_ENV = 'test';
process.env.STYTCH_TEST_MODE = 'true';
// Store original DB URLs for offline mock testing vs Hyperdrive integration
const originalDbUrl = process.env.DATABASE_URL;
const originalDbUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
process.env.DATABASE_URL = '';
process.env.DATABASE_URL_UNPOOLED = '';

const assert = require('assert');
function loadWorker() {
    const fs = require('fs');
    const path = require('path');
    const Module = require('module');
    const filename = path.resolve(__dirname, '../src/worker.js');
    const code = fs.readFileSync(filename, 'utf8').replace(/export\s+default\s+/, 'module.exports = ');
    const m = new Module(filename, module);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename));
    m._compile(code, filename);
    return m.exports;
}
const workerModule = loadWorker();
const { createAdminToken, createAdminCookie, hashPassword, verifyPassword, verifyPasswordAsync } = require('../lib/auth');
const { setWorkerEnv, getWorkerEnv, isDatabaseConfigured } = require('../lib/db');

let passedTests = 0;
let totalTests = 0;

function it(description, fn) {
    totalTests++;
    return Promise.resolve()
        .then(() => fn())
        .then(() => {
            passedTests++;
            console.log(`  ✓ ${description}`);
        })
        .catch((err) => {
            console.error(`  ✗ ${description}`);
            console.error(`    ${err.message}`);
            throw err;
        });
}

// Mock ASSETS binding
function createMockAssets() {
    return {
        async fetch(request) {
            const url = new URL(request.url);
            return new Response(`[Static Asset: ${url.pathname}]`, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
    };
}

// Mock R2 Bucket binding
function createMockR2Bucket() {
    const store = new Map();
    return {
        async put(key, value, options) {
            store.set(key, { value, options });
            return {
                key,
                size: value.length,
                etag: 'mock-etag-' + Date.now(),
                httpMetadata: options?.httpMetadata
            };
        },
        async get(key) {
            const item = store.get(key);
            if (!item) return null;
            return {
                key,
                value: item.value,
                httpMetadata: item.options?.httpMetadata
            };
        },
        _store: store
    };
}

async function runWorkerSuite() {
    console.log('\n======================================================');
    console.log('CLOUDFLARE WORKERS ARCHITECTURE VERIFICATION');
    console.log('======================================================\n');

    // 1. Worker Entrypoint Structure
    console.log('--- 1. Worker Module Contract ---');
    await it('exports a valid default fetch handler', () => {
        assert.ok(workerModule, 'Worker module should be defined');
        assert.strictEqual(typeof workerModule.fetch, 'function', 'Worker fetch must be a function');
    });

    // 2. Admin Stealth Gate Verification
    console.log('\n--- 2. Direct Admin Stealth Protection ---');
    await it('returns HTTP 404 for anonymous access to /admin', async () => {
        const req = new Request('https://vaidyabotanicals.com/admin', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 404, 'Must return 404 for unauthenticated visitor');
        const text = await res.text();
        assert.strictEqual(text, '404 Not Found');
    });

    await it('returns HTTP 404 for anonymous access to /admin/', async () => {
        const req = new Request('https://vaidyabotanicals.com/admin/', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 404, 'Must return 404 for unauthenticated visitor');
    });

    await it('returns HTTP 404 for direct access to /admin/index.html', async () => {
        const req = new Request('https://vaidyabotanicals.com/admin/index.html', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 404, 'Direct /admin/index.html must return 404 for anonymous users');
    });

    await it('serves admin/index.html for authenticated admin visiting /admin', async () => {
        const adminToken = createAdminToken({ email: 'admin@vaidyabotanicals.com', role: 'admin' });
        const adminCookie = createAdminCookie(adminToken);
        const cookieHeader = adminCookie.split(';')[0]; // Extract vaidya_admin_token=...

        const req = new Request('https://vaidyabotanicals.com/admin', {
            method: 'GET',
            headers: {
                'Cookie': cookieHeader
            }
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200, 'Authenticated admin must be granted access');
        const text = await res.text();
        assert.ok(text.includes('/admin/index.html'), 'Should serve /admin/index.html via ASSETS');
    });

    // 3. Selective API Routing
    console.log('\n--- 3. Edge API Dispatching & Routing ---');
    await it('routes GET /api/products and returns catalogue', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/products', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        assert.ok(res.headers.get('content-type')?.includes('application/json'));
        const data = await res.json();
        assert.ok(data.products || Array.isArray(data), 'Products API must return product data');
    });

    await it('routes POST /api/auth/otp-send and validates email', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/auth/otp-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: '' })
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.ok(data.error, 'Must return error on empty email');
    });

    await it('routes POST /api/auth/otp-send with valid email in test mode', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/auth/otp-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'customer-test@vaidyabotanicals.com' })
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.method_id || data.methodId, 'Must return OTP methodId');
    });

    await it('returns JSON 404 for undefined API routes', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/non-existent-endpoint', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 404);
        const data = await res.json();
        assert.strictEqual(data.error, 'Endpoint not found');
    });

    // 4. Cloudinary & Admin Phone OTP Edge Routing (R2 Excluded, Cloudinary Active)
    console.log('\n--- 4. Cloudinary Signature & Admin Phone OTP Edge Routing ---');
    await it('generates Cloudinary upload signature via Worker when authenticated as admin', async () => {
        const adminToken = createAdminToken({ email: 'admin@vaidyabotanicals.com', role: 'admin' });
        const cookieHeader = createAdminCookie(adminToken).split(';')[0];

        const req = new Request('https://vaidyabotanicals.com/api/admin/cloudinary-signature', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieHeader
            },
            body: JSON.stringify({
                filename: 'ashwagandha-pure.jpg',
                mimeType: 'image/jpeg',
                size: 1024 * 1024
            })
        });

        const env = {
            ASSETS: createMockAssets(),
            CLOUDINARY_CLOUD_NAME: 'vaidya-botanicals-test',
            CLOUDINARY_API_KEY: 'test_key_123',
            CLOUDINARY_API_SECRET: 'test_secret_456'
        };

        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.folder, 'vaidya/products');
        assert.ok(data.signature, 'Signature must be returned');
        assert.ok(data.public_id, 'Public ID must be returned');
        assert.strictEqual(data.apiSecret, undefined, 'API secret must not be exposed');
    });

    await it('routes POST /api/auth/admin-otp/send and issues OTP challenge on Edge', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/auth/admin-otp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const env = {
            ASSETS: createMockAssets(),
            ADMIN_PHONE_E164: '+919821522443',
            ADMIN_PROFILE_ID: 'admin_a815af4fa9d20017d31f864c'
        };

        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.challenge_id, 'Admin challenge_id must be generated');
    });

    await it('confirms POST /api/auth/admin-login is NOT routed on Edge (Zero PBKDF2 on Worker)', async () => {
        const req = new Request('https://vaidyabotanicals.com/api/auth/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@vaidyabotanicals.com', password: 'AnyPassword!' })
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 404, 'Legacy PBKDF2 login must not be exposed on edge Worker');
    });

    // 5. Hyperdrive Integration & DB Abstraction
    console.log('\n--- 5. Hyperdrive DB Lifecycle & Dynamic Routing ---');
    await it('setWorkerEnv correctly registers worker environment', () => {
        const mockEnv = {
            HYPERDRIVE: {
                connectionString: 'postgresql://vaidya_runtime:testpass@mock.hyperdrive.cloudflare.com:5432/vaidyadb'
            }
        };
        setWorkerEnv(mockEnv);
        assert.strictEqual(getWorkerEnv(), mockEnv);
        assert.strictEqual(isDatabaseConfigured(), true, 'isDatabaseConfigured must return true when Hyperdrive binding exists');

        // Reset worker env for other tests
        setWorkerEnv(null);
    });

    // 6. Cryptographic Password Verification
    console.log('\n--- 6. PBKDF2/SHA-512 Cryptographic Verification ---');
    await it('verifyPasswordAsync matches verifyPassword with 100k iterations', async () => {
        const testPassword = 'SecureAdminPassword2026!';
        const storedHash = hashPassword(testPassword);

        // Synchronous check
        const syncMatch = verifyPassword(testPassword, storedHash);
        assert.strictEqual(syncMatch, true, 'Synchronous verifyPassword must succeed');

        // Asynchronous subtle/sync check
        const asyncMatch = await verifyPasswordAsync(testPassword, storedHash);
        assert.strictEqual(asyncMatch, true, 'verifyPasswordAsync must succeed');

        // Wrong password check
        const wrongMatch = await verifyPasswordAsync('WrongPassword123!', storedHash);
        assert.strictEqual(wrongMatch, false, 'verifyPasswordAsync must reject incorrect password');
    });

    // 7. Storefront Static Asset Passthrough
    console.log('\n--- 7. Storefront & Static Assets Passthrough ---');
    await it('passes storefront requests through to ASSETS binding', async () => {
        const req = new Request('https://vaidyabotanicals.com/', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('[Static Asset: /]'), 'Storefront root must be handled by static assets');
    });

    await it('passes private-login.html through to ASSETS binding', async () => {
        const req = new Request('https://vaidyabotanicals.com/private-login.html', {
            method: 'GET'
        });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('[Static Asset: /private-login.html]'), 'private-login.html must be served directly');
    });

    // 8. Staging Environment Protection (noindex)
    console.log('\n--- 8. Staging Search Engine Protection ---');
    await it('enforces X-Robots-Tag: noindex, nofollow on all staging responses', async () => {
        const req = new Request('https://vaidyabotanicals.com/', { method: 'GET' });
        const env = { ASSETS: createMockAssets() };
        const res = await workerModule.fetch(req, env, {});
        assert.strictEqual(res.headers.get('X-Robots-Tag'), 'noindex, nofollow', 'Staging responses must enforce noindex, nofollow');
    });

    console.log('\n======================================================');
    console.log(`WORKER VERIFICATION COMPLETE: ${passedTests}/${totalTests} PASSED`);
    console.log('======================================================\n');
}

runWorkerSuite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
