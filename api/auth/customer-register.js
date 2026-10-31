const { registerCustomer, loginCustomer } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, password, full_name, fullName, phone } = req.body || {};
        const name = full_name || fullName;

        const profile = await registerCustomer({
            email,
            password,
            fullName: name,
            phone
        });

        // Automatically create session and log customer in
        const auth = await loginCustomer({
            email,
            password,
            ipAddress: req.socket?.remoteAddress,
            userAgent: req.headers['user-agent']
        });

        res.setHeader('Set-Cookie', auth.cookieHeader);
        return res.status(201).json({
            success: true,
            message: 'Customer registered and authenticated successfully.',
            user: auth.user
        });
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Registration failed' });
    }
};

