const { loginCustomer } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, password } = req.body || {};

        const auth = await loginCustomer({
            email,
            password,
            ipAddress: req.socket?.remoteAddress,
            userAgent: req.headers['user-agent']
        });

        res.setHeader('Set-Cookie', auth.cookieHeader);
        return res.status(200).json({
            success: true,
            message: 'Customer logged in successfully.',
            user: auth.user
        });
    } catch (err) {
        return res.status(401).json({ error: err.message || 'Invalid credentials' });
    }
};

