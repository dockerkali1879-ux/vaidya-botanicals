const { verifyAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const admin = await verifyAdmin(req);

        if (!admin) {
            return res.status(401).json({ authenticated: false, error: 'Unauthenticated' });
        }

        return res.status(200).json({
            authenticated: true,
            user: {
                email: admin.email,
                role: 'admin'
            }
        });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};
