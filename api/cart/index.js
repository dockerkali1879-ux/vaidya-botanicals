/**
 * VAIDYA BOTANICALS - Cart API Endpoint
 * Handles GET (retrieve active customer cart) and PUT (update customer cart).
 */

const { verifyCustomer } = require('../../lib/auth');
const { getCustomerCart, saveCustomerCart } = require('../../lib/cart');

module.exports = async function handler(req, res) {
    const customer = await verifyCustomer(req);

    if (req.method === 'GET') {
        if (!customer) {
            return res.status(200).json({
                authenticated: false,
                cart: { items: [], subtotal: 0, totalItems: 0, warnings: [] }
            });
        }

        try {
            const cart = await getCustomerCart(customer.id);
            return res.status(200).json({
                authenticated: true,
                cart
            });
        } catch (err) {
            console.error('[Get Cart Error]:', err);
            return res.status(500).json({ error: 'Failed to retrieve shopping cart' });
        }
    }

    if (req.method === 'PUT') {
        if (!customer) {
            return res.status(401).json({ error: 'Authentication required to persist cart' });
        }

        try {
            const { items } = req.body || {};
            if (!Array.isArray(items)) {
                return res.status(400).json({ error: 'Items array is required' });
            }

            const updatedCart = await saveCustomerCart(customer.id, items);
            return res.status(200).json({
                success: true,
                cart: updatedCart
            });
        } catch (err) {
            console.error('[Save Cart Error]:', err);
            return res.status(500).json({ error: 'Failed to update shopping cart' });
        }
    }

    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
};

