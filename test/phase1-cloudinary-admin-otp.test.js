/**
 * VAIDYA BOTANICALS - Phase 1 & 2 Verification Suite
 * Tests:
 * 1. Cloudinary official signed upload signature generation, parameter sorting, secret protection,
 *    admin gating, file format and size limits, and Neon persistence.
 * 2. Passwordless Administrator Phone OTP authentication, single-identity restrictions, rate limiting,
 *    replay prevention, cross-purpose challenge isolation (admin vs customer), 8-hour session cookies,
 *    and removal of PBKDF2 from the Cloudflare Worker login path.
 */

process.env.NODE_ENV = 'test';
process.env.PHONE_VERIFICATION_TEST_MODE = 'true';
process.env.CLOUDINARY_CLOUD_NAME = 'vaidya-botanicals-test';
process.env.CLOUDINARY_API_KEY = 'test_key_123456';
process.env.CLOUDINARY_API_SECRET = 'test_secret_abcdef987654';
process.env.ADMIN_JWT_SECRET = 'test_jwt_secret_vaidya_phase1_2026';
process.env.ADMIN_PROFILE_ID = 'admin_a815af4fa9d20017d31f864c';
process.env.ADMIN_PHONE_E164 = '+919821522443';

const http = require('http');
const assert = require('assert');
const crypto = require('crypto');
const server = require('../server');
const { createAdminToken, createAdminCookie, verifyAdmin } = require('../lib/auth');
const { generateCloudinarySignature } = require('../api/admin/cloudinary-signature');
const { mockVerificationStore } = require('../lib/phone-verification');
const { isDatabaseConfigured, query } = require('../lib/db');

const PORT = 3893;
let adminCookie = '';

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({ port: PORT, host: '127.0.0.1', ...options }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch (e) {
                    json = null;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data,
                    json
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'object' ? JSON.stringify(postData) : postData);
        }
        req.end();
    });
}

