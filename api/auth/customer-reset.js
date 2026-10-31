const { requestPasswordReset, resetCustomerPassword } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, email, token, password } = req.body || {};

        if (action === 'request' || email) {
            const result = await requestPasswordReset(email);
            return res.status(200).json({
                success: true,
                message: 'If an account matches that email, password reset instructions have been issued.',
                reset_token: process.env.NODE_ENV !== 'production' ? result.resetToken : undefined
            });
        }

        if (action === 'reset' || token) {
            const result = await resetCustomerPassword(token, password);
            return res.status(200).json({
                success: true,
                message: 'Password has been successfully updated.',
                email: result.email
            });
        }

        return res.status(400).json({ error: 'Invalid reset request' });
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Password reset failed' });
    }
};

