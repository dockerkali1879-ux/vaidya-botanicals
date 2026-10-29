const { isSupabaseConfigured, getSupabaseClient, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { section } = req.query || {};

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            let query = supabase.from('site_content').select('key, data, updated_at');

            if (section) {
                const { data, error } = await query.eq('key', section).single();
                if (error || !data) return res.status(404).json({ error: 'Section not found' });
                return res.status(200).json({ key: data.key, data: data.data });
            }

            const { data, error } = await query;
            if (error) throw error;

            const contentMap = {};
            (data || []).forEach(row => {
                contentMap[row.key] = row.data;
            });

            return res.status(200).json({ content: contentMap });
        } else {
            // Local dev fallback
            if (section) {
                const found = mockDb.content[section];
                if (!found) return res.status(404).json({ error: 'Section not found' });
                return res.status(200).json({ key: section, data: found });
            }
            return res.status(200).json({ content: mockDb.content });
        }
    } catch (err) {
        console.error('[Content API Error]:', err);
        return res.status(500).json({ error: 'Failed to fetch site content' });
    }
};
