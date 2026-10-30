require('dotenv').config();

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const BUSINESS_OWNER_PHONE = process.env.BUSINESS_OWNER_PHONE || '+919876543210';

function isWhatsAppConfigured() {
    return Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN && !PHONE_NUMBER_ID.includes('your_') && !ACCESS_TOKEN.includes('your_'));
}

// In-memory set for deduplication of notifications
const sentEventsCache = new Set();

/**
 * Builds formatted text message based on ecommerce event
 */
function buildMessageText(eventType, order) {
    const orderNum = order.order_number || order.orderId || 'VD-ORDER';
    const totalStr = `$${Number(order.total || 0).toFixed(2)}`;
    const custName = order.customer_name || order.address?.name || 'Customer';
    const payMethod = order.payment_method || order.payment?.method || 'COD';

    switch (eventType) {
        case 'NEW_ORDER':
        case 'COD_RECORDED':
            return `🌿 *[Vaidya Botanicals] New Order Received!*\n\nOrder Ref: *${orderNum}*\nCustomer: ${custName}\nTotal: *${totalStr}* (${payMethod})\nItems: ${(order.items || []).map(i => `${i.name} (x${i.qty})`).join(', ')}\nDelivery To: ${order.shipping_address?.city || order.address?.city || 'India'}\n\nInspect in Admin Console: /admin`;

        case 'PAYMENT_CONFIRMED':
            return `🌿 *[Vaidya Botanicals] Payment Verified!*\n\nOrder Ref: *${orderNum}*\nPayment Method: Razorpay Online\nAmount: *${totalStr}*\nStatus: Payment Verified by Server.\nReady for packaging.`;

        case 'ORDER_DISPATCHED':
            return `🌿 *[Vaidya Botanicals] Your Order is On Its Way!*\n\nOrder Ref: *${orderNum}*\nCourier: *${order.courier_name || 'Expedited Partner'}*\nTracking Code: *${order.tracking_number || 'Pending'}*\n\nYour fresh botanical package is in transit.`;

        case 'ORDER_DELIVERED':
            return `🌿 *[Vaidya Botanicals] Order Successfully Delivered!*\n\nOrder Ref: *${orderNum}*\nCustomer: ${custName}\nDelivery Completed: ${new Date().toLocaleString()}\n\nThank you for choosing Vaidya Botanical Wellness.`;

        default:
            return `🌿 *[Vaidya Botanicals] Order Update for ${orderNum}* - Status: ${eventType}`;
    }
}

/**
 * Dispatches WhatsApp template or text notification via Cloud API.
 */
async function sendWhatsAppNotification({ eventType, orderData, recipientPhone = null }) {
    const orderNum = orderData.order_number || orderData.orderId || 'VD-DEFAULT';
    const cacheKey = `${eventType}-${orderNum}`;

    // Deduplication check
    if (sentEventsCache.has(cacheKey)) {
        console.log(`[WhatsApp] Skipped duplicate notification event: ${cacheKey}`);
        return { success: true, duplicate: true };
    }

    const targetPhone = recipientPhone || BUSINESS_OWNER_PHONE;
    const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
    const messageBody = buildMessageText(eventType, orderData);

    if (isWhatsAppConfigured()) {
        try {
            const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'text',
                text: { body: messageBody }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (!response.ok) {
                console.error('[WhatsApp Cloud API Error]:', result);
                return { success: false, error: result };
            }

            sentEventsCache.add(cacheKey);
            console.log(`[WhatsApp] Notification sent to ${cleanPhone} for event ${eventType}`);
            return { success: true, messageId: result.messages?.[0]?.id };
        } catch (err) {
            console.error('[WhatsApp Network Error]:', err.message);
            return { success: false, error: err.message };
        }
    } else {
        // Development logging simulation
        sentEventsCache.add(cacheKey);
        console.log('\n======================================================');
        console.log(`[WhatsApp Notification Logged (Dev Fallback)] -> ${cleanPhone}`);
        console.log(`Event: ${eventType}`);
        console.log(messageBody);
        console.log('======================================================\n');
        return { success: true, simulated: true };
    }
}

module.exports = {
    isWhatsAppConfigured,
    sendWhatsAppNotification,
    buildMessageText
};

