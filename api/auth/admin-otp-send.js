/**
 * VAIDYA BOTANICALS - Administrator Phone OTP Send API
 * Initiates an SMS OTP challenge to the strictly server-configured administrator mobile number.
 * Never accepts or trusts an arbitrary phone number from the browser request.
 */

const { sendAdminPhoneOtp } = require('../../lib/phone-verification');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
        const env = req.env || process.env;

        const result = await sendAdminPhoneOtp({
            ipAddress: clientIp,
            env
        });

        return res.status(200).json({
            success: true,
            challenge_id: result.challengeId,
            masked_phone: result.maskedPhone,
            message: result.message
        });
    } catch (err) {
        const statusCode = err.statusCode || (err.message.includes('Too many') || err.message.includes('Please wait') ? 429 : 400);
        return res.status(statusCode).json({
            error: err.message,
            retry_after: err.retryAfter || null
        });
    }
};

