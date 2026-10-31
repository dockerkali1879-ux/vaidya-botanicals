/**
 * VAIDYA BOTANICALS - Phone Verification Provider Abstraction
 * Supports Indian SMS OTP via 2Factor.in REST API with test/sandbox adapter,
 * database-backed shared rate limiting, challenge lifecycle, and verification proof issuance.
 */

const crypto = require('crypto');
const { query, isDatabaseConfigured } = require('./db');

const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY || '';
const TWOFACTOR_TEMPLATE_NAME = process.env.TWOFACTOR_TEMPLATE_NAME || '';
const OTP_EXPIRY_MINUTES = 5;
const PROOF_EXPIRY_MINUTES = 15;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFICATION_ATTEMPTS = 3;

// In-memory fallback strictly for unit tests when database is unconfigured
const mockVerificationStore = new Map();

/**
 * Normalizes an Indian mobile number.
 * Accepts "9876543210", "+919876543210", "919876543210", or formatted strings.
 * Returns clean 10-digit string or null if invalid.
 */
function normalizeIndianPhone(input) {
    if (!input || typeof input !== 'string') return null;
    const digits = input.replace(/\D/g, '');
    let clean = '';
    if (digits.length === 10) {
        clean = digits;
    } else if (digits.length === 12 && digits.startsWith('91')) {
        clean = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
        clean = digits.slice(1);
    } else {
        return null;
    }

    // Must be a valid Indian mobile number starting with 6, 7, 8, or 9
    if (/^[6-9]\d{9}$/.test(clean)) {
        return clean;
    }
    return null;
}

function isTestMode() {
    return (
        process.env.NODE_ENV === 'test' ||
        process.env.PHONE_VERIFICATION_TEST_MODE === 'true' ||
        !TWOFACTOR_API_KEY ||
        TWOFACTOR_API_KEY.includes('placeholder')
    );
}

/**
 * Dispatches an OTP to the target phone using 2Factor.in REST API or test adapter.
 * @param {string} phone - Normalized 10-digit mobile number
 * @param {string} ipAddress - Client IP address for rate limiting
 * @returns {Promise<{ success: boolean, challengeId: string, message: string }>}
 */
