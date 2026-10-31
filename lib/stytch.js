/**
 * VAIDYA BOTANICALS - Stytch Consumer Authentication Client (B2C)
 * Provides official Stytch B2C Email OTP and Session management.
 */

const stytch = require('stytch');
require('dotenv').config();

const PROJECT_ID = process.env.STYTCH_PROJECT_ID || '';
const SECRET = process.env.STYTCH_SECRET || '';
const ENV = process.env.STYTCH_ENV === 'live' ? 'live' : 'test';

function isStytchConfigured() {
    return Boolean(
        PROJECT_ID &&
        SECRET &&
        !PROJECT_ID.includes('your_') &&
        !SECRET.includes('your_') &&
        !PROJECT_ID.includes('placeholder')
    );
}

let stytchClient = null;

function getStytchClient() {
    if (!stytchClient) {
        if (!isStytchConfigured()) {
            return null;
        }

        stytchClient = new stytch.Client({
            project_id: PROJECT_ID,
            secret: SECRET,
            env: ENV === 'live' ? stytch.envs.live : stytch.envs.test
        });
    }
    return stytchClient;
}

// In-memory test store strictly for automated test runner when STYTCH_TEST_MODE is enabled
const testOtpStore = new Map();
const testSessionStore = new Map();

/**
 * Sends a passwordless Email OTP using Stytch Consumer Authentication.
 * Handles both existing customer login and new customer registration simultaneously.
 */
async function sendEmailOtp({ email, expirationMinutes = 10 }) {
    const client = getStytchClient();
    const normalizedEmail = String(email).trim().toLowerCase();

    if (client) {
        const response = await client.otps.email.loginOrCreate({
            email: normalizedEmail,
            expiration_minutes: expirationMinutes
        });
        return {
            methodId: response.method_id,
            userId: response.user_id,
            userCreated: response.user_created
        };
    }

    // Isolated test runner adapter when offline tests execute without Stytch API keys
    if (process.env.NODE_ENV === 'test' || process.env.STYTCH_TEST_MODE === 'true') {
        const methodId = 'mock_method_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const testCode = '123456';
        testOtpStore.set(methodId, {
            email: normalizedEmail,
            code: testCode,
            expiresAt: Date.now() + expirationMinutes * 60 * 1000
        });
        return {
            methodId,
            userId: 'test_user_' + normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_'),
            userCreated: true,
            _testCode: testCode
        };
    }

    throw new Error('Stytch authentication is not configured with live credentials. Set STYTCH_PROJECT_ID and STYTCH_SECRET in .env.local.');
}

/**
 * Authenticates the 6-digit OTP code against Stytch and creates a persistent consumer session.
 */
async function authenticateOtp({ methodId, code, sessionDurationMinutes = 10080 }) {
    const client = getStytchClient();

    if (client) {
        const response = await client.otps.authenticate({
            method_id: methodId,
            code: String(code).trim(),
            session_duration_minutes: sessionDurationMinutes
        });

        const verifiedEmail = response.user.emails && response.user.emails.length > 0
            ? response.user.emails[0].email
            : null;

        return {
            sessionToken: response.session_token,
            sessionJwt: response.session_jwt,
            stytchUserId: response.user.user_id,
            email: verifiedEmail
        };
    }

    if (process.env.NODE_ENV === 'test' || process.env.STYTCH_TEST_MODE === 'true') {
        const record = testOtpStore.get(methodId);
        if (!record) {
            throw new Error('Invalid or expired verification session');
        }
        if (Date.now() > record.expiresAt) {
            testOtpStore.delete(methodId);
            throw new Error('Verification code has expired. Please request a new one.');
        }
        if (record.code !== String(code).trim()) {
            throw new Error('Invalid verification code. Please check and try again.');
        }

        testOtpStore.delete(methodId);
        const sessionToken = 'test_sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        const stytchUserId = 'test_stytch_' + record.email.replace(/[^a-zA-Z0-9]/g, '_');

        testSessionStore.set(sessionToken, {
            email: record.email,
            stytchUserId,
            expiresAt: Date.now() + sessionDurationMinutes * 60 * 1000
        });

        return {
            sessionToken,
            sessionJwt: 'mock_jwt',
            stytchUserId,
            email: record.email
        };
    }

    throw new Error('Stytch authentication is not configured with live credentials. Set STYTCH_PROJECT_ID and STYTCH_SECRET in .env.local.');
}

/**
 * Validates an active consumer session with Stytch.
 */
async function authenticateSession(sessionToken) {
    if (!sessionToken) return null;
    const client = getStytchClient();

    if (client) {
        try {
            const response = await client.sessions.authenticate({
                session_token: sessionToken
            });
            const email = response.user.emails && response.user.emails.length > 0
                ? response.user.emails[0].email
                : null;
            return {
                stytchUserId: response.user.user_id,
                email
            };
        } catch (err) {
            return null;
        }
    }

    if (process.env.NODE_ENV === 'test' || process.env.STYTCH_TEST_MODE === 'true') {
        const sess = testSessionStore.get(sessionToken);
        if (!sess || Date.now() > sess.expiresAt) {
            return null;
        }
        return {
            stytchUserId: sess.stytchUserId,
            email: sess.email
        };
    }

    return null;
}

/**
 * Revokes a consumer session with Stytch (logout).
 */
async function revokeSession(sessionToken) {
    if (!sessionToken) return;
    const client = getStytchClient();

    if (client) {
        try {
            await client.sessions.revoke({ session_token: sessionToken });
        } catch (e) {
            // Ignore if already revoked
        }
        return;
    }

    if (process.env.NODE_ENV === 'test' || process.env.STYTCH_TEST_MODE === 'true') {
        testSessionStore.delete(sessionToken);
    }
}

module.exports = {
    isStytchConfigured,
    getStytchClient,
    sendEmailOtp,
    authenticateOtp,
    authenticateSession,
    revokeSession
};

