const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function formatOrder(o) {
    if (!o) return o;
    return {
        ...o,
        subtotal: parseFloat(o.subtotal) || 0,
        shipping: parseFloat(o.shipping) || 0,
        total: parseFloat(o.total) || 0
    };
}

module.exports = async function handler(req, res) {
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    const method = req.method;

    try {
        if (method === 'GET') {
            const { status, payment_status, search, id } = req.query || {};

            if (isDatabaseConfigured()) {
                if (id) {
                    const result = await query('SELECT * FROM public.orders WHERE id::text = $1', [id]);
                    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
                    return res.status(200).json({ order: formatOrder(result.rows[0]) });
                }

                let sql = 'SELECT * FROM public.orders WHERE 1=1';
                const params = [];

                if (status && status !== 'all') {
                    params.push(status);
                    sql += ` AND order_status = $${params.length}`;
                }

                if (payment_status && payment_status !== 'all') {
                    params.push(payment_status);
                    sql += ` AND payment_status = $${params.length}`;
                }

                if (search && search.trim()) {
                    params.push(`%${search.trim()}%`);
                    sql += ` AND (order_number ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR customer_email ILIKE $${params.length} OR customer_phone ILIKE $${params.length})`;
                }

                sql += ' ORDER BY created_at DESC';

                const result = await query(sql, params);
                return res.status(200).json({ orders: result.rows.map(formatOrder) });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let q = supabase.from('orders').select('*').order('created_at', { ascending: false });
                if (id) {
                    const { data, error } = await q.eq('id', id).single();
                    if (error || !data) return res.status(404).json({ error: 'Order not found' });
                    return res.status(200).json({ order: data });
                }
                if (status && status !== 'all') q = q.eq('order_status', status);
                if (payment_status && payment_status !== 'all') q = q.eq('payment_status', payment_status);
                const { data, error } = await q;
                if (error) throw error;
                let filtered = data || [];
                if (search) {
                    const s = search.toLowerCase();
                    filtered = filtered.filter(o =>
                        o.order_number.toLowerCase().includes(s) ||
                        o.customer_name.toLowerCase().includes(s) ||
                        o.customer_email.toLowerCase().includes(s)
                    );
                }
                return res.status(200).json({ orders: filtered });
            }

            let list = [...(mockDb.orders || [])];
            if (id) {
                const found = list.find(o => o.id === id);
                if (!found) return res.status(404).json({ error: 'Order not found' });
                return res.status(200).json({ order: found });
            }
            if (status && status !== 'all') list = list.filter(o => o.order_status === status);
            if (payment_status && payment_status !== 'all') list = list.filter(o => o.payment_status === payment_status);
            if (search) {
                const s = search.toLowerCase();
                list = list.filter(o =>
                    o.order_number.toLowerCase().includes(s) ||
                    o.customer_name.toLowerCase().includes(s) ||
                    o.customer_email.toLowerCase().includes(s)
                );
            }
            return res.status(200).json({ orders: list });
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id || body.order_id;
            if (!id) return res.status(400).json({ error: 'Order ID is required' });

            if (isDatabaseConfigured()) {
                const fields = [];
                const values = [];
                const allowed = ['order_status', 'payment_status', 'courier_name', 'tracking_number', 'admin_notes', 'manual_verification_status', 'verification_notes'];

                allowed.forEach(k => {
                    if (body[k] !== undefined) {
                        values.push(body[k]);
                        fields.push(`${k} = $${values.length}`);
                    }
                });

                if (body.manual_verification_status && body.manual_verification_status !== 'unverified') {
                    fields.push('verified_at = NOW()');
                }

                if (body.order_status === 'delivered') {
                    fields.push('delivered_at = NOW()');
                }

                if (fields.length === 0) {
                    return res.status(400).json({ error: 'No update parameters provided' });
                }

                fields.push('updated_at = NOW()');
                values.push(id);
                const sql = `UPDATE public.orders SET ${fields.join(', ')} WHERE id::text = $${values.length} RETURNING *`;
                const updateRes = await query(sql, values);

                if (updateRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                const updated = updateRes.rows[0];
                await logAdminAction(admin.email, 'UPDATE_ORDER', 'orders', id, body);
                return res.status(200).json({ success: true, order: formatOrder(updated) });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const updates = { ...body, updated_at: new Date().toISOString() };
                if (body.order_status === 'delivered') updates.delivered_at = new Date().toISOString();
                delete updates.id;
                const { data, error } = await supabase.from('orders').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_ORDER', 'orders', id, updates);
                return res.status(200).json({ success: true, order: data });
            }

            const idx = (mockDb.orders || []).findIndex(o => o.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Order not found' });
            mockDb.orders[idx] = { ...mockDb.orders[idx], ...body, updated_at: new Date().toISOString() };
            if (body.order_status === 'delivered') mockDb.orders[idx].delivered_at = new Date().toISOString();
            await logAdminAction(admin.email, 'UPDATE_ORDER', 'orders', id, body);
            return res.status(200).json({ success: true, order: mockDb.orders[idx] });
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Orders API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
