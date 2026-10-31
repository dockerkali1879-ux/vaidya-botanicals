const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const crypto = require('crypto');
const { isDatabaseConfigured, query, transaction } = require('./db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('./supabase');
const { sendEmailOtp, authenticateOtp, authenticateSession, revokeSession } = require('./stytch');
require('dotenv').config();

function getAdminJwtSecret(customSecret, env = null) {
    const config = env || process.env;
    const secret = customSecret || config.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET;

    // In production or staging, require strict, high-entropy secret (>= 32 chars)
    if (config.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
        if (!secret || secret.trim().length < 32 || secret.includes('change_me') || secret.includes('dev_jwt')) {
            throw new Error('ADMIN_JWT_SECRET must be configured with a minimum of 32 characters in production/staging.');
        }
        return secret.trim();
    }

    // In automated testing, allow test secret if unconfigured
    if (config.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') {
        return secret || 'test_jwt_secret_vaidya_botanicals_min_32_chars_ok!';
    }

    if (!secret || secret.trim().length < 16) {
        throw new Error('ADMIN_JWT_SECRET must be configured with at least 16 characters.');
    }
    return secret.trim();
}

const ADMIN_COOKIE_NAME = 'vaidya_admin_token';
const CUSTOMER_COOKIE_NAME = 'vaidya_customer_session';
const ADMIN_SESSION_HOURS = 8;
const ADMIN_TOKEN_EXPIRY = '8h';
const SESSION_DAYS = 7;
const TOKEN_EXPIRY = '7d';

// Rate limiting stores for Email OTP
const otpRequestRateLimits = new Map();
const otpVerifyRateLimits = new Map();

function checkRateLimit(store, key, maxAttempts, windowMs) {
    const now = Date.now();
    const record = store.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
        record.count = 0;
        record.resetAt = now + windowMs;
    }
    record.count++;
    store.set(key, record);
    return record.count <= maxAttempts;
}

/**
 * Hashes a password using PBKDF2 with SHA-512 and a cryptographic salt.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

/**
 * Securely verifies a candidate password against the stored salt:hash using timing-safe comparison.
 */
function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, originalHash] = storedHash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

/**
 * Asynchronously verifies a candidate password against the stored salt:hash.
 * Uses Web Crypto API (crypto.subtle) when available (e.g. Cloudflare Workers, browser, modern Node),
 * while preserving the rigorous 100,000 PBKDF2 iterations, SHA-512, and timing-safe comparison.
 * Falls back to synchronous verifyPassword on Node if needed.
 */
async function verifyPasswordAsync(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [saltHex, originalHashHex] = storedHash.split(':');

    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
        try {
            const enc = new TextEncoder();
            const keyMaterial = await globalThis.crypto.subtle.importKey(
                'raw',
                enc.encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits']
            );
            const saltBuffer = enc.encode(saltHex);
            const derivedBits = await globalThis.crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: saltBuffer,
                    iterations: 100000,
                    hash: 'SHA-512'
                },
                keyMaterial,
                512 // 64 bytes = 512 bits
            );
            const derivedHex = Array.from(new Uint8Array(derivedBits))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');

            // Constant-time comparison
            if (derivedHex.length !== originalHashHex.length) return false;
            let diff = 0;
            for (let i = 0; i < derivedHex.length; i++) {
                diff |= derivedHex.charCodeAt(i) ^ originalHashHex.charCodeAt(i);
            }
            return diff === 0;
        } catch (e) {
            // Fall back to Node crypto if subtle fails
        }
    }

    return verifyPassword(password, storedHash);
}

/**
 * Helper to safely extract headers from both Node.js req and Cloudflare Workers fetch Request.
 */
function getHeader(req, name) {
    if (!req || !req.headers) return '';
    const lowerName = name.toLowerCase();
    if (typeof req.headers.get === 'function') {
        return req.headers.get(name) || req.headers.get(lowerName) || '';
    }
    return req.headers[name] || req.headers[lowerName] || '';
}

