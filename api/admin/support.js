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
            const { status, id } = req.query || {};

            if (isDatabaseConfigured()) {
                if (id) {
                    const result = await query('SELECT * FROM public.support_tickets WHERE id::text = $1', [id]);
                    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
                    return res.status(200).json({ ticket: result.rows[0] });
                }

                let sql = 'SELECT * FROM public.support_tickets WHERE 1=1';
                const params = [];
                if (status && status !== 'all') {
                    params.push(status);
                    sql += ` AND status = $${params.length}`;
                }
                sql += ' ORDER BY created_at DESC';
                const result = await query(sql, params);
                return res.status(200).json({ tickets: result.rows });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let q = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
                if (id) {
                    const { data, error } = await q.eq('id', id).single();
                    if (error || !data) return res.status(404).json({ error: 'Ticket not found' });
                    return res.status(200).json({ ticket: data });
                }
                if (status && status !== 'all') q = q.eq('status', status);
                const { data, error } = await q;
                if (error) throw error;
                return res.status(200).json({ tickets: data || [] });
            }

            let list = [...(mockDb.supportTickets || [])];
            if (id) {
                const found = list.find(t => t.id === id);
                if (!found) return res.status(404).json({ error: 'Ticket not found' });
                return res.status(200).json({ ticket: found });
            }
            if (status && status !== 'all') list = list.filter(t => t.status === status);
            return res.status(200).json({ tickets: list });
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id) return res.status(400).json({ error: 'Ticket ID is required' });

            if (isDatabaseConfigured()) {
                const fields = [];
                const values = [];
                if (body.status !== undefined) {
                    values.push(body.status);
                    fields.push(`status = $${values.length}`);
                }
                if (body.internal_notes !== undefined) {
                    values.push(body.internal_notes);
                    fields.push(`internal_notes = $${values.length}`);
                }
                if (fields.length === 0) {
                    return res.status(400).json({ error: 'No update parameters provided' });
                }
                fields.push('updated_at = NOW()');
                values.push(id);

                const updateRes = await query(`
                    UPDATE public.support_tickets
                    SET ${fields.join(', ')}
                    WHERE id::text = $${values.length}
                    RETURNING *
                `, values);

                if (updateRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Ticket not found' });
                }

                const updated = updateRes.rows[0];
                await logAdminAction(admin.email, 'UPDATE_SUPPORT_TICKET', 'support_tickets', id, body);
                return res.status(200).json({ success: true, ticket: updated });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const updates = { ...body, updated_at: new Date().toISOString() };
                delete updates.id;
                const { data, error } = await supabase.from('support_tickets').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_SUPPORT_TICKET', 'support_tickets', id, updates);
                return res.status(200).json({ success: true, ticket: data });
            }

            const idx = (mockDb.supportTickets || []).findIndex(t => t.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
            mockDb.supportTickets[idx] = { ...mockDb.supportTickets[idx], ...body, updated_at: new Date().toISOString() };
            await logAdminAction(admin.email, 'UPDATE_SUPPORT_TICKET', 'support_tickets', id, body);
            return res.status(200).json({ success: true, ticket: mockDb.supportTickets[idx] });
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Support API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
