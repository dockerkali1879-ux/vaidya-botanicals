const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('./supabase');
require('dotenv').config();

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'dev_jwt_secret_vaidya_botanicals_2026';
const COOKIE_NAME = 'vaidya_admin_token';
const TOKEN_EXPIRY = '7d';

/**
 * Creates a signed JWT for an administrator.
 */
function createAdminToken(user) {
    return jwt.sign(
        {
            sub: user.id || user.email,
            email: user.email,
            role: 'admin'
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

/**
 * Creates HTTP-only Set-Cookie header string for admin session.
 */
function createAdminCookie(token) {
    return cookie.serialize(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 // 7 days in seconds
    });
}

/**
 * Clears the admin cookie.
 */
function clearAdminCookie() {
    return cookie.serialize(COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
}

/**
 * Extracts and verifies the admin session from an incoming HTTP request.
 * Returns decoded user or null.
 */
async function verifyAdmin(req) {
    try {
        const header = req.headers.cookie || '';
        const cookies = cookie.parse(header);
        const token = cookies[COOKIE_NAME];

        if (!token) return null;

        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded || decoded.role !== 'admin') return null;

        // If Supabase is live, double check profile status in database
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseAdmin();
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('id, email, role')
                .eq('email', decoded.email)
                .single();

            if (error || !profile || profile.role !== 'admin') {
                return null;
            }
            return profile;
        }

        return decoded;
    } catch (err) {
        return null;
    }
}

/**
 * Records an audit log entry for admin actions.
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

module.exports = {
    createAdminToken,
    createAdminCookie,
    clearAdminCookie,
    verifyAdmin,
    logAdminAction,
    COOKIE_NAME
};
