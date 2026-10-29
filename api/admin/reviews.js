const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    const method = req.method;

    try {
        if (method === 'GET') {
            const { status, product_id } = req.query || {};

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let query = supabase.from('reviews').select('*').order('created_at', { ascending: false });

                if (status && status !== 'all') query = query.eq('status', status);
                if (product_id) query = query.eq('product_id', product_id);

                const { data, error } = await query;
                if (error) throw error;
                return res.status(200).json({ reviews: data || [] });
            } else {
                let list = [...mockDb.reviews];
                if (status && status !== 'all') list = list.filter(r => r.status === status);
                if (product_id) list = list.filter(r => r.product_id === product_id);
                return res.status(200).json({ reviews: list });
            }
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id || !body.status) return res.status(400).json({ error: 'Review ID and status are required' });

            const validStatuses = ['pending', 'approved', 'rejected', 'hidden'];
            if (!validStatuses.includes(body.status)) {
                return res.status(400).json({ error: 'Invalid review status' });
            }

            const updates = {
                status: body.status,
                moderated_by: admin.id || null,
                moderated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('reviews').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'MODERATE_REVIEW', 'reviews', id, { status: body.status });
                return res.status(200).json({ success: true, review: data });
            } else {
                const idx = mockDb.reviews.findIndex(r => r.id === id);
                if (idx === -1) return res.status(404).json({ error: 'Review not found' });
                mockDb.reviews[idx] = { ...mockDb.reviews[idx], ...updates };
                await logAdminAction(admin.email, 'MODERATE_REVIEW', 'reviews', id, { status: body.status });
                return res.status(200).json({ success: true, review: mockDb.reviews[idx] });
            }
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Reviews API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
