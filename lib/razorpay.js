const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

function isRazorpayConfigured() {
    return Boolean(KEY_ID && KEY_SECRET && !KEY_ID.includes('yourKey') && !KEY_SECRET.includes('yourRazorpay'));
}

let razorpayInstance = null;
if (isRazorpayConfigured()) {
    razorpayInstance = new Razorpay({
        key_id: KEY_ID,
        key_secret: KEY_SECRET
    });
}

/**
 * Creates an authorized server-side order with Razorpay.
 */
async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay is not configured with valid server credentials.');
    }

    const options = {
        amount: Math.round(amount * 100), // Convert to subunits (paise)
        currency,
        receipt: receipt || `rec_${Date.now()}`,
        notes
    };

    return await razorpayInstance.orders.create(options);
}

/**
 * Cryptographically verifies Razorpay payment signature via HMAC-SHA256.
 * NEVER mark payment paid on frontend callback alone.
 */
function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    if (!isRazorpayConfigured()) {
        return false;
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return false;
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
        .createHmac('sha256', KEY_SECRET)
        .update(payload)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(razorpay_signature, 'utf8')
    );
}

module.exports = {
    isRazorpayConfigured,
    getKeyId: () => KEY_ID,
    createOrder,
    verifyPaymentSignature
};

