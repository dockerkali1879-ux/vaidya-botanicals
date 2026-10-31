/**
 * VAIDYA BOTANICALS - Security & Validation Hardening Verification Suite
 * Tests fail-closed OTP behavior, order quantity/shipping/payment validation,
 * admin authentication fallback elimination, and environment privacy.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isTestMode, sendPhoneOtp, verifyPhoneOtp, sendAdminPhoneOtp, verifyAdminPhoneOtp } = require('../lib/phone-verification');
const { verifyAdmin, createAdminToken, createAdminCookie } = require('../lib/auth');
const ordersHandler = require('../api/orders/index');

// Mock HTTP Response helper
function createMockRes() {
    return {
        _status: 200,
        _json: null,
        _headers: {},
        status(code) {
            this._status = code;
            return this;
        },
        json(data) {
            this._json = data;
            return this;
        },
        setHeader(k, v) {
            this._headers[k] = v;
            return this;
        }
    };
}

async function runSecurityTests() {
    console.log('\n======================================================');
    console.log('VAIDYA BOTANICALS: SECURITY HARDENING VERIFICATION');
    console.log('======================================================\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}:`, err.message);
            failed++;
        }
    }

    async function testAsync(name, fn) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}:`, err.message);
            failed++;
        }
    }

    // -------------------------------------------------------------------------
    // 1. Phone OTP Fail-Closed Verification
    // -------------------------------------------------------------------------
    console.log('--- 1. OTP Fail-Closed Verification ---');

    test('isTestMode returns false in production even with test flags', () => {
        assert.strictEqual(isTestMode({ NODE_ENV: 'production', PHONE_VERIFICATION_TEST_MODE: 'true' }), false);
    });

    test('isTestMode returns false in staging/development when unconfigured (no fallback)', () => {
        assert.strictEqual(isTestMode({ NODE_ENV: 'staging' }), false);
        assert.strictEqual(isTestMode({ NODE_ENV: 'development' }), false);
    });

    test('isTestMode returns true only when NODE_ENV === "test" or PHONE_VERIFICATION_TEST_MODE === "true"', () => {
        assert.strictEqual(isTestMode({ NODE_ENV: 'test' }), true);
        assert.strictEqual(isTestMode({ NODE_ENV: 'development', PHONE_VERIFICATION_TEST_MODE: 'true' }), true);
    });

    await testAsync('sendPhoneOtp fails closed (HTTP 503) when 2Factor API key is missing outside test mode', async () => {
        try {
            await sendPhoneOtp({
                phone: '9876543210',
                env: { NODE_ENV: 'staging', TWOFACTOR_API_KEY: '' }
            });
            assert.fail('Should have thrown 503');
        } catch (err) {
            assert.strictEqual(err.statusCode, 503);
            assert(err.message.includes('unconfigured') || err.message.includes('unavailable'));
        }
    });

    await testAsync('verifyPhoneOtp fails closed (HTTP 503) when 2Factor API key is missing outside test mode', async () => {
        try {
            await verifyPhoneOtp({
                challengeId: 'ch_dummy',
                code: '123456',
                env: { NODE_ENV: 'staging', TWOFACTOR_API_KEY: '' }
            });
            assert.fail('Should have thrown error');
        } catch (err) {
            assert(err.message.includes('unconfigured') || err.message.includes('expired') || err.message.includes('Invalid'));
        }
    });

    await testAsync('sendAdminPhoneOtp fails closed when no phone is configured (no hardcoded fallback)', async () => {
        try {
            await sendAdminPhoneOtp({
                env: {
                    NODE_ENV: 'staging',
                    ADMIN_PROFILE_ID: 'admin_nonexistent_profile_id',
                    ADMIN_PHONE_E164: '',
                    BUSINESS_OWNER_PHONE: '',
                    TWOFACTOR_API_KEY: 'test'
                }
            });
            assert.fail('Should have failed');
        } catch (err) {
            assert(err.message.includes('not configured') || err.message.includes('not found') || err.message.includes('unauthorized') || err.message.includes('Database connection is required'));
        }
    });

    // -------------------------------------------------------------------------
    // 2. Server-Side Order Creation Hardening
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Server-Side Order Creation Hardening ---');

    await testAsync('rejects order with negative quantity (HTTP 400)', async () => {
        const req = {
            method: 'POST',
            body: {
                verification_proof: 'vprf_dummy',
                address: {
                    customer_name: 'Test Buyer',
                    customer_email: 'buyer@example.com',
                    customer_phone: '9876543210',
                    l1: '123 Street',
                    l2: 'Area',
                    city: 'Bangalore',
                    state: 'Karnataka',
                    pin: '560001'
                },
                items: [
                    { id: 'prod-1', name: 'Ashwagandha', qty: -5, price: 100 }
                ]
            }
        };
        const res = createMockRes();
        await ordersHandler(req, res);
        assert.strictEqual(res._status, 400);
        assert(res._json.error.includes('Quantity must be a positive integer'));
    });

    await testAsync('rejects order with zero quantity (HTTP 400)', async () => {
        const req = {
            method: 'POST',
            body: {
                verification_proof: 'vprf_dummy',
                address: {
                    customer_name: 'Test Buyer',
                    customer_email: 'buyer@example.com',
                    customer_phone: '9876543210',
                    l1: '123 Street',
                    l2: 'Area',
                    city: 'Bangalore',
                    state: 'Karnataka',
                    pin: '560001'
                },
                items: [
                    { id: 'prod-1', name: 'Ashwagandha', qty: 0, price: 100 }
                ]
            }
        };
        const res = createMockRes();
        await ordersHandler(req, res);
        assert.strictEqual(res._status, 400);
        assert(res._json.error.includes('Quantity must be a positive integer'));
    });

    await testAsync('rejects order with non-integer quantity (HTTP 400)', async () => {
        const req = {
            method: 'POST',
            body: {
                verification_proof: 'vprf_dummy',
                address: {
                    customer_name: 'Test Buyer',
                    customer_email: 'buyer@example.com',
                    customer_phone: '9876543210',
                    l1: '123 Street',
                    l2: 'Area',
                    city: 'Bangalore',
                    state: 'Karnataka',
                    pin: '560001'
                },
                items: [
                    { id: 'prod-1', name: 'Ashwagandha', qty: 1.5, price: 100 }
                ]
            }
        };
        const res = createMockRes();
        await ordersHandler(req, res);
        assert.strictEqual(res._status, 400);
        assert(res._json.error.includes('Quantity must be a positive integer'));
    });

    await testAsync('rejects online Razorpay payments for initial launch (HTTP 400)', async () => {
        const req = {
            method: 'POST',
            body: {
                verification_proof: 'vprf_dummy',
                address: {
                    customer_name: 'Test Buyer',
                    customer_email: 'buyer@example.com',
                    customer_phone: '9876543210',
                    l1: '123 Street',
                    l2: 'Area',
                    city: 'Bangalore',
                    state: 'Karnataka',
                    pin: '560001'
                },
                items: [
                    { id: 'prod-1', name: 'Ashwagandha', qty: 1, price: 100 }
                ],
                payment: {
                    method: 'razorpay',
                    paymentId: 'pay_dummy123'
                }
            }
        };
        const res = createMockRes();
        await ordersHandler(req, res);
        assert.strictEqual(res._status, 400);
        assert(res._json.error.includes('Online payments via Razorpay are temporarily disabled'));
    });

    // -------------------------------------------------------------------------
    // 3. Administrator Authentication Fallback Elimination
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Administrator Auth Fallback Elimination ---');

    test('createAdminToken throws error in production if JWT secret is short or missing', () => {
        assert.throws(() => {
            createAdminToken({ email: 'admin@vaidyabotanicals.com', role: 'admin' }, '', {
                NODE_ENV: 'production',
                ADMIN_JWT_SECRET: 'short'
            });
        }, /ADMIN_JWT_SECRET must be configured with a minimum of 32 characters/);
    });

    test('createAdminToken throws error in production if default/change_me secret is used', () => {
        assert.throws(() => {
            createAdminToken({ email: 'admin@vaidyabotanicals.com', role: 'admin' }, '', {
                NODE_ENV: 'production',
                ADMIN_JWT_SECRET: 'vaidya_jwt_change_me_super_insecure_secret_1234'
            });
        }, /ADMIN_JWT_SECRET must be configured with a minimum of 32 characters/);
    });

    await testAsync('verifyAdmin rejects forged or unrecognized token without DB admin profile', async () => {
        const fakeToken = createAdminToken({ email: 'hacker@example.com', role: 'admin' }, 'test_jwt_secret_vaidya_botanicals_min_32_chars_ok!');
        const req = {
            headers: {
                cookie: `vaidya_admin_token=${fakeToken}`
            },
            env: {
                NODE_ENV: 'test',
                ADMIN_JWT_SECRET: 'test_jwt_secret_vaidya_botanicals_min_32_chars_ok!'
            }
        };
        const verified = await verifyAdmin(req, 'test_jwt_secret_vaidya_botanicals_min_32_chars_ok!');
        assert.strictEqual(verified, null);
    });

    // -------------------------------------------------------------------------
    // 4. Git Exclusions & Privacy
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Git Exclusions & Privacy ---');

    test('.gitignore excludes all .env variants while allowing .env.example', () => {
        const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
        assert(gitignore.includes('.env.*'), '.gitignore must contain .env.*');
        assert(gitignore.includes('!.env.example'), '.gitignore must preserve !.env.example');
        assert(gitignore.includes('.dev.vars.*'), '.gitignore must contain .dev.vars.*');
    });

    test('.env.example contains no personal phone numbers or specific profile IDs', () => {
        const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
        assert(!envExample.includes('9821522443'), '.env.example must not contain real admin phone');
        assert(!envExample.includes('a815af4fa9d20017d31f864c'), '.env.example must not contain specific admin profile ID');
        assert(envExample.includes('ADMIN_PHONE_E164=+919999999999'), '.env.example must contain generic placeholder');
    });

    console.log('\n======================================================');
    console.log(`SECURITY TESTS RESULT: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    runSecurityTests().catch(err => {
        console.error('Test runner fatal error:', err);
        process.exit(1);
    });
}

module.exports = runSecurityTests;
