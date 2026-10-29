const { isSupabaseConfigured, getSupabaseClient, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { slug, category, search, featured } = req.query || {};

        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            let query = supabase
                .from('products')
                .select('*')
                .eq('is_published', true)
                .eq('is_archived', false)
                .order('sort_order', { ascending: true });

            if (slug) {
                const { data, error } = await query.eq('slug', slug).single();
                if (error || !data) return res.status(404).json({ error: 'Product not found' });
                return res.status(200).json({ product: data });
            }

            if (category && category !== 'all') {
                query = query.eq('category', category);
            }
            if (featured === 'true') {
                query = query.eq('is_featured', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            let filtered = data || [];
            if (search) {
                const q = search.toLowerCase();
                filtered = filtered.filter(p =>
                    p.name.toLowerCase().includes(q) ||
                    (p.short_description && p.short_description.toLowerCase().includes(q)) ||
                    (p.ingredients && p.ingredients.toLowerCase().includes(q))
                );
            }

            return res.status(200).json({ products: filtered });
        } else {
            // Local dev fallback
            let list = mockDb.products.filter(p => p.is_published && !p.is_archived);

            if (slug) {
                const found = mockDb.products.find(p => p.slug === slug);
                if (!found) return res.status(404).json({ error: 'Product not found' });
                return res.status(200).json({ product: found });
            }

            if (category && category !== 'all') {
                list = list.filter(p => p.category === category);
            }
            if (featured === 'true') {
                list = list.filter(p => p.is_featured);
            }
            if (search) {
                const q = search.toLowerCase();
                list = list.filter(p =>
                    p.name.toLowerCase().includes(q) ||
                    (p.short_description && p.short_description.toLowerCase().includes(q)) ||
                    (p.ingredients && p.ingredients.toLowerCase().includes(q))
                );
            }

            list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            return res.status(200).json({ products: list });
        }
    } catch (err) {
        console.error('[Products API Error]:', err);
        return res.status(500).json({ error: 'Failed to fetch products' });
    }
};
