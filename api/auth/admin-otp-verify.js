/**
 * VAIDYA BOTANICALS - Administrator Phone OTP Verification API
 * Verifies OTP code, validates administrator privileges in Neon, and issues an HttpOnly session cookie.
 */

const { verifyAdminPhoneOtp } = require('../../lib/phone-verification');
const { createAdminToken, createAdminCookie, logAdminAction } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { challenge_id, otp } = req.body || {};
        const env = req.env || process.env;

        if (!challenge_id || !otp) {
            return res.status(400).json({ error: 'challenge_id and otp are required' });
        }

        // 1. Verify administrator OTP and confirm Neon admin role
        const result = await verifyAdminPhoneOtp({
            challengeId: challenge_id,
            code: otp,
            env
        });

        const admin = result.admin;

        // 2. Issue 8-hour HttpOnly session cookie
        const jwtSecret = env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET;
        const token = createAdminToken(admin, jwtSecret);
        res.setHeader('Set-Cookie', createAdminCookie(token));

        // 3. Log audit event
        await logAdminAction(admin.email, 'LOGIN_PHONE_OTP', 'auth', admin.id, {
            ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
        });

        return res.status(200).json({
            success: true,
            message: 'Administrator authenticated successfully via Phone OTP',
            user: {
                id: admin.id,
                email: admin.email,
                role: 'admin'
            }
        });
    } catch (err) {
        return res.status(400).json({
            error: err.message
        });
    }
};

