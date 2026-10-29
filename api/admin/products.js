const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

module.exports = async function handler(req, res) {
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    const method = req.method;

    try {
        // 1. GET ALL PRODUCTS
        if (method === 'GET') {
            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: false });

                if (error) throw error;
                return res.status(200).json({ products: data || [] });
            } else {
                return res.status(200).json({ products: mockDb.products });
            }
        }

        // 2. CREATE PRODUCT (OR DUPLICATE)
        if (method === 'POST') {
            const body = req.body || {};

            // Action: Duplicate
            if (req.query?.action === 'duplicate' || body.action === 'duplicate') {
                const targetId = req.query?.id || body.id;
                let original = null;

                if (isSupabaseConfigured()) {
                    const supabase = getSupabaseAdmin();
                    const { data, error } = await supabase.from('products').select('*').eq('id', targetId).single();
                    if (error || !data) return res.status(404).json({ error: 'Original product not found' });
                    original = data;
                } else {
                    original = mockDb.products.find(p => p.id === targetId);
                    if (!original) return res.status(404).json({ error: 'Original product not found' });
                }

                const duplicated = {
                    ...original,
                    name: `${original.name} (Copy)`,
                    slug: `${original.slug}-copy-${Date.now().toString(36)}`,
                    is_published: false, // Draft by default
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                delete duplicated.id;

                if (isSupabaseConfigured()) {
                    const supabase = getSupabaseAdmin();
                    const { data, error } = await supabase.from('products').insert([duplicated]).select().single();
                    if (error) throw error;
                    await logAdminAction(admin.email, 'DUPLICATE_PRODUCT', 'products', data.id, { name: data.name });
                    return res.status(201).json({ success: true, product: data });
                } else {
                    duplicated.id = 'prod-' + Date.now().toString(36);
                    mockDb.products.unshift(duplicated);
                    await logAdminAction(admin.email, 'DUPLICATE_PRODUCT', 'products', duplicated.id, { name: duplicated.name });
                    return res.status(201).json({ success: true, product: duplicated });
                }
            }

            // Action: Standard Create
            const name = body.name ? body.name.trim() : '';
            if (!name) return res.status(400).json({ error: 'Product name is required' });

            const slug = body.slug ? slugify(body.slug) : slugify(name);
            const price = parseFloat(body.price) || 0;
            const stock = parseInt(body.stock, 10) || 0;

            const newProduct = {
                name,
                slug,
                category: body.category || 'tea',
                health_segment: body.health_segment || '',
                price,
                compare_at_price: body.compare_at_price ? parseFloat(body.compare_at_price) : null,
                stock,
                unit: body.unit || '/ 100g',
                short_description: body.short_description || '',
                description: body.description || '',
                ingredients: body.ingredients || '',
                usage_instructions: body.usage_instructions || '',
                storage_precautions: body.storage_precautions || '',
                badge: body.badge || '',
                images: Array.isArray(body.images) ? body.images : [],
                is_published: Boolean(body.is_published),
                is_featured: Boolean(body.is_featured),
                is_archived: false,
                sort_order: parseInt(body.sort_order, 10) || 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('products').insert([newProduct]).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'CREATE_PRODUCT', 'products', data.id, { name: data.name });
                return res.status(201).json({ success: true, product: data });
            } else {
                newProduct.id = 'prod-' + Date.now().toString(36);
                mockDb.products.unshift(newProduct);
                await logAdminAction(admin.email, 'CREATE_PRODUCT', 'products', newProduct.id, { name: newProduct.name });
                return res.status(201).json({ success: true, product: newProduct });
            }
        }

        // 3. UPDATE PRODUCT
        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id) return res.status(400).json({ error: 'Product ID is required' });

            const updates = {
                name: body.name ? body.name.trim() : undefined,
                slug: body.slug ? slugify(body.slug) : undefined,
                category: body.category,
                health_segment: body.health_segment,
                price: body.price !== undefined ? parseFloat(body.price) : undefined,
                compare_at_price: body.compare_at_price !== undefined ? (body.compare_at_price ? parseFloat(body.compare_at_price) : null) : undefined,
                stock: body.stock !== undefined ? parseInt(body.stock, 10) : undefined,
                unit: body.unit,
                short_description: body.short_description,
                description: body.description,
                ingredients: body.ingredients,
                usage_instructions: body.usage_instructions,
                storage_precautions: body.storage_precautions,
                badge: body.badge,
                images: body.images,
                is_published: body.is_published !== undefined ? Boolean(body.is_published) : undefined,
                is_featured: body.is_featured !== undefined ? Boolean(body.is_featured) : undefined,
                is_archived: body.is_archived !== undefined ? Boolean(body.is_archived) : undefined,
                sort_order: body.sort_order !== undefined ? parseInt(body.sort_order, 10) : undefined,
                updated_at: new Date().toISOString()
            };

            // Remove undefined keys
            Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_PRODUCT', 'products', id, { updates });
                return res.status(200).json({ success: true, product: data });
            } else {
                const idx = mockDb.products.findIndex(p => p.id === id);
                if (idx === -1) return res.status(404).json({ error: 'Product not found' });
                mockDb.products[idx] = { ...mockDb.products[idx], ...updates };
                await logAdminAction(admin.email, 'UPDATE_PRODUCT', 'products', id, { updates });
                return res.status(200).json({ success: true, product: mockDb.products[idx] });
            }
        }

        // 4. ARCHIVE / DELETE PRODUCT
        if (method === 'DELETE') {
            const id = req.query?.id || req.body?.id;
            if (!id) return res.status(400).json({ error: 'Product ID is required' });

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                // Soft archive to protect order reference integrity
                const { data, error } = await supabase
                    .from('products')
                    .update({ is_archived: true, is_published: false, updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .select()
                    .single();

                if (error) throw error;
                await logAdminAction(admin.email, 'ARCHIVE_PRODUCT', 'products', id, {});
                return res.status(200).json({ success: true, message: 'Product archived' });
            } else {
                const p = mockDb.products.find(item => item.id === id);
                if (p) {
                    p.is_archived = true;
                    p.is_published = false;
                }
                await logAdminAction(admin.email, 'ARCHIVE_PRODUCT', 'products', id, {});
                return res.status(200).json({ success: true, message: 'Product archived' });
            }
        }

        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Products API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
