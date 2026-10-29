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
            const { status, id } = req.query || {};

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });

                if (id) {
                    const { data, error } = await query.eq('id', id).single();
                    if (error || !data) return res.status(404).json({ error: 'Ticket not found' });
                    return res.status(200).json({ ticket: data });
                }

                if (status && status !== 'all') query = query.eq('status', status);

                const { data, error } = await query;
                if (error) throw error;
                return res.status(200).json({ tickets: data || [] });
            } else {
                let list = [...mockDb.supportTickets];
                if (id) {
                    const found = list.find(t => t.id === id);
                    if (!found) return res.status(404).json({ error: 'Ticket not found' });
                    return res.status(200).json({ ticket: found });
                }
                if (status && status !== 'all') list = list.filter(t => t.status === status);
                return res.status(200).json({ tickets: list });
            }
        }

        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id) return res.status(400).json({ error: 'Ticket ID is required' });

            const updates = {
                status: body.status,
                internal_notes: body.internal_notes,
                updated_at: new Date().toISOString()
            };

            Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('support_tickets').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_SUPPORT_TICKET', 'support_tickets', id, updates);
                return res.status(200).json({ success: true, ticket: data });
            } else {
                const idx = mockDb.supportTickets.findIndex(t => t.id === id);
                if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
                mockDb.supportTickets[idx] = { ...mockDb.supportTickets[idx], ...updates };
                await logAdminAction(admin.email, 'UPDATE_SUPPORT_TICKET', 'support_tickets', id, updates);
                return res.status(200).json({ success: true, ticket: mockDb.supportTickets[idx] });
            }
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Support API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
