/**
 * VAIDYA BOTANICALS - Checkout Phone OTP Verification Endpoint
 * Validates the buyer's 4-to-6 digit OTP code and issues a short-lived one-time checkout proof.
 */

const { verifyPhoneOtp } = require('../../../lib/phone-verification');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { challenge_id, code, otp } = req.body || {};
        const verificationCode = code || otp;
        if (!challenge_id || !verificationCode) {
            return res.status(400).json({ error: 'Challenge identifier and verification code are required' });
        }

        const result = await verifyPhoneOtp({
            challengeId: challenge_id,
            code: verificationCode
        });

        return res.status(200).json({
            success: true,
            phone: result.phone,
            verification_proof: result.verificationProof,
            message: 'Phone number verified successfully'
        });
    } catch (err) {
        console.error('[Checkout Phone OTP Verify Error]:', err.message);
        return res.status(400).json({ error: err.message || 'Verification failed' });
    }
};
