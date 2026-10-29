const { clearAdminCookie, logAdminAction, verifyAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const admin = await verifyAdmin(req);
        if (admin) {
            await logAdminAction(admin.email, 'LOGOUT', 'auth', admin.id || 'admin', {});
        }

        res.setHeader('Set-Cookie', clearAdminCookie());
        return res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};
