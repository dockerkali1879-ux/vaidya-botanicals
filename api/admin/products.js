const { verifyAdmin, logAdminAction } = require('../../lib/auth');
const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

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
    const admin = await verifyAdmin(req);
    if (!admin) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    const method = req.method;

    try {
        // 1. GET ALL PRODUCTS
        if (method === 'GET') {
            if (isDatabaseConfigured()) {
                const result = await query(
                    'SELECT * FROM public.products ORDER BY sort_order ASC, created_at DESC'
                );
                return res.status(200).json({ products: result.rows.map(formatProduct) });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const { data, error } = await supabase
                    .from('products')
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: false });
                if (error) throw error;
                return res.status(200).json({ products: data || [] });
            }

            return res.status(200).json({ products: mockDb.products });
        }

        // 2. CREATE PRODUCT (OR DUPLICATE)
        if (method === 'POST') {
            const body = req.body || {};

            // Action: Duplicate
            if (req.query?.action === 'duplicate' || body.action === 'duplicate') {
                const targetId = req.query?.id || body.id;

                if (isDatabaseConfigured()) {
                    const origRes = await query('SELECT * FROM public.products WHERE id = $1', [targetId]);
                    if (origRes.rows.length === 0) return res.status(404).json({ error: 'Original product not found' });
                    const original = origRes.rows[0];

                    const copyName = `${original.name} (Copy)`;
                    const copySlug = `${original.slug}-copy-${Date.now().toString(36)}`;

                    const insertRes = await query(`
                        INSERT INTO public.products (
                            slug, name, category, health_segment, price, compare_at_price, stock, unit,
                            short_description, description, ingredients, usage_instructions, storage_precautions,
                            badge, images, is_published, is_featured, is_archived, sort_order, created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8,
                            $9, $10, $11, $12, $13,
                            $14, $15, false, $16, false, $17, NOW(), NOW()
                        ) RETURNING *
                    `, [
                        copySlug, copyName, original.category, original.health_segment, original.price, original.compare_at_price, original.stock, original.unit,
                        original.short_description, original.description, original.ingredients, original.usage_instructions, original.storage_precautions,
                        original.badge, JSON.stringify(original.images || []), original.is_featured, original.sort_order
                    ]);

                    const duplicated = insertRes.rows[0];
                    await logAdminAction(admin.email, 'DUPLICATE_PRODUCT', 'products', duplicated.id, { name: duplicated.name });
                    return res.status(201).json({ success: true, product: formatProduct(duplicated) });
                }

                if (isSupabaseConfigured()) {
                    const supabase = getSupabaseAdmin();
                    const { data: original, error } = await supabase.from('products').select('*').eq('id', targetId).single();
                    if (error || !original) return res.status(404).json({ error: 'Original product not found' });

                    const duplicated = {
                        ...original,
                        name: `${original.name} (Copy)`,
                        slug: `${original.slug}-copy-${Date.now().toString(36)}`,
                        is_published: false,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    delete duplicated.id;
                    const { data, error: insErr } = await supabase.from('products').insert([duplicated]).select().single();
                    if (insErr) throw insErr;
                    await logAdminAction(admin.email, 'DUPLICATE_PRODUCT', 'products', data.id, { name: data.name });
                    return res.status(201).json({ success: true, product: data });
                }

                const original = mockDb.products.find(p => p.id === targetId);
                if (!original) return res.status(404).json({ error: 'Original product not found' });
                const duplicated = {
                    ...original,
                    id: 'prod-' + Date.now().toString(36),
                    name: `${original.name} (Copy)`,
                    slug: `${original.slug}-copy-${Date.now().toString(36)}`,
                    is_published: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                mockDb.products.unshift(duplicated);
                await logAdminAction(admin.email, 'DUPLICATE_PRODUCT', 'products', duplicated.id, { name: duplicated.name });
                return res.status(201).json({ success: true, product: duplicated });
            }

            // Action: Standard Create
            const name = body.name ? body.name.trim() : '';
            if (!name) return res.status(400).json({ error: 'Product name is required' });

            const slug = body.slug ? slugify(body.slug) : slugify(name);
            const price = parseFloat(body.price) || 0;
            const stock = parseInt(body.stock, 10) || 0;

            if (isDatabaseConfigured()) {
                const existingSlug = await query('SELECT id, is_archived FROM public.products WHERE slug = $1', [slug]);
                if (existingSlug.rows.length > 0) {
                    if (existingSlug.rows[0].is_archived) {
                        await query('UPDATE public.products SET slug = $1 WHERE id = $2', [`${slug}-archived-${Date.now()}`, existingSlug.rows[0].id]);
                    } else {
                        return res.status(400).json({ error: 'A product with this slug already exists' });
                    }
                }

                const insertRes = await query(`
                    INSERT INTO public.products (
                        slug, name, category, health_segment, price, compare_at_price, stock, unit,
                        short_description, description, ingredients, usage_instructions, storage_precautions,
                        badge, images, is_published, is_featured, is_archived, sort_order, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11, $12, $13,
                        $14, $15, $16, $17, false, $18, NOW(), NOW()
                    ) RETURNING *
                `, [
                    slug, name, body.category || 'tea', body.health_segment || '', price,
                    body.compare_at_price ? parseFloat(body.compare_at_price) : null,
                    stock, body.unit || '/ 100g', body.short_description || '', body.description || '',
                    body.ingredients || '', body.usage_instructions || '', body.storage_precautions || '',
                    body.badge || '', JSON.stringify(body.images || []), Boolean(body.is_published),
                    Boolean(body.is_featured), parseInt(body.sort_order, 10) || 0
                ]);

                const created = insertRes.rows[0];
                await logAdminAction(admin.email, 'CREATE_PRODUCT', 'products', created.id, { name: created.name, slug: created.slug });
                return res.status(201).json({ success: true, product: formatProduct(created) });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const newProduct = {
                    name, slug, category: body.category || 'tea', health_segment: body.health_segment || '',
                    price, compare_at_price: body.compare_at_price ? parseFloat(body.compare_at_price) : null,
                    stock, unit: body.unit || '/ 100g', short_description: body.short_description || '',
                    description: body.description || '', ingredients: body.ingredients || '',
                    usage_instructions: body.usage_instructions || '', storage_precautions: body.storage_precautions || '',
                    badge: body.badge || '', images: body.images || [], is_published: Boolean(body.is_published),
                    is_featured: Boolean(body.is_featured), is_archived: false, sort_order: parseInt(body.sort_order, 10) || 0,
                    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
                };
                const { data, error } = await supabase.from('products').insert([newProduct]).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'CREATE_PRODUCT', 'products', data.id, { name: data.name, slug: data.slug });
                return res.status(201).json({ success: true, product: data });
            }

            const fallbackProduct = {
                id: 'prod-' + Date.now().toString(36),
                name, slug, category: body.category || 'tea', health_segment: body.health_segment || '',
                price, compare_at_price: body.compare_at_price ? parseFloat(body.compare_at_price) : null,
                stock, unit: body.unit || '/ 100g', short_description: body.short_description || '',
                description: body.description || '', ingredients: body.ingredients || '',
                usage_instructions: body.usage_instructions || '', storage_precautions: body.storage_precautions || '',
                badge: body.badge || '', images: body.images || [], is_published: Boolean(body.is_published),
                is_featured: Boolean(body.is_featured), is_archived: false, sort_order: parseInt(body.sort_order, 10) || 0,
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            mockDb.products.unshift(fallbackProduct);
            await logAdminAction(admin.email, 'CREATE_PRODUCT', 'products', fallbackProduct.id, { name: fallbackProduct.name, slug: fallbackProduct.slug });
            return res.status(201).json({ success: true, product: fallbackProduct });
        }

        // 3. UPDATE PRODUCT
        if (method === 'PUT') {
            const body = req.body || {};
            const id = req.query?.id || body.id;
            if (!id) return res.status(400).json({ error: 'Product ID is required' });

            if (isDatabaseConfigured()) {
                const fields = [];
                const values = [];
                const allowed = [
                    'name', 'slug', 'category', 'health_segment', 'price', 'compare_at_price',
                    'stock', 'unit', 'short_description', 'description', 'ingredients',
                    'usage_instructions', 'storage_precautions', 'badge', 'is_published',
                    'is_featured', 'is_archived', 'sort_order'
                ];

                allowed.forEach(k => {
                    if (body[k] !== undefined) {
                        values.push(body[k]);
                        fields.push(`${k} = $${values.length}`);
                    }
                });

                if (body.images !== undefined) {
                    values.push(JSON.stringify(body.images));
                    fields.push(`images = $${values.length}`);
                }

                if (fields.length === 0) {
                    return res.status(400).json({ error: 'No update fields provided' });
                }

                fields.push('updated_at = NOW()');
                values.push(id);
                const sql = `UPDATE public.products SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`;
                const updateRes = await query(sql, values);

                if (updateRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Product not found' });
                }

                const updated = updateRes.rows[0];
                await logAdminAction(admin.email, 'UPDATE_PRODUCT', 'products', id, body);
                return res.status(200).json({ success: true, product: formatProduct(updated) });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                const updates = { ...body, updated_at: new Date().toISOString() };
                delete updates.id;
                const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
                if (error) throw error;
                await logAdminAction(admin.email, 'UPDATE_PRODUCT', 'products', id, body);
                return res.status(200).json({ success: true, product: data });
            }

            const idx = mockDb.products.findIndex(p => p.id === id);
            if (idx === -1) return res.status(404).json({ error: 'Product not found' });
            mockDb.products[idx] = { ...mockDb.products[idx], ...body, updated_at: new Date().toISOString() };
            await logAdminAction(admin.email, 'UPDATE_PRODUCT', 'products', id, body);
            return res.status(200).json({ success: true, product: mockDb.products[idx] });
        }

        // 4. ARCHIVE / DELETE PRODUCT
        if (method === 'DELETE') {
            const id = req.query?.id;
            if (!id) return res.status(400).json({ error: 'Product ID is required' });

            if (isDatabaseConfigured()) {
                await query('UPDATE public.products SET is_archived = true, is_published = false, updated_at = NOW() WHERE id = $1', [id]);
                await logAdminAction(admin.email, 'ARCHIVE_PRODUCT', 'products', id, {});
                return res.status(200).json({ success: true, message: 'Product archived safely' });
            }

            if (isSupabaseConfigured()) {
                const supabase = getSupabaseAdmin();
                await supabase.from('products').update({ is_archived: true, is_published: false }).eq('id', id);
                await logAdminAction(admin.email, 'ARCHIVE_PRODUCT', 'products', id, {});
                return res.status(200).json({ success: true, message: 'Product archived safely' });
            }

            const target = mockDb.products.find(p => p.id === id);
            if (target) {
                target.is_archived = true;
                target.is_published = false;
            }
            await logAdminAction(admin.email, 'ARCHIVE_PRODUCT', 'products', id, {});
            return res.status(200).json({ success: true, message: 'Product archived safely' });
        }

        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('[Admin Products API Error]:', err);
        return res.status(500).json({ error: err.message || 'Operation failed' });
    }
};
