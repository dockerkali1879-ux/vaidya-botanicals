const { isRazorpayConfigured, createOrder, getKeyId } = require('../../lib/razorpay');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        if (!isRazorpayConfigured()) {
            return res.status(503).json({
                error: 'Razorpay gateway is not configured with live credentials. Please select Cash on Delivery or configure your API keys.'
            });
        }

        const { amount, receipt, notes } = req.body || {};
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid order amount is required' });
        }

        const order = await createOrder({
            amount: parseFloat(amount),
            currency: 'INR',
            receipt,
            notes
        });

        return res.status(200).json({
            success: true,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: getKeyId()
        });
    } catch (err) {
        console.error('[Razorpay Create Order Error]:', err);
        return res.status(500).json({ error: err.message || 'Payment initiation failed' });
    }
};

