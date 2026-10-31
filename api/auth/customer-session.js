const { verifyCustomer } = require('../../lib/auth');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const customer = await verifyCustomer(req);
        if (!customer) {
            return res.status(200).json({ authenticated: false, user: null });
        }

        return res.status(200).json({
            authenticated: true,
            user: {
                id: customer.id,
                email: customer.email,
                full_name: customer.full_name,
                phone: customer.phone,
                role: 'customer'
            }
        });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to verify session' });
    }
};

