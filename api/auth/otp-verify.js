/**
 * VAIDYA BOTANICALS - Customer Email OTP Verification Endpoint
 * Verifies code with Stytch, links/creates customer in Neon, and sets persistent session cookie.
 */

const { authenticateCustomerOtp } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { method_id, code } = req.body || {};
        if (!method_id || !code) {
            return res.status(400).json({ error: 'Verification session and 6-digit code are required' });
        }

        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const userAgent = req.headers['user-agent'] || '';

        const result = await authenticateCustomerOtp({
            methodId: method_id,
            code,
            ipAddress: Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim(),
            userAgent
        });

        res.setHeader('Set-Cookie', result.cookieHeader);
        return res.status(200).json({
            success: true,
            user: result.user
        });
    } catch (err) {
        console.error('[OTP Verify Error]:', err.message);
        return res.status(400).json({ error: err.message || 'Verification failed' });
    }
};

