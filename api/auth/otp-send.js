/**
 * VAIDYA BOTANICALS - Customer Email OTP Request Endpoint
 * Sends a passwordless one-time verification passcode via Stytch Consumer Authentication.
 */

const { sendCustomerOtp } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email } = req.body || {};
        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const result = await sendCustomerOtp({
            email,
            ipAddress: Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim()
        });

        return res.status(200).json({
            success: true,
            method_id: result.methodId,
            message: result.message
        });
    } catch (err) {
        console.error('[OTP Send Error]:', err.message);
        return res.status(400).json({ error: err.message || 'Failed to send verification code' });
    }
};