async function sendPhoneOtp({ phone, ipAddress = '' }) {
    const cleanPhone = normalizeIndianPhone(phone);
    if (!cleanPhone) {
        throw new Error('Please enter a valid 10-digit Indian mobile number (e.g., 9876543210)');
    }

    // 1. Database-backed rate limiting & cooldown verification (scoped strictly to checkout purpose)
    if (isDatabaseConfigured()) {
        // Cooldown: at least 60 seconds between sends to the same phone
        const cooldownCheck = await query(`
            SELECT created_at FROM public.phone_verifications
            WHERE phone = $1 AND (purpose = 'checkout' OR purpose IS NULL) AND created_at > NOW() - INTERVAL '1 second' * $2
            ORDER BY created_at DESC LIMIT 1
        `, [cleanPhone, RESEND_COOLDOWN_SECONDS]);

        if (cooldownCheck.rows.length > 0) {
            const err = new Error(`Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another verification code.`);
            err.statusCode = 429;
            err.retryAfter = RESEND_COOLDOWN_SECONDS;
            throw err;
        }

        // Velocity limit: max 5 requests per phone per 30 minutes
        const phoneLimitCheck = await query(`
            SELECT COUNT(*) AS count FROM public.phone_verifications
            WHERE phone = $1 AND (purpose = 'checkout' OR purpose IS NULL) AND created_at > NOW() - INTERVAL '30 minutes'
        `, [cleanPhone]);

        if (parseInt(phoneLimitCheck.rows[0].count, 10) >= 5) {
            const err = new Error('Too many verification requests for this phone number. Please try again after 30 minutes.');
            err.statusCode = 429;
            err.retryAfter = 1800;
            throw err;
        }

        // IP velocity limit: max 15 requests per IP per 30 minutes
        if (ipAddress && ipAddress !== '127.0.0.1' && ipAddress !== '::1') {
            const ipLimitCheck = await query(`
                SELECT COUNT(*) AS count FROM public.phone_verifications
                WHERE ip_address = $1 AND (purpose = 'checkout' OR purpose IS NULL) AND created_at > NOW() - INTERVAL '30 minutes'
            `, [ipAddress]);

            if (parseInt(ipLimitCheck.rows[0].count, 10) >= 15) {
                const err = new Error('Too many verification requests from your network. Please try again later.');
                err.statusCode = 429;
                err.retryAfter = 1800;
                throw err;
            }
        }
    } else {
        // Fallback in-memory rate limiting for offline tests
        const now = Date.now();
        const records = Array.from(mockVerificationStore.values()).filter(v => v.phone === cleanPhone && (v.purpose === 'checkout' || !v.purpose));
        const last = records.sort((a, b) => b.createdAt - a.createdAt)[0];
        if (last && now - last.createdAt < RESEND_COOLDOWN_SECONDS * 1000) {
            const err = new Error(`Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another verification code.`);
            err.statusCode = 429;
            err.retryAfter = RESEND_COOLDOWN_SECONDS;
            throw err;
        }
    }

    // 2. Dispatch challenge via 2Factor.in API or Test Adapter
    let sessionId = '';
    const challengeId = 'ch_' + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    if (isTestMode()) {
        // Test / Sandbox mode: Never make external network calls
        sessionId = 'test_sess_' + crypto.randomBytes(12).toString('hex');
    } else {
        // Live production call to 2Factor.in
        const templateSegment = TWOFACTOR_TEMPLATE_NAME ? `/${encodeURIComponent(TWOFACTOR_TEMPLATE_NAME)}` : '';
        const url = `https://2factor.in/API/V1/${encodeURIComponent(TWOFACTOR_API_KEY)}/SMS/+91${cleanPhone}/AUTOGEN${templateSegment}`;

        const res = await fetch(url, { method: 'GET' });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || data.Status !== 'Success' || !data.Details) {
            console.error('[2Factor Send Error]:', { status: res.status, body: data });
            throw new Error(data.Details || 'Failed to dispatch SMS verification code via telecom provider');
        }

        sessionId = data.Details;
    }

    // 3. Store challenge record in database or mock store
    if (isDatabaseConfigured()) {
        await query(`
            INSERT INTO public.phone_verifications (
                phone, session_id, challenge_id, ip_address, attempts, max_attempts, status, purpose, expires_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 0, $5, 'pending', 'checkout', $6, NOW(), NOW())
        `, [cleanPhone, sessionId, challengeId, ipAddress, MAX_VERIFICATION_ATTEMPTS, expiresAt]);
    } else {
        mockVerificationStore.set(challengeId, {
            phone: cleanPhone,
            sessionId,
            challengeId,
            ipAddress,
            attempts: 0,
            maxAttempts: MAX_VERIFICATION_ATTEMPTS,
            status: 'pending',
            purpose: 'checkout',
            expiresAt: expiresAt.getTime(),
            createdAt: Date.now()
        });
    }

    return {
        success: true,
        challengeId,
        message: 'A verification code has been sent to +91 ' + cleanPhone
    };
}

/**
 * Verifies an OTP code against a challenge and issues a one-time verification proof.
 * @param {string} challengeId - Safe challenge identifier from send step
 * @param {string} code - 4-to-6 digit OTP submitted by customer
 * @returns {Promise<{ success: boolean, verificationProof: string, phone: string }>}
 */
