const { verifyCustomer } = require('../../lib/auth');
const { isDatabaseConfigured, transaction, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');
const { clearCustomerCart } = require('../../lib/cart');
const { consumeVerificationProof } = require('../../lib/phone-verification');

function generateOrderNumber() {
    return 'VD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

module.exports = async function handler(req, res) {
    // 1. GET: Customer Order History (Strictly isolated by customer_id if session present)
    if (req.method === 'GET') {
        const customer = await verifyCustomer(req);
        if (!customer) {
            return res.status(401).json({ error: 'Authentication required to view order history' });
        }

        try {
            if (isDatabaseConfigured()) {
                const result = await query(
                    'SELECT * FROM public.orders WHERE customer_id = $1 ORDER BY created_at DESC',
                    [customer.id]
                );
                return res.status(200).json({ success: true, orders: result.rows });
            }

            // Fallback for tests
            const list = (mockDb.orders || []).filter(o => o.customer_id === customer.id || o.customer_email === customer.email);
            return res.status(200).json({ success: true, orders: list });
        } catch (err) {
            console.error('[Customer Orders History Error]:', err);
            return res.status(500).json({ error: 'Failed to retrieve order history' });
        }
    }

    // 2. POST: Create New Guest Order (Phone OTP Verified)
    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const { address, items, payment, verification_proof, verificationProof } = body;
            const proof = verification_proof || verificationProof;

            if (!items || !Array.isArray(items) || items.length === 0 || !address) {
                return res.status(400).json({ error: 'Order items and delivery address are required' });
            }

            // Strictly validate all cart items and quantities upfront before database execution
            const validatedItems = [];
            for (const cartItem of items) {
                if (!cartItem || typeof cartItem !== 'object') {
                    return res.status(400).json({ error: 'Invalid order item format' });
                }
                const itemLookup = cartItem.id || cartItem.slug;
                if (!itemLookup) {
                    return res.status(400).json({ error: 'Each order item must specify a product ID or slug' });
                }
                const rawQty = cartItem.qty !== undefined ? cartItem.qty : cartItem.quantity;
                const qty = Number(rawQty);
                if (!Number.isInteger(qty) || qty <= 0) {
                    return res.status(400).json({
                        error: `Invalid quantity for item "${cartItem.name || itemLookup}". Quantity must be a positive integer.`
                    });
                }
                if (qty > 100) {
                    return res.status(400).json({
                        error: `Quantity for item "${cartItem.name || itemLookup}" exceeds maximum allowed order limit of 100 units.`
                    });
                }
                validatedItems.push({ ...cartItem, itemLookup, qty });
            }

            // 1. Extract and validate buyer information
            const buyerName = String(address.customer_name || address.buyer_name || address.name || '').trim();
            const buyerEmail = String(address.customer_email || address.buyer_email || address.email || '').trim().toLowerCase();
            const buyerPhone = String(address.customer_phone || address.buyer_phone || address.phone || '').trim();

            if (!buyerName) {
                return res.status(400).json({ error: 'Buyer full name is required' });
            }
            if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
                return res.status(400).json({ error: 'Valid email address is required' });
            }
            if (!buyerPhone) {
                return res.status(400).json({ error: 'Buyer mobile number is required' });
            }
            if (!proof) {
                return res.status(400).json({ error: 'Mobile phone OTP verification proof is required to place an order' });
            }

            // 2. Validate mandatory delivery address fields
            const addressLine1 = String(address.l1 || address.address_line1 || address.street || '').trim();
            const addressLine2 = String(address.l2 || address.address_line2 || address.locality || '').trim();
            const city = String(address.city || '').trim();
            const state = String(address.state || '').trim();
            const postalCode = String(address.pin || address.postal_code || '').trim();
            const landmark = String(address.landmark || '').trim();

            if (!addressLine1 || !addressLine2 || !city || !state || !postalCode) {
                return res.status(400).json({ error: 'Complete delivery address (Street, Locality, City, State, PIN) is required' });
            }
            if (!/^\d{6}$/.test(postalCode)) {
                return res.status(400).json({ error: 'Please enter a valid 6-digit PIN code' });
            }

            // 3. Separate buyer from optional gift recipient
            const isGift = Boolean(address.is_gift);
            const recipientName = isGift ? String(address.recipient_name || buyerName).trim() : buyerName;
            const recipientPhone = isGift ? String(address.recipient_phone || buyerPhone).trim() : buyerPhone;

            if (isGift && (!recipientName || !recipientPhone)) {
                return res.status(400).json({ error: 'Gift recipient name and phone are required for gift orders' });
            }

            const shippingAddressSnapshot = {
                recipient_name: recipientName,
                recipient_phone: recipientPhone,
                buyer_name: buyerName,
                buyer_phone: buyerPhone,
                email: buyerEmail,
                address_line1: addressLine1,
                address_line2: addressLine2,
                city,
                state,
                postal_code: postalCode,
                landmark,
                is_gift: isGift
            };

            const requestedPaymentMethod = String(payment?.method || 'COD').trim().toUpperCase();
            if (requestedPaymentMethod === 'RAZORPAY') {
                return res.status(400).json({
                    error: 'Online payments via Razorpay are temporarily disabled for initial launch. Please select Cash on Delivery (COD).'
                });
            }
            if (requestedPaymentMethod !== 'COD') {
                return res.status(400).json({ error: 'Unsupported payment method. Only Cash on Delivery is currently supported.' });
            }
            const paymentMethod = 'COD';
            const paymentStatus = 'pending';
            const orderNumber = generateOrderNumber();
            // Server-authoritative shipping fee computation
            // Client-supplied body.shipping is strictly ignored to prevent fee tampering
            const shippingCharge = 0; // Free delivery across India for initial launch

            // 4. Neon PostgreSQL Transaction: Proof Consumption, Stock Decrement & Order Creation
            if (isDatabaseConfigured()) {
                const createdOrder = await transaction(async (client) => {
                    // Step A: Atomically validate and consume phone verification proof
                    const proofRecord = await consumeVerificationProof(client, proof, buyerPhone);

                    // Step B: Authoritative catalog verification & atomic stock decrement (FOR UPDATE)
                    const snapshottedItems = [];
                    let calculatedSubtotal = 0;

                    for (const cartItem of validatedItems) {
                        const itemLookup = cartItem.itemLookup;
                        const qty = cartItem.qty;

                        const prodRes = await client.query(
                            'SELECT id, slug, name, price, stock, unit, is_published, is_archived FROM public.products WHERE (id::text = $1 OR slug = $1) FOR UPDATE',
                            [itemLookup]
                        );

                        if (prodRes.rows.length === 0) {
                            throw new Error(`Product not found in catalog: ${itemLookup}`);
                        }

                        const prod = prodRes.rows[0];
                        if (!prod.is_published || prod.is_archived) {
                            throw new Error(`Product "${prod.name}" is no longer available`);
                        }

                        if (prod.stock < qty) {
                            throw new Error(`Insufficient stock for "${prod.name}". Available: ${prod.stock}, requested: ${qty}`);
                        }

                        // Decrement stock atomically
                        await client.query(
                            'UPDATE public.products SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
                            [qty, prod.id]
                        );

                        const unitPrice = parseFloat(prod.price);
                        calculatedSubtotal += unitPrice * qty;

                        snapshottedItems.push({
                            id: prod.id,
                            slug: prod.slug,
                            name: prod.name,
                            price: unitPrice,
                            qty,
                            unit: prod.unit
                        });
                    }

                    const finalTotal = calculatedSubtotal + shippingCharge;

                    // Step C: Insert complete order record (Guest order: customer_id is NULL)
                    const orderInsert = await client.query(`
                        INSERT INTO public.orders (
                            order_number,
                            customer_id,
                            customer_email,
                            customer_phone,
                            customer_name,
                            recipient_name,
                            recipient_phone,
                            manual_verification_status,
                            phone_verified,
                            phone_verified_at,
                            shipping_address,
                            items,
                            subtotal,
                            shipping,
                            total,
                            payment_method,
                            payment_status,
                            order_status,
                            razorpay_order_id,
                            razorpay_payment_id,
                            created_at,
                            updated_at
                        ) VALUES (
                            $1, NULL, $2, $3, $4, $5, $6, 'unverified', true, $7, $8, $9, $10, $11, $12, $13, $14, 'new', $15, $16, NOW(), NOW()
                        ) RETURNING *
                    `, [
                        orderNumber,
                        buyerEmail,
                        proofRecord.phone,
                        buyerName,
                        recipientName,
                        recipientPhone,
                        proofRecord.verifiedAt,
                        JSON.stringify(shippingAddressSnapshot),
                        JSON.stringify(snapshottedItems),
                        calculatedSubtotal,
                        shippingCharge,
                        finalTotal,
                        paymentMethod,
                        paymentStatus,
                        payment?.orderId || null,
                        payment?.paymentId || null
                    ]);

                    return orderInsert.rows[0];
                });

                return res.status(201).json({ success: true, order: createdOrder });
            }

            // 5. Fallback for offline / mock testing
            const proofRecord = await consumeVerificationProof(null, proof, buyerPhone);
            const mockSubtotal = validatedItems.reduce((sum, i) => sum + (parseFloat(i.price) || 0) * i.qty, 0);
            const mockShipping = shippingCharge;
            const newOrder = {
                id: 'ord-' + Date.now().toString(36),
                order_number: orderNumber,
                customer_id: null,
                customer_email: buyerEmail,
                customer_phone: proofRecord.phone,
                customer_name: buyerName,
                recipient_name: recipientName,
                recipient_phone: recipientPhone,
                phone_verified: true,
                phone_verified_at: proofRecord.verifiedAt,
                manual_verification_status: 'unverified',
                shipping_address: shippingAddressSnapshot,
                items: validatedItems.map(i => ({ id: i.id || i.itemLookup, slug: i.slug, name: i.name, price: parseFloat(i.price) || 0, qty: i.qty, unit: i.unit })),
                subtotal: mockSubtotal,
                shipping: mockShipping,
                total: mockSubtotal + mockShipping,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                order_status: 'new',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            mockDb.orders.unshift(newOrder);
            return res.status(201).json({ success: true, order: newOrder });
        } catch (err) {
            console.error('[Create Order Error]:', err.message);
            return res.status(400).json({ error: err.message || 'Order creation failed' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
