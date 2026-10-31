const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, getSupabaseClient, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const { product_id, customer_name, customer_email, rating, title, comment } = req.body || {};

            if (!product_id || !customer_name || !customer_email || !rating || !comment) {
                return res.status(400).json({ error: 'product_id, name, email, rating, and comment are required' });
            }

            const numRating = parseInt(rating, 10);
            if (numRating < 1 || numRating > 5) {
                return res.status(400).json({ error: 'Rating must be between 1 and 5' });
            }

            const normalizedEmail = customer_email.trim().toLowerCase();
            let isVerifiedPurchase = false;

            if (isDatabaseConfigured()) {
                // Check if customer purchased this product
                const ordersRes = await query(
                    'SELECT items FROM public.orders WHERE LOWER(customer_email) = $1',
                    [normalizedEmail]
                );

                for (const ord of ordersRes.rows) {
                    const items = Array.isArray(ord.items) ? ord.items : [];
                    if (items.some(i => i.id === product_id || i.slug === product_id)) {
                        isVerifiedPurchase = true;
                        break;
                    }
                }

                // Verify product exists in Neon
                const prodCheck = await query(
                    'SELECT id FROM public.products WHERE (id::text = $1 OR slug = $1) LIMIT 1',
                    [product_id]
                );
                if (prodCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }
                const resolvedProductId = prodCheck.rows[0].id;

                const insertRes = await query(`
                    INSERT INTO public.reviews (
                        product_id, customer_name, customer_email, rating, title, comment,
                        verified_purchase, status, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, 'pending', NOW(), NOW()
                    ) RETURNING id
                `, [
                    resolvedProductId, customer_name.trim(), normalizedEmail, numRating,
                    title ? title.trim() : '', comment.trim(), isVerifiedPurchase
                ]);

                return res.status(201).json({
                    success: true,
                    message: 'Thank you! Your botanical review has been submitted for moderation.',
                    review_id: insertRes.rows[0].id
                });
            }

            // Fallback for tests
            const customerOrders = (mockDb.orders || []).filter(o => o.customer_email.toLowerCase() === normalizedEmail);
            for (const ord of customerOrders) {
                const items = Array.isArray(ord.items) ? ord.items : [];
                if (items.some(i => i.id === product_id || i.slug === product_id)) {
                    isVerifiedPurchase = true;
                    break;
                }
            }

            const newReview = {
                id: 'rev-' + Date.now().toString(36),
                product_id,
                customer_name: customer_name.trim(),
                customer_email: normalizedEmail,
                rating: numRating,
                title: title ? title.trim() : '',
                comment: comment.trim(),
                verified_purchase: isVerifiedPurchase,
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            mockDb.reviews.unshift(newReview);
            return res.status(201).json({
                success: true,
                message: 'Thank you! Your botanical review has been submitted for moderation.',
                review_id: newReview.id
            });
        } catch (err) {
            console.error('[Submit Review Error]:', err);
            return res.status(500).json({ error: 'Failed to submit review' });
        }
    }

    if (req.method === 'GET') {
        try {
            const { product_id } = req.query || {};
            if (!product_id) return res.status(400).json({ error: 'product_id is required' });

            if (isDatabaseConfigured()) {
                const result = await query(`
                    SELECT id, product_id, customer_name, rating, title, comment, verified_purchase, created_at
                    FROM public.reviews
                    WHERE (product_id::text = $1 OR product_id IN (SELECT id FROM public.products WHERE slug = $1))
                      AND status = 'approved'
                    ORDER BY created_at DESC
                `, [product_id]);

                if (result.rows.length === 0 && Array.isArray(mockDb.reviews) && mockDb.reviews.length > 0) {
                    const list = mockDb.reviews.filter(r => (r.product_id === product_id || r.product_slug === product_id) && r.status === 'approved');
                    if (list.length > 0) {
                        return res.status(200).json({
                            reviews: list.map(r => ({
                                id: r.id,
                                product_id: r.product_id,
                                customer_name: r.customer_name,
                                rating: r.rating,
                                title: r.title,
                                comment: r.comment,
                                verified_purchase: r.verified_purchase,
                                created_at: r.created_at
                            }))
                        });
                    }
                }

                return res.status(200).json({ reviews: result.rows });
            }

            const list = (mockDb.reviews || []).filter(r => (r.product_id === product_id || r.product_slug === product_id) && r.status === 'approved');
            return res.status(200).json({
                reviews: list.map(r => ({
                    id: r.id,
                    product_id: r.product_id,
                    customer_name: r.customer_name,
                    rating: r.rating,
                    title: r.title,
                    comment: r.comment,
                    verified_purchase: r.verified_purchase,
                    created_at: r.created_at
                }))
            });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to fetch reviews' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