async function verifyPhoneOtp({ challengeId, code }) {
    if (!challengeId) {
        throw new Error('Challenge identifier is required');
    }
    const cleanCode = String(code || '').trim();
    if (!/^\d{4,6}$/.test(cleanCode)) {
        throw new Error('Verification code must be 4 to 6 numeric digits');
    }

    // 1. Retrieve challenge from Neon or mock store
    let challenge = null;

    if (isDatabaseConfigured()) {
        const res = await query(`
            SELECT * FROM public.phone_verifications
            WHERE challenge_id = $1 AND (purpose = 'checkout' OR purpose IS NULL)
            LIMIT 1
        `, [challengeId]);

        if (res.rows.length === 0) {
            throw new Error('Invalid or expired verification session');
        }
        challenge = res.rows[0];
    } else {
        challenge = mockVerificationStore.get(challengeId);
        if (!challenge || (challenge.purpose && challenge.purpose !== 'checkout')) {
            throw new Error('Invalid or expired verification session');
        }
    }

    // 2. Validate challenge state
    if (challenge.status !== 'pending') {
        if (challenge.status === 'verified') {
            throw new Error('This verification code has already been verified.');
        }
        if (challenge.status === 'consumed') {
            throw new Error('This verification code has already been used.');
        }
        throw new Error('Verification session is no longer active.');
    }

    const expiryTime = new Date(challenge.expires_at || challenge.expiresAt).getTime();
    if (Date.now() > expiryTime) {
        if (isDatabaseConfigured()) {
            await query("UPDATE public.phone_verifications SET status = 'expired', updated_at = NOW() WHERE challenge_id = $1", [challengeId]);
        } else {
            challenge.status = 'expired';
        }
        throw new Error('Verification code has expired. Please request a new code.');
    }

    if (challenge.attempts >= challenge.max_attempts || challenge.attempts >= challenge.maxAttempts) {
        throw new Error('Maximum verification attempts exceeded. Please request a new code.');
    }

    // 3. Increment attempt counter
    if (isDatabaseConfigured()) {
        await query('UPDATE public.phone_verifications SET attempts = attempts + 1, updated_at = NOW() WHERE challenge_id = $1', [challengeId]);
    } else {
        challenge.attempts++;
    }

    // 4. Verify against 2Factor.in provider API or Test Adapter
    let isValidOtp = false;

    if (isTestMode()) {
        // In test mode: accept '123456' as valid test passcode
        if (cleanCode === '123456') {
            isValidOtp = true;
        } else {
            isValidOtp = false;
        }
    } else {
        // Live call to 2Factor.in VERIFY endpoint
        const sessionId = challenge.session_id || challenge.sessionId;
        const url = `https://2factor.in/API/V1/${encodeURIComponent(TWOFACTOR_API_KEY)}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(cleanCode)}`;

        const res = await fetch(url, { method: 'GET' });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.Status === 'Success' && data.Details === 'OTP Matched') {
            isValidOtp = true;
        } else {
            isValidOtp = false;
            console.warn('[2Factor Verify Failed]:', { status: res.status, body: data });
        }
    }

    if (!isValidOtp) {
        throw new Error('Incorrect verification code. Please check and try again.');
    }

    // 5. Issue one-time checkout verification proof
    const verificationProof = 'vprf_' + crypto.randomBytes(24).toString('hex');
    const proofExpiresAt = new Date(Date.now() + PROOF_EXPIRY_MINUTES * 60 * 1000);

    if (isDatabaseConfigured()) {
        await query(`
            UPDATE public.phone_verifications
            SET status = 'verified',
                verification_proof = $1,
                proof_expires_at = $2,
                verified_at = NOW(),
                updated_at = NOW()
            WHERE challenge_id = $3
        `, [verificationProof, proofExpiresAt, challengeId]);
    } else {
        challenge.status = 'verified';
        challenge.verificationProof = verificationProof;
        challenge.proofExpiresAt = proofExpiresAt.getTime();
        challenge.verifiedAt = Date.now();
    }

    return {
        success: true,
        verificationProof,
        phone: challenge.phone
    };
}

/**
 * Validates and atomically consumes a verification proof for an order.
 * Can be run inside an active database transaction.
 * @param {object} client - Optional pg.Client instance for transactions
 * @param {string} proof - The verification proof string
 * @param {string} expectedPhone - The buyer phone number that must match the verified phone
 * @returns {Promise<{ valid: boolean, phone: string, verifiedAt: Date }>}
 */