// ==============================================================================
// ADMINISTRATOR AUTHENTICATION
// ==============================================================================

function createAdminToken(user, customSecret, env = null) {
    const secret = getAdminJwtSecret(customSecret, env);
    return jwt.sign(
        {
            sub: user.id || user.email,
            email: user.email,
            role: 'admin'
        },
        secret,
        { expiresIn: ADMIN_TOKEN_EXPIRY }
    );
}

function createAdminCookie(token) {
    return cookie.serialize(ADMIN_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: ADMIN_SESSION_HOURS * 60 * 60
    });
}

function clearAdminCookie() {
    return cookie.serialize(ADMIN_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
}

/**
 * Extracts and verifies the admin session from an incoming HTTP request.
 * Strictly verifies role === 'admin'.
 * Fails closed in staging and production if database verification fails.
 */
async function verifyAdmin(req, customSecret) {
    try {
        const header = getHeader(req, 'cookie');
        const cookies = cookie.parse(header);
        const token = cookies[ADMIN_COOKIE_NAME];

        if (!token) return null;

        const env = req?.env || process.env;
        const secret = getAdminJwtSecret(customSecret, env);
        const decoded = jwt.verify(token, secret);
        if (!decoded || decoded.role !== 'admin' || !decoded.email) return null;

        // Strict verification: check against Neon PostgreSQL profiles table
        if (isDatabaseConfigured()) {
            try {
                const res = await query(
                    'SELECT id, email, full_name, role FROM public.profiles WHERE LOWER(email) = LOWER($1) AND role = $2',
                    [decoded.email, 'admin']
                );
                if (res.rows.length > 0) {
                    return res.rows[0];
                }
                return null;
            } catch (dbErr) {
                console.error('[Admin DB Auth Query Error]:', dbErr.message);
                // Fail closed on database query error
                return null;
            }
        }

        // Offline test fallback strictly when explicitly running under test environment
        if (process.env.NODE_ENV === 'test') {
            const match = (mockDb.adminUsers || []).find(u => u.email.toLowerCase() === decoded.email.toLowerCase() && u.role === 'admin');
            if (match) return { id: decoded.sub || decoded.email, email: decoded.email, role: 'admin' };
            if (decoded.email === 'admin@vaidyabotanicals.com' || decoded.email === 'owner@vaidyabotanicals.com') {
                return { id: decoded.sub || 'admin_test_id', email: decoded.email, role: 'admin' };
            }
            return null;
        }

        // Supabase fallback if configured
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseAdmin();
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('id, email, role')
                .eq('email', decoded.email)
                .single();
            if (error || !profile || profile.role !== 'admin') return null;
            return profile;
        }

        // Fail closed in staging and production if database is unconfigured
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * Records an audit log entry for admin actions in Neon PostgreSQL or mockDb.
 */
async function logAdminAction(adminEmail, action, targetType, targetId, details = {}) {
    const entry = {
        admin_email: adminEmail,
        action,
        target_type: targetType,
        target_id: targetId,
        details,
        created_at: new Date().toISOString()
    };

    if (isDatabaseConfigured()) {
        try {
            await query(`
                INSERT INTO public.audit_logs (admin_email, action, target_type, target_id, details, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [adminEmail, action, targetType, targetId ? String(targetId) : null, JSON.stringify(details)]);
            return;
        } catch (err) {
            console.error('[Audit Log Neon Error]:', err.message);
        }
    }

    if (isSupabaseConfigured()) {
        try {
            const supabase = getSupabaseAdmin();
            await supabase.from('audit_logs').insert([entry]);
        } catch (err) {
            console.error('[Audit Log Error]:', err.message);
        }
    } else {
        mockDb.auditLogs.unshift(entry);
    }
}

// ==============================================================================
// CUSTOMER AUTHENTICATION (Persistent Neon Sessions + Better Auth Compatibility)
// ==============================================================================

function createCustomerCookie(sessionToken) {
    return cookie.serialize(CUSTOMER_COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_DAYS * 24 * 60 * 60
    });
}

function clearCustomerCookie() {
    return cookie.serialize(CUSTOMER_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
}

/**
 * Sends a passwordless Email OTP using Stytch Consumer Authentication.
 * Enforces rate limiting and normalizes email.
 */
async function sendCustomerOtp({ email, ipAddress = '' }) {
    if (!email) {
        throw new Error('Email address is required');
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Invalid email address format');
    }

    // Rate limit: 3 requests per 60 seconds per email and 10 per IP
    const emailKey = `email:${normalizedEmail}`;
    const ipKey = `ip:${ipAddress || 'unknown'}`;
    if (!checkRateLimit(otpRequestRateLimits, emailKey, 3, 60000) ||
        (ipAddress && !checkRateLimit(otpRequestRateLimits, ipKey, 10, 60000))) {
        throw new Error('Too many verification requests. Please wait a minute before requesting another code.');
    }

    const result = await sendEmailOtp({ email: normalizedEmail, expirationMinutes: 10 });
    return {
        success: true,
        methodId: result.methodId,
        message: 'A 6-digit verification code has been sent to your email.'
    };
}

/**
 * Verifies the Email OTP code against Stytch, creates or links a customer profile in Neon,
 * and issues a secure persistent HTTP-only session cookie.
 */
async function authenticateCustomerOtp({ methodId, code, ipAddress = '', userAgent = '' }) {
    if (!methodId || !code) {
        throw new Error('Verification session ID and code are required');
    }

    const cleanCode = String(code).trim();
    if (!/^\d{6}$/.test(cleanCode)) {
        throw new Error('Verification code must be exactly 6 digits');
    }

    const ipKey = `verify_ip:${ipAddress || 'unknown'}`;
    if (ipAddress && !checkRateLimit(otpVerifyRateLimits, ipKey, 6, 60000)) {
        throw new Error('Too many incorrect verification attempts. Please wait a minute before trying again.');
    }

    // Authenticate with Stytch
    const stytchAuth = await authenticateOtp({ methodId, code: cleanCode, sessionDurationMinutes: SESSION_DAYS * 24 * 60 });
    const normalizedEmail = String(stytchAuth.email || '').trim().toLowerCase();
    const stytchUserId = stytchAuth.stytchUserId;

    if (!normalizedEmail) {
        throw new Error('Email verification failed: No verified email returned by provider');
    }

    // Link or create customer profile in Neon
    let profile = null;

    if (isDatabaseConfigured()) {
        profile = await transaction(async (client) => {
            // 1. Try finding by stytch_user_id
            let res = await client.query(
                'SELECT id, email, full_name, phone, role, created_at FROM public.profiles WHERE stytch_user_id = $1',
                [stytchUserId]
            );
            if (res.rows.length > 0) return res.rows[0];

            // 2. Try finding by email (link external provider)
            res = await client.query(
                'SELECT id, email, full_name, phone, role, created_at FROM public.profiles WHERE email = $1',
                [normalizedEmail]
            );
            if (res.rows.length > 0) {
                const existing = res.rows[0];
                await client.query(
                    'UPDATE public.profiles SET stytch_user_id = $1, updated_at = NOW() WHERE id = $2',
                    [stytchUserId, existing.id]
                );
                return existing;
            }

            // 3. Create new customer profile
            const profileId = `cust_${crypto.randomBytes(12).toString('hex')}`;
            const insertRes = await client.query(`
                INSERT INTO public.profiles (id, email, full_name, phone, role, stytch_user_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'customer', $5, NOW(), NOW())
                RETURNING id, email, full_name, phone, role, created_at
            `, [profileId, normalizedEmail, '', null, stytchUserId]);

            return insertRes.rows[0];
        });
    } else {
        // Fallback for tests
        let user = (mockDb.customerUsers || []).find(
            u => u.stytch_user_id === stytchUserId || u.email === normalizedEmail
        );
        if (!user) {
            user = {
                id: `cust_${crypto.randomBytes(12).toString('hex')}`,
                email: normalizedEmail,
                full_name: '',
                phone: null,
                role: 'customer',
                stytch_user_id: stytchUserId,
                created_at: new Date().toISOString()
            };
            if (!mockDb.customerUsers) mockDb.customerUsers = [];
            mockDb.customerUsers.push(user);
        } else {
            user.stytch_user_id = stytchUserId;
        }
        profile = user;
    }

    return {
        user: {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name || '',
            phone: profile.phone || '',
            role: 'customer'
        },
        sessionToken: stytchAuth.sessionToken,
        cookieHeader: createCustomerCookie(stytchAuth.sessionToken)
    };
}

/**
 * Registers a new customer in Neon PostgreSQL.
 * Strictly assigns role = 'customer' (never allows public escalation to admin).
 */
async function registerCustomer({ email, password, fullName, phone }) {
    if (!email || !password) {
        throw new Error('Email and password are required');
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Invalid email address format');
    }
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
    }

    const cleanName = fullName ? String(fullName).trim() : '';
    const cleanPhone = phone ? String(phone).trim() : null;
    const profileId = `cust_${crypto.randomBytes(12).toString('hex')}`;
    const passwordHash = hashPassword(password);
    const verificationToken = crypto.randomBytes(24).toString('hex');

    if (isDatabaseConfigured()) {
        return await transaction(async (client) => {
            // Check if email already registered
            const existing = await client.query('SELECT id FROM public.profiles WHERE email = $1', [normalizedEmail]);
            if (existing.rows.length > 0) {
                throw new Error('An account with this email address already exists');
            }

            // 1. Insert Profile
            const profRes = await client.query(`
                INSERT INTO public.profiles (id, email, full_name, phone, role, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'customer', NOW(), NOW())
                RETURNING id, email, full_name, phone, role, created_at
            `, [profileId, normalizedEmail, cleanName, cleanPhone]);

            // 2. Insert Auth Credentials
            await client.query(`
                INSERT INTO public.auth_credentials (
                    profile_id, email, password_hash, email_verified, verification_token, created_at, updated_at
                ) VALUES ($1, $2, $3, false, $4, NOW(), NOW())
            `, [profileId, normalizedEmail, passwordHash, verificationToken]);

            return profRes.rows[0];
        });
    } else {
        // Fallback for tests
        const existing = (mockDb.customerUsers || []).find(u => u.email === normalizedEmail);
        if (existing) throw new Error('An account with this email address already exists');

        const newCustomer = {
            id: profileId,
            email: normalizedEmail,
            full_name: cleanName,
            phone: cleanPhone,
            role: 'customer',
            passwordHash,
            email_verified: false,
            verification_token: verificationToken,
            created_at: new Date().toISOString()
        };
        mockDb.customerUsers.push(newCustomer);
        return {
            id: profileId,
            email: normalizedEmail,
            full_name: cleanName,
            phone: cleanPhone,
            role: 'customer'
        };
    }
}

/**
 * Authenticates a customer, creates a persistent session in Neon PostgreSQL,
 * and returns the user profile and session token.
 */
async function loginCustomer({ email, password, ipAddress = '', userAgent = '' }) {
    if (!email || !password) {
        throw new Error('Email and password are required');
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    if (isDatabaseConfigured()) {
        // Retrieve credentials and profile
        const credRes = await query(`
            SELECT c.profile_id, c.password_hash, c.email_verified,
                   p.id, p.email, p.full_name, p.phone, p.role
            FROM public.auth_credentials c
            JOIN public.profiles p ON p.id = c.profile_id
            WHERE c.email = $1
        `, [normalizedEmail]);

        if (credRes.rows.length === 0) {
            throw new Error('Invalid email or password');
        }

        const cred = credRes.rows[0];
        const valid = await verifyPasswordAsync(password, cred.password_hash);
        if (!valid) {
            throw new Error('Invalid email or password');
        }

        // Generate cryptographically secure session token
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

        await query(`
            INSERT INTO public.customer_sessions (profile_id, session_token, expires_at, ip_address, user_agent, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [cred.profile_id, sessionToken, expiresAt, ipAddress, userAgent]);

        return {
            user: {
                id: cred.id,
                email: cred.email,
                full_name: cred.full_name,
                phone: cred.phone,
                role: cred.role,
                email_verified: cred.email_verified
            },
            sessionToken,
            cookieHeader: createCustomerCookie(sessionToken)
        };
    } else {
        // Fallback for tests
        const user = (mockDb.customerUsers || []).find(u => u.email === normalizedEmail);
        if (!user || !verifyPassword(password, user.passwordHash)) {
            throw new Error('Invalid email or password');
        }
        const sessionToken = 'mock_sess_' + crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
        mockDb.customerSessions.push({
            profile_id: user.id,
            session_token: sessionToken,
            expires_at: expiresAt
        });
        return {
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                phone: user.phone,
                role: 'customer'
            },
            sessionToken,
            cookieHeader: createCustomerCookie(sessionToken)
        };
    }
}

/**
 * Validates a customer request against active Stytch sessions and Neon PostgreSQL.
 * Returns authenticated customer profile or null.
 */
async function verifyCustomer(req) {
    try {
        const header = getHeader(req, 'cookie');
        const cookies = cookie.parse(header);
        let token = cookies[CUSTOMER_COOKIE_NAME];

        // Also accept Authorization: Bearer <sessionToken>
        const authHeader = getHeader(req, 'authorization');
        if (!token && authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        }

        if (!token) return null;

        // 1. Primary: Verify via Stytch Consumer Session
        const stytchSession = await authenticateSession(token);
        if (stytchSession && (stytchSession.email || stytchSession.stytchUserId)) {
            const normalizedEmail = stytchSession.email ? String(stytchSession.email).trim().toLowerCase() : '';
            if (isDatabaseConfigured()) {
                const res = await query(`
                    SELECT id, email, full_name, phone, role
                    FROM public.profiles
                    WHERE stytch_user_id = $1 OR (email = $2 AND email != '')
                    LIMIT 1
                `, [stytchSession.stytchUserId, normalizedEmail]);

                if (res.rows.length > 0) return res.rows[0];
            } else {
                const user = (mockDb.customerUsers || []).find(
                    u => u.stytch_user_id === stytchSession.stytchUserId || (normalizedEmail && u.email === normalizedEmail)
                );
                if (user) {
                    return { id: user.id, email: user.email, full_name: user.full_name || '', phone: user.phone || '', role: 'customer' };
                }
            }
        }

        // 2. Fallback: Check legacy database sessions during transition
        if (isDatabaseConfigured()) {
            const res = await query(`
                SELECT p.id, p.email, p.full_name, p.phone, p.role
                FROM public.customer_sessions s
                JOIN public.profiles p ON p.id = s.profile_id
                WHERE s.session_token = $1 AND s.expires_at > NOW()
            `, [token]);

            if (res.rows.length > 0) return res.rows[0];
        } else {
            const sess = (mockDb.customerSessions || []).find(
                s => s.session_token === token && new Date(s.expires_at) > new Date()
            );
            if (!sess) return null;
            const user = (mockDb.customerUsers || []).find(u => u.id === sess.profile_id);
            if (!user) return null;
            return {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                phone: user.phone,
                role: 'customer'
            };
        }
    } catch (err) {
        return null;
    }
}

/**
 * Logs out customer by revoking session on Stytch and Neon PostgreSQL.
 */
async function logoutCustomer(req) {
    try {
        const header = getHeader(req, 'cookie');
        const cookies = cookie.parse(header);
        const token = cookies[CUSTOMER_COOKIE_NAME];

        if (token) {
            // Revoke Stytch session
            await revokeSession(token);

            // Invalidate legacy session if present
            if (isDatabaseConfigured()) {
                await query('DELETE FROM public.customer_sessions WHERE session_token = $1', [token]);
            } else {
                mockDb.customerSessions = (mockDb.customerSessions || []).filter(s => s.session_token !== token);
            }
        }
    } catch (e) {
        // Ignore deletion errors on logout
    }
    return clearCustomerCookie();
}

/**
 * Verifies email verification token.
 */
async function verifyCustomerEmail(token) {
    if (!token) throw new Error('Verification token is required');

    if (isDatabaseConfigured()) {
        const res = await query(`
            UPDATE public.auth_credentials
            SET email_verified = true, verification_token = NULL, updated_at = NOW()
            WHERE verification_token = $1
            RETURNING profile_id, email
        `, [token]);
        if (res.rows.length === 0) throw new Error('Invalid or expired verification token');
        return { success: true, email: res.rows[0].email };
    } else {
        const user = (mockDb.customerUsers || []).find(u => u.verification_token === token);
        if (!user) throw new Error('Invalid or expired verification token');
        user.email_verified = true;
        user.verification_token = null;
        return { success: true, email: user.email };
    }
}

/**
 * Initiates password recovery.
 */
async function requestPasswordReset(email) {
    if (!email) throw new Error('Email is required');
    const normalizedEmail = String(email).trim().toLowerCase();
    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    if (isDatabaseConfigured()) {
        const res = await query(`
            UPDATE public.auth_credentials
            SET reset_token = $1, reset_expires_at = $2, updated_at = NOW()
            WHERE email = $3
            RETURNING email
        `, [resetToken, resetExpires, normalizedEmail]);
        return { success: true, resetToken: res.rows.length > 0 ? resetToken : null };
    } else {
        const user = (mockDb.customerUsers || []).find(u => u.email === normalizedEmail);
        if (user) {
            user.reset_token = resetToken;
            user.reset_expires_at = resetExpires;
        }
        return { success: true, resetToken: user ? resetToken : null };
    }
}

/**
 * Resets customer password using recovery token.
 */
async function resetCustomerPassword(token, newPassword) {
    if (!token || !newPassword) throw new Error('Token and new password are required');
    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters long');
    const newHash = hashPassword(newPassword);

    if (isDatabaseConfigured()) {
        const res = await query(`
            UPDATE public.auth_credentials
            SET password_hash = $1, reset_token = NULL, reset_expires_at = NULL, updated_at = NOW()
            WHERE reset_token = $2 AND reset_expires_at > NOW()
            RETURNING profile_id, email
        `, [newHash, token]);
        if (res.rows.length === 0) throw new Error('Invalid or expired password reset token');
        return { success: true, email: res.rows[0].email };
    } else {
        const user = (mockDb.customerUsers || []).find(
            u => u.reset_token === token && new Date(u.reset_expires_at) > new Date()
        );
        if (!user) throw new Error('Invalid or expired password reset token');
        user.passwordHash = newHash;
        user.reset_token = null;
        user.reset_expires_at = null;
        return { success: true, email: user.email };
    }
}

module.exports = {
    // Admin
    createAdminToken,
    createAdminCookie,
    clearAdminCookie,
    verifyAdmin,
    logAdminAction,
    hashPassword,
    verifyPassword,
    verifyPasswordAsync,
    COOKIE_NAME: ADMIN_COOKIE_NAME,
    ADMIN_COOKIE_NAME,

    // Customer
    CUSTOMER_COOKIE_NAME,
    createCustomerCookie,
    clearCustomerCookie,
    sendCustomerOtp,
    authenticateCustomerOtp,
    registerCustomer,
    loginCustomer,
    verifyCustomer,
    logoutCustomer,
    verifyCustomerEmail,
    requestPasswordReset,
    resetCustomerPassword
};
