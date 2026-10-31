const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseClient, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { section } = req.query || {};

        if (isDatabaseConfigured()) {
            if (section) {
                const result = await query('SELECT key, data, updated_at FROM public.site_content WHERE key = $1', [section]);
                if (result.rows.length === 0) return res.status(404).json({ error: 'Section not found' });
                return res.status(200).json({ key: result.rows[0].key, data: result.rows[0].data });
            }

            const result = await query('SELECT key, data, updated_at FROM public.site_content');
            const contentMap = {};
            result.rows.forEach(row => {
                contentMap[row.key] = row.data;
            });
            return res.status(200).json({ content: contentMap });
        }

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            let q = supabase.from('site_content').select('key, data, updated_at');
            if (section) {
                const { data, error } = await q.eq('key', section).single();
                if (error || !data) return res.status(404).json({ error: 'Section not found' });
                return res.status(200).json({ key: data.key, data: data.data });
            }
            const { data, error } = await q;
            if (error) throw error;
            const contentMap = {};
            (data || []).forEach(row => {
                contentMap[row.key] = row.data;
            });
            return res.status(200).json({ content: contentMap });
        }

        if (section) {
            const found = mockDb.content[section];
            if (!found) return res.status(404).json({ error: 'Section not found' });
            return res.status(200).json({ key: section, data: found });
        }
        return res.status(200).json({ content: mockDb.content });
    } catch (err) {
        console.error('[Content API Error]:', err);
        return res.status(500).json({ error: 'Failed to fetch site content' });
    }
};