async function consumeVerificationProof(clientOrNull, proof, expectedPhone) {
    if (!proof || !expectedPhone) {
        throw new Error('Verification proof and buyer mobile number are required');
    }

    const cleanExpectedPhone = normalizeIndianPhone(expectedPhone);
    if (!cleanExpectedPhone) {
        throw new Error('Invalid buyer mobile number format');
    }

    const runner = clientOrNull ? clientOrNull.query.bind(clientOrNull) : query;

    if (isDatabaseConfigured()) {
        const res = await runner(`
            SELECT * FROM public.phone_verifications
            WHERE verification_proof = $1
            FOR UPDATE
        `, [proof]);

        if (res.rows.length === 0) {
            throw new Error('Invalid or unverified phone verification proof');
        }

        const record = res.rows[0];

        if (record.status !== 'verified') {
            if (record.status === 'consumed') {
                throw new Error('This phone verification proof has already been used for an order.');
            }
            throw new Error('Phone verification has not been completed.');
        }

        if (new Date() > new Date(record.proof_expires_at)) {
            throw new Error('Phone verification proof has expired. Please verify your phone number again.');
        }

        if (record.phone !== cleanExpectedPhone) {
            throw new Error(`Verified phone number does not match buyer mobile number (${cleanExpectedPhone}).`);
        }

        // Atomically consume the proof
        await runner(`
            UPDATE public.phone_verifications
            SET status = 'consumed',
                consumed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [record.id]);

        return {
            valid: true,
            phone: record.phone,
            verifiedAt: record.verified_at || new Date()
        };
    } else {
        // Fallback for offline mock tests
        const record = Array.from(mockVerificationStore.values()).find(v => v.verificationProof === proof);
        if (!record || record.status !== 'verified') {
            if (record && record.status === 'consumed') {
                throw new Error('This phone verification proof has already been used for an order.');
            }
            throw new Error('Invalid or unverified phone verification proof');
        }

        if (Date.now() > record.proofExpiresAt) {
            throw new Error('Phone verification proof has expired. Please verify your phone number again.');
        }

        if (record.phone !== cleanExpectedPhone) {
            throw new Error(`Verified phone number does not match buyer mobile number (${cleanExpectedPhone}).`);
        }

        record.status = 'consumed';
        record.consumedAt = Date.now();

        return {
            valid: true,
            phone: record.phone,
            verifiedAt: new Date(record.verifiedAt || Date.now())
        };
    }
}

/**
 * Dispatches an administrator authentication OTP to the strictly configured admin phone.
 * Never trusts any phone number supplied by the browser.
 */
async function sendAdminPhoneOtp({ ipAddress = '', env = null }) {
    const config = env || process.env;
    const adminProfileId = (config.ADMIN_PROFILE_ID || process.env.ADMIN_PROFILE_ID || 'admin_a815af4fa9d20017d31f864c').trim();
    let configuredPhone = (config.ADMIN_PHONE_E164 || process.env.ADMIN_PHONE_E164 || process.env.BUSINESS_OWNER_PHONE || '+919821522443').trim();

    // 1. Authorize against Neon profiles table
    let adminProfile = null;
    if (isDatabaseConfigured()) {
        const res = await query(
            'SELECT id, email, full_name, role, phone FROM public.profiles WHERE id = $1 AND role = $2',
            [adminProfileId, 'admin']
        );
        if (res.rows.length === 0) {
            const err = new Error('Configured administrator profile not found or unauthorized');
            err.statusCode = 403;
            throw err;
        }
        adminProfile = res.rows[0];
        if (adminProfile.phone) {
            configuredPhone = adminProfile.phone;
        }
    } else {
        // Fallback for mock test fixtures
        adminProfile = { id: adminProfileId, email: 'admin@vaidyabotanicals.com', role: 'admin' };
    }

    const cleanPhone = normalizeIndianPhone(configuredPhone);
    if (!cleanPhone) {
        throw new Error('Configured administrator phone is not a valid Indian mobile number');
    }

    // 2. Database-backed rate limiting specifically for administrator auth
    if (isDatabaseConfigured()) {
        const cooldownCheck = await query(`
            SELECT created_at FROM public.phone_verifications
            WHERE phone = $1 AND purpose = 'admin_auth' AND created_at > NOW() - INTERVAL '1 second' * $2
            ORDER BY created_at DESC LIMIT 1
        `, [cleanPhone, RESEND_COOLDOWN_SECONDS]);

        if (cooldownCheck.rows.length > 0) {
            const err = new Error(`Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another administrator verification code.`);
            err.statusCode = 429;
            err.retryAfter = RESEND_COOLDOWN_SECONDS;
            throw err;
        }

        const adminVelocity = await query(`
            SELECT COUNT(*) AS count FROM public.phone_verifications
            WHERE phone = $1 AND purpose = 'admin_auth' AND created_at > NOW() - INTERVAL '30 minutes'
        `, [cleanPhone]);

        if (parseInt(adminVelocity.rows[0].count, 10) >= 5) {
            const err = new Error('Too many administrator verification requests. Please try again after 30 minutes.');
            err.statusCode = 429;
            err.retryAfter = 1800;
            throw err;
        }
    } else {
        const now = Date.now();
        const records = Array.from(mockVerificationStore.values()).filter(v => v.phone === cleanPhone && v.purpose === 'admin_auth');
        const last = records.sort((a, b) => b.createdAt - a.createdAt)[0];
        if (last && now - last.createdAt < RESEND_COOLDOWN_SECONDS * 1000) {
            const err = new Error(`Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another administrator verification code.`);
            err.statusCode = 429;
            err.retryAfter = RESEND_COOLDOWN_SECONDS;
            throw err;
        }
    }

    // 3. Dispatch challenge via 2Factor.in API or Test Adapter
    let sessionId = '';
    const challengeId = 'ch_adm_' + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const apiKey = config.TWOFACTOR_API_KEY || process.env.TWOFACTOR_API_KEY || '';
    const isLive = !isTestMode() && apiKey && !apiKey.includes('placeholder');

    if (!isLive) {
        sessionId = 'test_adm_sess_' + crypto.randomBytes(12).toString('hex');
    } else {
        const templateSegment = TWOFACTOR_TEMPLATE_NAME ? `/${encodeURIComponent(TWOFACTOR_TEMPLATE_NAME)}` : '';
        const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/+91${cleanPhone}/AUTOGEN${templateSegment}`;
        const res = await fetch(url, { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.Status !== 'Success' || !data.Details) {
            console.error('[2Factor Admin Send Error]:', { status: res.status, body: data });
            throw new Error(data.Details || 'Failed to dispatch administrator SMS OTP');
        }
        sessionId = data.Details;
    }

    // 4. Store challenge record with purpose = 'admin_auth'
    if (isDatabaseConfigured()) {
        await query(`
            INSERT INTO public.phone_verifications (
                phone, session_id, challenge_id, ip_address, attempts, max_attempts, status, purpose, expires_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 0, $5, 'pending', 'admin_auth', $6, NOW(), NOW())
        `, [cleanPhone, sessionId, challengeId, ipAddress, MAX_VERIFICATION_ATTEMPTS, expiresAt]);
    } else {
        mockVerificationStore.set(challengeId, {
            phone: cleanPhone,
            sessionId,
            challengeId,
            ipAddress,
            attempts: 0,
            maxAttempts: MAX_VERIFICATION_ATTEMPTS,
            status: 'pending',
            purpose: 'admin_auth',
            expiresAt: expiresAt.getTime(),
            createdAt: Date.now()
        });
    }

    const maskedPhone = cleanPhone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2');

    return {
        success: true,
        challengeId,
        maskedPhone,
        message: `Administrator verification code sent to +91 ${maskedPhone}`
    };
}

/**
 * Verifies an administrator OTP and returns authenticated profile details.
 * Strictly verifies purpose === 'admin_auth' and re-confirms admin role in Neon.
 */
async function verifyAdminPhoneOtp({ challengeId, code, env = null }) {
    if (!challengeId) {
        throw new Error('Challenge identifier is required');
    }
    const cleanCode = String(code || '').trim();
    if (!/^\d{4,6}$/.test(cleanCode)) {
        throw new Error('Verification code must be 4 to 6 numeric digits');
    }

    const config = env || process.env;
    const adminProfileId = (config.ADMIN_PROFILE_ID || process.env.ADMIN_PROFILE_ID || 'admin_a815af4fa9d20017d31f864c').trim();

    // 1. Retrieve challenge from database or mock store
    let challenge = null;
    if (isDatabaseConfigured()) {
        const res = await query(`
            SELECT * FROM public.phone_verifications
            WHERE challenge_id = $1 AND purpose = 'admin_auth'
            LIMIT 1
        `, [challengeId]);

        if (res.rows.length === 0) {
            throw new Error('Invalid or expired administrator verification session');
        }
        challenge = res.rows[0];
    } else {
        challenge = mockVerificationStore.get(challengeId);
        if (!challenge || challenge.purpose !== 'admin_auth') {
            throw new Error('Invalid or expired administrator verification session');
        }
    }

    // 2. Validate challenge state
    if (challenge.status !== 'pending') {
        if (challenge.status === 'verified') {
            throw new Error('This administrator verification code has already been verified.');
        }
        if (challenge.status === 'consumed') {
            throw new Error('This administrator verification code has already been used.');
        }
        throw new Error('Administrator verification session is no longer active.');
    }

    const expiryTime = new Date(challenge.expires_at || challenge.expiresAt).getTime();
    if (Date.now() > expiryTime) {
        if (isDatabaseConfigured()) {
            await query("UPDATE public.phone_verifications SET status = 'expired', updated_at = NOW() WHERE challenge_id = $1", [challengeId]);
        } else {
            challenge.status = 'expired';
        }
        throw new Error('Administrator verification code has expired. Please request a new code.');
    }

    if (challenge.attempts >= challenge.max_attempts || challenge.attempts >= challenge.maxAttempts) {
        throw new Error('Maximum verification attempts exceeded. Please request a new code.');
    }

    // 3. Increment attempt counter
    if (isDatabaseConfigured()) {
        await query('UPDATE public.phone_verifications SET attempts = attempts + 1, updated_at = NOW() WHERE challenge_id = $1', [challengeId]);
    } else {
        challenge.attempts++;
    }

    // 4. Verify against 2Factor.in provider or test adapter
    let isValidOtp = false;
    const apiKey = config.TWOFACTOR_API_KEY || process.env.TWOFACTOR_API_KEY || '';
    const isLive = !isTestMode() && apiKey && !apiKey.includes('placeholder');

    if (!isLive) {
        if (cleanCode === '123456') {
            isValidOtp = true;
        }
    } else {
        const sessionId = challenge.session_id || challenge.sessionId;
        const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(cleanCode)}`;
        const res = await fetch(url, { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.Status === 'Success' && data.Details === 'OTP Matched') {
            isValidOtp = true;
        } else {
            console.warn('[2Factor Admin Verify Failed]:', { status: res.status, body: data });
        }
    }

    if (!isValidOtp) {
        throw new Error('Incorrect verification code. Please check and try again.');
    }

    // 5. Confirm configured administrator profile still exists and still has role = 'admin'
    let adminRecord = null;
    if (isDatabaseConfigured()) {
        const profileRes = await query(
            'SELECT id, email, full_name, role FROM public.profiles WHERE id = $1 AND role = $2',
            [adminProfileId, 'admin']
        );
        if (profileRes.rows.length === 0) {
            throw new Error('Configured administrator profile no longer has administrator privileges.');
        }
        adminRecord = profileRes.rows[0];

        // Mark challenge as consumed/verified
        await query(`
            UPDATE public.phone_verifications
            SET status = 'consumed',
                verified_at = NOW(),
                consumed_at = NOW(),
                updated_at = NOW()
            WHERE challenge_id = $1
        `, [challengeId]);
    } else {
        challenge.status = 'consumed';
        challenge.verifiedAt = Date.now();
        challenge.consumedAt = Date.now();
        adminRecord = {
            id: adminProfileId,
            email: 'admin@vaidyabotanicals.com',
            full_name: 'Store Owner',
            role: 'admin'
        };
    }

    return {
        success: true,
        admin: {
            id: adminRecord.id,
            email: adminRecord.email,
            fullName: adminRecord.full_name,
            role: 'admin'
        }
    };
}

module.exports = {
    normalizeIndianPhone,
    sendPhoneOtp,
    verifyPhoneOtp,
    consumeVerificationProof,
    sendAdminPhoneOtp,
    verifyAdminPhoneOtp,
    mockVerificationStore
};
