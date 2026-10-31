const { verifyCustomerEmail } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token } = req.body || req.query || {};
        const result = await verifyCustomerEmail(token);
        return res.status(200).json({ success: true, message: 'Email address verified successfully.', email: result.email });
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Verification failed' });
    }
};

