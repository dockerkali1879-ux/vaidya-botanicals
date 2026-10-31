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
            if (isDatabaseConfigured()) {
                const result = await query('SELECT key, data, updated_at FROM public.site_content');
                const contentMap = {};
                result.rows.forEach(row => {
                    contentMap[row.key] = row.data;
                });
                return res.status(200).json({ content: contentMap });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('site_content').select('*');
                if (error) throw error;
                const contentMap = {};
                (data || []).forEach(row => {
                    contentMap[row.key] = row.data;
                });
                return res.status(200).json({ content: contentMap });
            }

            return res.status(200).json({ content: mockDb.content });
        }

        if (method === 'PUT') {
            const { key, data } = req.body || {};
            if (!key || !data || typeof data !== 'object') {
                return res.status(400).json({ error: 'Section key and data object are required' });
            }

            if (isDatabaseConfigured()) {
                const upsertRes = await query(`
                    INSERT INTO public.site_content (key, data, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (key) DO UPDATE
                    SET data = $2, updated_at = NOW()
                    RETURNING key, data, updated_at
                `, [key, JSON.stringify(data)]);

                const updated = upsertRes.rows[0];
                await logAdminAction(admin.email, 'UPDATE_CONTENT', 'site_content', key, { key });
                return res.status(200).json({ success: true, key: updated.key, data: updated.data });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data: updated, error } = await supabase
                    .from('site_content')
                    .upsert({ key, data, updated_at: new Date().toISOString() })
                    .select()
                    .single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_CONTENT', 'site_content', key, { key });
                return res.status(200).json({ success: true, key: updated.key, data: updated.data });
            }

            mockDb.content[key] = { ...(mockDb.content[key] || {}), ...data };
            await logAdminAction(admin.email, 'UPDATE_CONTENT', 'site_content', key, { key });
            return res.status(200).json({ success: true, key, data: mockDb.content[key] });
        }

        res.setHeader('Allow', ['GET', 'PUT']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Content API Error]:', err);
        return res.status(500).json({ error: 'Failed to update content' });
    }
};
