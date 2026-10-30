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

            // Check if customer purchased this product
            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data: customerOrders } = await supabase
                    .from('orders')
                    .select('items, order_status, payment_status')
                    .eq('customer_email', normalizedEmail);

                if (customerOrders && customerOrders.length) {
                    for (const ord of customerOrders) {
                        const items = Array.isArray(ord.items) ? ord.items : [];
                        if (items.some(i => i.id === product_id || i.slug === product_id)) {
                            isVerifiedPurchase = true;
                            break;
                        }
                    }
                }
            } else {
                const customerOrders = mockDb.orders.filter(o => o.customer_email.toLowerCase() === normalizedEmail);
                for (const ord of customerOrders) {
                    const items = Array.isArray(ord.items) ? ord.items : [];
                    if (items.some(i => i.id === product_id || i.slug === product_id)) {
                        isVerifiedPurchase = true;
                        break;
                    }
                }
            }

            const newReview = {
                product_id,
                customer_name: customer_name.trim(),
                customer_email: normalizedEmail,
                rating: numRating,
                title: title ? title.trim() : '',
                comment: comment.trim(),
                verified_purchase: isVerifiedPurchase,
                status: 'pending', // Requires admin moderation
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('reviews').insert([newReview]).select().single();
                if (error) throw error;
                return res.status(201).json({
                    success: true,
                    message: 'Thank you! Your botanical review has been submitted for moderation.',
                    review_id: data.id
                });
            } else {
                newReview.id = 'rev-' + Date.now().toString(36);
                mockDb.reviews.unshift(newReview);
                return res.status(201).json({
                    success: true,
                    message: 'Thank you! Your botanical review has been submitted for moderation.',
                    review_id: newReview.id
                });
            }
        } catch (err) {
            console.error('[Submit Review Error]:', err);
            return res.status(500).json({ error: 'Failed to submit review' });
        }
    }

    if (req.method === 'GET') {
        try {
            const { product_id } = req.query || {};
            if (!product_id) return res.status(400).json({ error: 'product_id is required' });

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseClient();
                const { data, error } = await supabase
                    .from('reviews')
                    .select('id, product_id, customer_name, rating, title, comment, verified_purchase, created_at')
                    .eq('product_id', product_id)
                    .eq('status', 'approved')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                return res.status(200).json({ reviews: data || [] });
            } else {
                const approved = mockDb.reviews
                    .filter(r => r.product_id === product_id && r.status === 'approved')
                    .map(r => ({
                        id: r.id,
                        product_id: r.product_id,
                        customer_name: r.customer_name,
                        rating: r.rating,
                        title: r.title,
                        comment: r.comment,
                        verified_purchase: r.verified_purchase,
                        created_at: r.created_at
                    }));
                return res.status(200).json({ reviews: approved });
            }
        } catch (err) {
            return res.status(500).json({ error: 'Failed to fetch reviews' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
