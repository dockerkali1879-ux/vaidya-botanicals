/**
 * VAIDYA BOTANICALS - Checkout Phone OTP Request Endpoint
 * Dispatches an SMS verification code to the buyer's phone number during guest checkout.
 */

const { sendPhoneOtp } = require('../../../lib/phone-verification');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { phone } = req.body || {};
        if (!phone) {
            return res.status(400).json({ error: 'Mobile number is required' });
        }

        const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const ipAddress = Array.isArray(ip) ? ip[0] : String(ip).split(',')[0].trim();

        const result = await sendPhoneOtp({
            phone,
            ipAddress
        });

        return res.status(200).json({
            success: true,
            challenge_id: result.challengeId,
            retry_after: 60,
            message: result.message
        });
    } catch (err) {
        const statusCode = err.statusCode || 400;
        console.error('[Checkout Phone OTP Send Error]:', err.message);
        return res.status(statusCode).json({
            error: err.message || 'Failed to send verification code',
            retry_after: err.retryAfter
        });
    }
};
