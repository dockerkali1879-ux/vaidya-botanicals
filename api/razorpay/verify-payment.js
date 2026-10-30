const { verifyPaymentSignature, isRazorpayConfigured } = require('../../lib/razorpay');
const { sendWhatsAppNotification } = require('../../lib/whatsapp');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { order_number, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

        if (!order_number || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing required payment verification parameters' });
        }

        if (!isRazorpayConfigured()) {
            return res.status(503).json({
                error: 'Razorpay gateway is not configured with valid server credentials. Cannot verify payments.'
            });
        }

        // Strict server-side HMAC SHA-256 signature verification
        const isValidSignature = verifyPaymentSignature({
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        });

        if (!isValidSignature) {
            console.error(`[Razorpay Security Alert] Invalid payment signature for order ${order_number}!`);

            // Mark order as failed in database
            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                await supabase
                    .from('orders')
                    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
                    .eq('order_number', order_number);
            } else {
                const ord = mockDb.orders.find(o => o.order_number === order_number);
                if (ord) ord.payment_status = 'failed';
            }

            return res.status(400).json({
                success: false,
                verified: false,
                error: 'Payment verification failed: Invalid cryptographic signature.'
            });
        }

        // Cryptographically verified signature: Mark payment paid
        let updatedOrder = null;
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseAdmin();
            const { data, error } = await supabase
                .from('orders')
                .update({
                    payment_status: 'paid',
                    razorpay_order_id,
                    razorpay_payment_id,
                    razorpay_signature,
                    updated_at: new Date().toISOString()
                })
                .eq('order_number', order_number)
                .select()
                .single();

            if (error) throw error;
            updatedOrder = data;
        } else {
            const ord = mockDb.orders.find(o => o.order_number === order_number);
            if (ord) {
                ord.payment_status = 'paid';
                ord.razorpay_order_id = razorpay_order_id;
                ord.razorpay_payment_id = razorpay_payment_id;
                ord.razorpay_signature = razorpay_signature;
                updatedOrder = ord;
            }
        }

        // Dispatch automated WhatsApp notification for confirmed payment
        if (updatedOrder) {
            await sendWhatsAppNotification({
                eventType: 'PAYMENT_CONFIRMED',
                orderData: updatedOrder
            });
        }

        return res.status(200).json({
            success: true,
            verified: true,
            message: 'Payment verified and recorded successfully by server.',
            order_number
        });
    } catch (err) {
        console.error('[Verify Payment Error]:', err);
        return res.status(500).json({ error: 'Server payment verification error' });
    }
};

