const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isDatabaseConfigured, query } = require('../../lib/db');
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

            if (isDatabaseConfigured()) {
                let sql = 'SELECT * FROM public.reviews WHERE 1=1';
                const params = [];

                if (status && status !== 'all') {
                    params.push(status);
                    sql += ` AND status = $${params.length}`;
                }

                if (product_id) {
                    params.push(product_id);
                    sql += ` AND product_id::text = $${params.length}`;
                }

                sql += ' ORDER BY created_at DESC';
                const result = await query(sql, params);
                return res.status(200).json({ reviews: result.rows });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let q = supabase.from('reviews').select('*').order('created_at', { ascending: false });
                if (status && status !== 'all') q = q.eq('status', status);
                if (product_id) q = q.eq('product_id', product_id);
                const { data, error } = await q;
                if (error) throw error;
                return res.status(200).json({ reviews: data || [] });
            }

            let list = [...(mockDb.reviews || [])];
            if (status && status !== 'all') list = list.filter(r => r.status === status);
            if (product_id) list = list.filter(r => r.product_id === product_id);
            return res.status(200).json({ reviews: list });
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id || !body.status) return res.status(400).json({ error: 'Review ID and status are required' });

            const validStatuses = ['pending', 'approved', 'rejected', 'hidden'];
            if (!validStatuses.includes(body.status)) {
                return res.status(400).json({ error: 'Invalid review status' });
            }

            if (isDatabaseConfigured()) {
                const updateRes = await query(`
                    UPDATE public.reviews
                    SET status = $1, moderated_by = $2, moderated_at = NOW(), updated_at = NOW()
                    WHERE id::text = $3
                    RETURNING *
                `, [body.status, admin.id || null, id]);

                if (updateRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Review not found' });
                }

                const updated = updateRes.rows[0];
                await logAdminAction(admin.email, 'MODERATE_REVIEW', 'reviews', id, { status: body.status });
                return res.status(200).json({ success: true, review: updated });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const updates = {
                    status: body.status,
                    moderated_by: admin.id || null,
                    moderated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                const { data, error } = await supabase.from('reviews').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'MODERATE_REVIEW', 'reviews', id, { status: body.status });
                return res.status(200).json({ success: true, review: data });
            }

            const idx = (mockDb.reviews || []).findIndex(r => r.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Review not found' });
            mockDb.reviews[idx] = {
                ...mockDb.reviews[idx],
                status: body.status,
                moderated_by: admin.id || null,
                moderated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            await logAdminAction(admin.email, 'MODERATE_REVIEW', 'reviews', id, { status: body.status });
            return res.status(200).json({ success: true, review: mockDb.reviews[idx] });
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Reviews API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
