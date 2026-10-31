/**
 * VAIDYA BOTANICALS - Cart Merge API Endpoint
 * Merges anonymous guest items into an authenticated customer's persistent Neon cart.
 */

const { verifyCustomer } = require('../../lib/auth');
const { mergeGuestCart } = require('../../lib/cart');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const customer = await verifyCustomer(req);
    if (!customer) {
        return res.status(401).json({ error: 'Authentication required to merge cart' });
    }

    try {
        const { guestItems, items: altItems } = req.body || {};
        const items = Array.isArray(guestItems) ? guestItems : (Array.isArray(altItems) ? altItems : []);

        const mergedCart = await mergeGuestCart(customer.id, items);
        return res.status(200).json({
            success: true,
            cart: mergedCart
        });
    } catch (err) {
        console.error('[Cart Merge Error]:', err);
        return res.status(500).json({ error: err.message || 'Failed to merge cart' });
    }
};
