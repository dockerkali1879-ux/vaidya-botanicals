const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function generateOrderNumber() {
    return 'VD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

module.exports = async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const { user, address, items, subtotal, shipping, total, payment } = body;

            if (!items || !items.length || !address) {
                return res.status(400).json({ error: 'Order items and shipping address are required' });
            }

            const orderNumber = generateOrderNumber();
            const customerEmail = (user && user.method === 'email') ? user.value : (address.email || 'customer@example.com');
            const customerPhone = (address.phone) || (user && user.method === 'phone' ? user.value : '');
            const customerName = address.name || 'Valued Customer';
            const paymentMethod = payment?.method || 'COD';

            // Security requirement: COD orders remain payment-pending until collected
            // Online payments must be verified before marking paid
            const paymentStatus = (paymentMethod === 'razorpay' && payment?.paymentId) ? 'pending' : 'pending';

            const newOrder = {
                order_number: orderNumber,
                customer_email: customerEmail,
                customer_phone: customerPhone,
                customer_name: customerName,
                shipping_address: address,
                items,
                subtotal: parseFloat(subtotal) || 0,
                shipping: parseFloat(shipping) || 0,
                total: parseFloat(total) || 0,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                order_status: 'new',
                razorpay_order_id: payment?.orderId || null,
                razorpay_payment_id: payment?.paymentId || null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('orders').insert([newOrder]).select().single();
                if (error) throw error;
                return res.status(201).json({ success: true, order: data });
            } else {
                newOrder.id = 'ord-' + Date.now().toString(36);
                mockDb.orders.unshift(newOrder);
                return res.status(201).json({ success: true, order: newOrder });
            }
        } catch (err) {
            console.error('[Create Order Error]:', err);
            return res.status(500).json({ error: err.message || 'Order creation failed' });
        }
    }

    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