async function runTests() {
    console.log('\n================================================================');
    console.log('  VAIDYA BOTANICALS: CLOUDINARY + ADMIN PHONE OTP TEST SUITE    ');
    console.log('================================================================\n');

    await new Promise(r => server.listen(PORT, r));
    console.log(`[Test Server] Running on http://127.0.0.1:${PORT}\n`);

    // Clean test records before starting tests
    if (isDatabaseConfigured()) {
        try {
            await query("DELETE FROM public.phone_verifications WHERE phone = '9821522443'");
        } catch (e) {}
    } else {
        mockVerificationStore.clear();
    }

    const adminUser = {
        id: process.env.ADMIN_PROFILE_ID,
        email: 'admin@vaidyabotanicals.com',
        role: 'admin'
    };
    const adminToken = createAdminToken(adminUser);
    adminCookie = createAdminCookie(adminToken);

    try {
        // =====================================================================
        // SECTION 1: CLOUDINARY INTEGRATION TESTS
        // =====================================================================
        console.log('--- SECTION 1: CLOUDINARY INTEGRATION TESTS ---');

        // 1. Signature calculation & parameter sorting
        console.log('[Test 1.1] Verifying Cloudinary signature generation and alphabetical parameter sorting...');
        const testParams = {
            folder: 'vaidya/products',
            public_id: 'sample_product_123',
            timestamp: 1730000000
        };
        const expectedStringToSign = 'folder=vaidya/products&public_id=sample_product_123&timestamp=1730000000test_secret_abcdef987654';
        const expectedHash = crypto.createHash('sha256').update(expectedStringToSign).digest('hex');
        const computedSig = await generateCloudinarySignature(testParams, process.env.CLOUDINARY_API_SECRET);
        assert.strictEqual(computedSig, expectedHash, 'Cloudinary signature must match exact SHA-256 specification');
        console.log(' PASS: Cloudinary SHA-256 signature calculated accurately with sorted parameters.');

        // 2. Unauthenticated signature request blocked
        console.log('[Test 1.2] Verifying unauthenticated request to /api/admin/cloudinary-signature returns 404...');
        const unauthRes = await request({
            path: '/api/admin/cloudinary-signature',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { filename: 'test.png', mimeType: 'image/png' });
        assert.strictEqual(unauthRes.statusCode, 404, 'Anonymous caller must receive stealth 404');
        console.log(' PASS: Unauthenticated signature request received stealth 404.');

        // 3. Authenticated signature request succeeds
        console.log('[Test 1.3] Verifying authenticated admin can obtain signed upload parameters...');
        const authRes = await request({
            path: '/api/admin/cloudinary-signature',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': adminCookie
            }
        }, { filename: 'ashwagandha-pure.jpg', mimeType: 'image/jpeg', size: 1024 * 1024 });
        assert.strictEqual(authRes.statusCode, 200, 'Admin signature request must return 200');
        assert.strictEqual(authRes.json.success, true);
        assert.strictEqual(authRes.json.cloudName, process.env.CLOUDINARY_CLOUD_NAME);
        assert.strictEqual(authRes.json.apiKey, process.env.CLOUDINARY_API_KEY);
        assert.strictEqual(authRes.json.folder, 'vaidya/products');
        assert.ok(authRes.json.signature, 'Signature must be returned');
        assert.ok(authRes.json.public_id, 'Public ID must be generated');
        assert.ok(authRes.json.timestamp, 'Timestamp must be generated');
        console.log(' PASS: Signed parameters generated for folder "vaidya/products".');

        // 4. API Secret is NEVER returned in response
        console.log('[Test 1.4] Verifying CLOUDINARY_API_SECRET is never exposed in API response...');
        assert.strictEqual(authRes.json.apiSecret, undefined, 'API secret must never be in response object');
        assert.strictEqual(authRes.body.includes(process.env.CLOUDINARY_API_SECRET), false, 'API secret string must never appear in response body');
        console.log(' PASS: Cloudinary API secret is strictly shielded and never transmitted.');

        // 5. File format restrictions
        console.log('[Test 1.5] Verifying disallowed file format (e.g. PHP script) is rejected with 400...');
        const badExtRes = await request({
            path: '/api/admin/cloudinary-signature',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': adminCookie
            }
        }, { filename: 'exploit.php', mimeType: 'application/x-php' });
        assert.strictEqual(badExtRes.statusCode, 400, 'Non-image format must be rejected with 400');
        console.log(' PASS: Malicious or non-image MIME types strictly rejected.');

        // 6. File size restrictions
        console.log('[Test 1.6] Verifying oversized file (> 5 MB) is rejected with 400...');
        const oversizeRes = await request({
            path: '/api/admin/cloudinary-signature',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': adminCookie
            }
        }, { filename: 'large-photo.jpg', mimeType: 'image/jpeg', size: 6 * 1024 * 1024 });
        assert.strictEqual(oversizeRes.statusCode, 400, 'Files over 5 MB must be rejected');
        console.log(' PASS: Files exceeding 5 MB limit correctly rejected.');

        // 7. Saving Cloudinary secure URL to Neon database
        console.log('[Test 1.7] Verifying Cloudinary secure URL can be saved to a product and appears in catalog...');
        const testCloudinaryUrl = 'https://res.cloudinary.com/vaidya-botanicals-test/image/upload/v1730000000/vaidya/products/test_botanical_pure.jpg';
        const createProdRes = await request({
            path: '/api/admin/products',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': adminCookie
            }
        }, {
            name: 'Brahmi Focus Elixir',
            slug: 'brahmi-focus-elixir-' + Date.now(),
            category: 'elixir',
            health_segment: 'Cognitive Health',
            price: 36.00,
            stock: 40,
            unit: '/ 50ml',
            is_published: true,
            images: [
                { url: testCloudinaryUrl, alt: 'Brahmi Focus Elixir', is_primary: true }
            ]
        });
        assert.strictEqual(createProdRes.statusCode, 201, 'Product with Cloudinary image must be created');
        const createdProdId = createProdRes.json.product.id;

        // Verify public catalogue serves the Cloudinary URL
        const pubCatRes = await request({ path: '/api/products', method: 'GET' });
        assert.strictEqual(pubCatRes.statusCode, 200);
        const savedProd = pubCatRes.json.products.find(p => p.id === createdProdId);
        assert.ok(savedProd, 'Created product must be in public catalog');
        const hasCloudinaryImg = savedProd.images.some(i => i.url === testCloudinaryUrl);
        assert.ok(hasCloudinaryImg, 'Cloudinary secure URL must be present in public catalog');
        console.log(' PASS: Cloudinary secure URL successfully saved to database and served to public storefront.');

        // Clean up created test product
        if (isDatabaseConfigured()) {
            await query('DELETE FROM public.products WHERE id = $1', [createdProdId]);
        }

        // =====================================================================
        // SECTION 2: ADMINISTRATOR PHONE OTP AUTHENTICATION TESTS
        // =====================================================================
        console.log('\n--- SECTION 2: ADMINISTRATOR PHONE OTP TESTS ---');

        // 1. Configured administrator can request OTP
        console.log('[Test 2.1] Requesting administrator phone OTP via POST /api/auth/admin-otp/send...');
        const adminSendRes = await request({
            path: '/api/auth/admin-otp/send',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {});
        assert.strictEqual(adminSendRes.statusCode, 200, 'Admin OTP send must succeed');
        assert.strictEqual(adminSendRes.json.success, true);
        assert.ok(adminSendRes.json.challenge_id, 'Challenge ID must be issued');
        const adminChallengeId = adminSendRes.json.challenge_id;
        console.log(` PASS: Administrator OTP challenge generated: ${adminChallengeId}`);

        // 2. Arbitrary phone number from browser is strictly ignored
        console.log('[Test 2.2] Verifying arbitrary phone number in browser request is strictly ignored...');
        // Clean rate limit record from previous test to test tamper resistance
        if (isDatabaseConfigured()) {
            await query("DELETE FROM public.phone_verifications WHERE purpose = 'admin_auth'");
        } else {
            mockVerificationStore.clear();
        }
        const tamperRes = await request({
            path: '/api/auth/admin-otp/send',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { phone: '9999999999' }); // Attacker tries to hijack destination
        assert.strictEqual(tamperRes.statusCode, 200);
        // The masked phone returned must match the CONFIGURED admin phone, not 9999999999!
        assert.ok(tamperRes.json.masked_phone.includes('443') || tamperRes.json.masked_phone.includes('21'), 'Must send to configured admin phone');
        const activeAdminChallengeId = tamperRes.json.challenge_id;
        console.log(' PASS: Arbitrary client-provided phone numbers are completely ignored.');

        // 3. Rate limiting cooldown (60 seconds)
        console.log('[Test 2.3] Verifying 60-second cooldown rate limit on immediate admin OTP resend...');
        const rapidRes = await request({
            path: '/api/auth/admin-otp/send',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {});
        assert.strictEqual(rapidRes.statusCode, 429, 'Immediate resend must be rate limited with 429');
        assert.ok(rapidRes.json.error.includes('seconds'), 'Error must specify cooldown');
        console.log(' PASS: Rapid admin OTP resend strictly prevented by database-backed cooldown.');

        // 4. Invalid OTP code rejected
        console.log('[Test 2.4] Verifying incorrect OTP code is rejected...');
        const wrongOtpRes = await request({
            path: '/api/auth/admin-otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: activeAdminChallengeId, otp: '000000' });
        assert.strictEqual(wrongOtpRes.statusCode, 400, 'Wrong OTP must be rejected with 400');
        console.log(' PASS: Incorrect verification code rejected.');

        // 5. Cross-boundary security: Customer OTP cannot authenticate an administrator
        console.log('[Test 2.5] Testing cross-boundary isolation: Customer checkout challenge CANNOT authenticate administrator...');
        // Create a customer checkout challenge
        const custSendRes = await request({
            path: '/api/checkout/otp/send',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { phone: '9821522443' });
        assert.strictEqual(custSendRes.statusCode, 200);
        const customerChallengeId = custSendRes.json.challenge_id;

        // Attempt to pass customer challenge to admin verify endpoint
        const crossAdminRes = await request({
            path: '/api/auth/admin-otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: customerChallengeId, otp: '123456' });
        assert.strictEqual(crossAdminRes.statusCode, 400, 'Customer challenge must be rejected on admin verify');
        assert.ok(crossAdminRes.json.error.toLowerCase().includes('invalid') || crossAdminRes.json.error.toLowerCase().includes('session'));
        console.log(' PASS: Customer checkout challenge strictly rejected by administrator authentication.');

        // 6. Cross-boundary security: Admin OTP cannot validate a customer checkout
        console.log('[Test 2.6] Testing cross-boundary isolation: Admin OTP challenge CANNOT validate a customer checkout...');
        const crossCustRes = await request({
            path: '/api/checkout/otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: activeAdminChallengeId, otp: '123456', phone: '9821522443' });
        assert.strictEqual(crossCustRes.statusCode, 400, 'Admin challenge must be rejected on customer checkout verify');
        console.log(' PASS: Administrator OTP challenge strictly rejected by customer checkout.');

        // 7. Successful OTP verification grants an admin session
        console.log('[Test 2.7] Verifying successful administrator phone OTP verification...');
        const verifySuccessRes = await request({
            path: '/api/auth/admin-otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: activeAdminChallengeId, otp: '123456' });
        assert.strictEqual(verifySuccessRes.statusCode, 200, 'Valid admin OTP must return 200');
        assert.strictEqual(verifySuccessRes.json.success, true);
        assert.strictEqual(verifySuccessRes.json.user.role, 'admin');

        // Verify Set-Cookie header contains vaidya_admin_token with 8-hour Max-Age
        const setCookieHeader = verifySuccessRes.headers['set-cookie'];
        assert.ok(setCookieHeader, 'Set-Cookie header must be present');
        const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
        assert.ok(cookieStr.includes('vaidya_admin_token='), 'Cookie must be named vaidya_admin_token');
        assert.ok(cookieStr.includes('HttpOnly'), 'Cookie must be HttpOnly');
        assert.ok(cookieStr.includes('Max-Age=28800') || cookieStr.includes('max-age=28800'), 'Cookie Max-Age must be 28800 seconds (8 hours)');
        console.log(' PASS: Valid admin OTP issued 8-hour HttpOnly vaidya_admin_token session cookie.');

        // 8. Replay prevention: Already verified admin OTP cannot be reused
        console.log('[Test 2.8] Verifying consumed admin OTP challenge cannot be replayed...');
        const replayRes = await request({
            path: '/api/auth/admin-otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: activeAdminChallengeId, otp: '123456' });
        assert.strictEqual(replayRes.statusCode, 400, 'Replayed challenge must be rejected');
        console.log(' PASS: Replayed administrator OTP challenge successfully rejected.');

        // 9. Administrator logout clears session cookie
        console.log('[Test 2.9] Verifying POST /api/auth/admin-logout clears administrator session...');
        const logoutRes = await request({
            path: '/api/auth/admin-logout',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {});
        assert.strictEqual(logoutRes.statusCode, 200);
        const logoutCookie = logoutRes.headers['set-cookie'];
        const logoutStr = Array.isArray(logoutCookie) ? logoutCookie.join('; ') : logoutCookie;
        assert.ok(logoutStr.includes('Max-Age=0') || logoutStr.includes('max-age=0'), 'Logout must expire cookie immediately');
        console.log(' PASS: Administrator session cookie cleared on logout.');

        // 10. Worker edge entrypoint has NO PBKDF2 in login path
        console.log('[Test 2.10] Verifying src/worker.js does not expose /api/auth/admin-login (PBKDF2 removed from Edge)...');
        const fs = require('fs');
        const path = require('path');
        const workerContent = fs.readFileSync(path.join(__dirname, '../src/worker.js'), 'utf8');
        assert.strictEqual(workerContent.includes("'/api/auth/admin-login'"), false, 'Worker must not contain /api/auth/admin-login');
        assert.ok(workerContent.includes("'/api/auth/admin-otp/send'"), 'Worker must contain /api/auth/admin-otp/send');
        assert.ok(workerContent.includes("'/api/auth/admin-otp/verify'"), 'Worker must contain /api/auth/admin-otp/verify');
        console.log(' PASS: PBKDF2 100k-iteration login completely removed from Cloudflare Worker edge route table.');

        console.log('\n================================================================');
        console.log(' ALL 17 CLOUDINARY & ADMIN PHONE OTP ACCEPTANCE TESTS PASSED!    ');
        console.log('================================================================\n');
    } finally {
        if (isDatabaseConfigured()) {
            try {
                await query("DELETE FROM public.phone_verifications WHERE phone = '9821522443'");
            } catch (e) {}
        }
        server.close();
    }
}

runTests().catch(err => {
    console.error('\n TEST FAILURE:', err);
    process.exit(1);
});
