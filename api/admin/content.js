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
            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('site_content').select('*');
                if (error) throw error;

                const contentMap = {};
                (data || []).forEach(row => {
                    contentMap[row.key] = row.data;
                });
                return res.status(200).json({ content: contentMap });
            } else {
                return res.status(200).json({ content: mockDb.content });
            }
        }

        if (method === 'PUT') {
            const { key, data } = req.body || {};
            if (!key || !data || typeof data !== 'object') {
                return res.status(400).json({ error: 'Section key and data object are required' });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data: updated, error } = await supabase
                    .from('site_content')
                    .upsert({
                        key,
                        data,
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_CONTENT', 'site_content', key, { key });
                return res.status(200).json({ success: true, key: updated.key, data: updated.data });
            } else {
                mockDb.content[key] = { ...(mockDb.content[key] || {}), ...data };
                await logAdminAction(admin.email, 'UPDATE_CONTENT', 'site_content', key, { key });
                return res.status(200).json({ success: true, key, data: mockDb.content[key] });
            }
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Content API Error]:', err);
        return res.status(500).json({ error: err.message || 'Content update failed' });
    }
};
