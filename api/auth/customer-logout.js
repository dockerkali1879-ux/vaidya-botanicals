const { logoutCustomer } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const clearCookie = await logoutCustomer(req);
        res.setHeader('Set-Cookie', clearCookie);
        return res.status(200).json({ success: true, message: 'Customer logged out successfully.' });
    } catch (err) {
        return res.status(500).json({ error: 'Logout failed' });
    }
};

