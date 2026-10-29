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
            const { status, payment_status, search, id } = req.query || {};

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let query = supabase.from('orders').select('*').order('created_at', { ascending: false });

                if (id) {
                    const { data, error } = await query.eq('id', id).single();
                    if (error || !data) return res.status(404).json({ error: 'Order not found' });
                    return res.status(200).json({ order: data });
                }

                if (status && status !== 'all') query = query.eq('order_status', status);
                if (payment_status && payment_status !== 'all') query = query.eq('payment_status', payment_status);

                const { data, error } = await query;
                if (error) throw error;

                let filtered = data || [];
                if (search) {
                    const q = search.toLowerCase();
                    filtered = filtered.filter(o =>
                        o.order_number.toLowerCase().includes(q) ||
                        o.customer_name.toLowerCase().includes(q) ||
                        o.customer_email.toLowerCase().includes(q) ||
                        o.customer_phone.includes(q)
                    );
                }

                return res.status(200).json({ orders: filtered });
            } else {
                let list = [...mockDb.orders];

                if (id) {
                    const found = list.find(o => o.id === id);
                    if (!found) return res.status(404).json({ error: 'Order not found' });
                    return res.status(200).json({ order: found });
                }

                if (status && status !== 'all') list = list.filter(o => o.order_status === status);
                if (payment_status && payment_status !== 'all') list = list.filter(o => o.payment_status === payment_status);
                if (search) {
                    const q = search.toLowerCase();
                    list = list.filter(o =>
                        o.order_number.toLowerCase().includes(q) ||
                        o.customer_name.toLowerCase().includes(q) ||
                        o.customer_email.toLowerCase().includes(q) ||
                        o.customer_phone.includes(q)
                    );
                }

                return res.status(200).json({ orders: list });
            }
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id) return res.status(400).json({ error: 'Order ID is required' });

            const updates = {
                order_status: body.order_status,
                payment_status: body.payment_status,
                courier_name: body.courier_name,
                tracking_number: body.tracking_number,
                admin_notes: body.admin_notes,
                updated_at: new Date().toISOString()
            };

            if (body.order_status === 'delivered') {
                updates.delivered_at = new Date().toISOString();
            }

            Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('orders').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_ORDER', 'orders', id, updates);
                return res.status(200).json({ success: true, order: data });
            } else {
                const idx = mockDb.orders.findIndex(o => o.id === id);
                if (idx === -1) return res.status(404).json({ error: 'Order not found' });
                mockDb.orders[idx] = { ...mockDb.orders[idx], ...updates };
                await logAdminAction(admin.email, 'UPDATE_ORDER', 'orders', id, updates);
                return res.status(200).json({ success: true, order: mockDb.orders[idx] });
            }
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Orders API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
