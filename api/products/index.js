const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseClient, mockDb } = require('../../lib/supabase');

function formatProduct(p) {
    if (!p) return p;
    return {
        ...p,
        price: parseFloat(p.price) || 0,
        compare_at_price: p.compare_at_price !== null && p.compare_at_price !== undefined ? parseFloat(p.compare_at_price) : null,
        stock: parseInt(p.stock, 10) || 0,
        sort_order: parseInt(p.sort_order, 10) || 0
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { slug, category, search, featured } = req.query || {};

        // 1. Neon PostgreSQL Database
        if (isDatabaseConfigured()) {
            try {
                if (slug) {
                    const result = await query(
                        'SELECT * FROM public.products WHERE slug = $1 AND is_published = true AND is_archived = false LIMIT 1',
                        [slug]
                    );
                    if (result.rows.length === 0) {
                        return res.status(404).json({ error: 'Product not found' });
                    }
                    return res.status(200).json({ product: formatProduct(result.rows[0]) });
                }

                let sql = 'SELECT * FROM public.products WHERE is_published = true AND is_archived = false';
                const params = [];

                if (category && category !== 'all') {
                    params.push(category);
                    sql += ` AND category = $${params.length}`;
                }

                if (featured === 'true') {
                    sql += ' AND is_featured = true';
                }

                if (search && search.trim()) {
                    params.push(`%${search.trim()}%`);
                    sql += ` AND (name ILIKE $${params.length} OR short_description ILIKE $${params.length} OR ingredients ILIKE $${params.length})`;
                }

                sql += ' ORDER BY sort_order ASC, created_at DESC';

                const result = await query(sql, params);
                return res.status(200).json({ products: result.rows.map(formatProduct) });
            } catch (dbErr) {
                // Fall back gracefully to mockDb if database connection is unreachable in offline tests
            }
        }

        // 2. Fallback to Supabase if configured
        if (isSupabaseConfigured()) {
            const supabase = getSupabaseClient();
            let q = supabase
                .from('products')
                .select('*')
                .eq('is_published', true)
                .eq('is_archived', false)
                .order('sort_order', { ascending: true });

            if (slug) {
                const { data, error } = await q.eq('slug', slug).single();
                if (error || !data) return res.status(404).json({ error: 'Product not found' });
                return res.status(200).json({ product: data });
            }

            if (category && category !== 'all') q = q.eq('category', category);
            if (featured === 'true') q = q.eq('is_featured', true);

            const { data, error } = await q;
            if (error) throw error;

            let filtered = data || [];
            if (search) {
                const s = search.toLowerCase();
                filtered = filtered.filter(p =>
                    p.name.toLowerCase().includes(s) ||
                    (p.short_description && p.short_description.toLowerCase().includes(s))
                );
            }
            return res.status(200).json({ products: filtered });
        }

        // 3. Local Mock fallback
        let list = mockDb.products.filter(p => p.is_published && !p.is_archived);
        if (slug) {
            const found = mockDb.products.find(p => p.slug === slug);
            if (!found) return res.status(404).json({ error: 'Product not found' });
            return res.status(200).json({ product: found });
        }
        if (category && category !== 'all') list = list.filter(p => p.category === category);
        if (featured === 'true') list = list.filter(p => p.is_featured);
        if (search) {
            const s = search.toLowerCase();
            list = list.filter(p =>
                p.name.toLowerCase().includes(s) ||
                (p.short_description && p.short_description.toLowerCase().includes(s))
            );
        }
        list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        return res.status(200).json({ products: list });
    } catch (err) {
        console.error('[Products API Error]:', err);
        return res.status(500).json({ error: 'Failed to fetch products' });
    }
};
