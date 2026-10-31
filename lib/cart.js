/**
 * VAIDYA BOTANICALS - Cart Management Layer
 * Handles guest cart validation, Neon PostgreSQL persistence,
 * stock clamping, live pricing calculations, and transactional cart merging.
 */

const { isDatabaseConfigured, query, transaction } = require('./db');
const { mockDb } = require('./supabase');

if (!mockDb.customerCarts) {
    mockDb.customerCarts = {};
}

/**
 * Validates, de-duplicates and enriches cart items against live catalog in Neon.
 * Authoritative prices and stock levels are always fetched from public.products.
 */
async function validateAndEnrichCartItems(rawItems, dbExecutor = null) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return {
            items: [],
            subtotal: 0,
            totalItems: 0,
            warnings: []
        };
    }

    const execQuery = dbExecutor ? dbExecutor.query.bind(dbExecutor) : query;
    const warnings = [];

    // 1. Deduplicate by product identifier and sum requested quantities
    const dedupMap = new Map();
    for (const raw of rawItems) {
        if (!raw) continue;
        const lookup = String(raw.id || raw.slug || '').trim();
        if (!lookup) continue;
        const qty = Math.max(1, parseInt(raw.qty, 10) || 1);

        if (dedupMap.has(lookup)) {
            dedupMap.get(lookup).qty += qty;
        } else {
            dedupMap.set(lookup, {
                lookup,
                requestedQty: qty,
                clientPrice: parseFloat(raw.price) || 0
            });
        }
    }

    const lookups = Array.from(dedupMap.keys());
    if (lookups.length === 0) {
        return { items: [], subtotal: 0, totalItems: 0, warnings: [] };
    }

    // 2. Fetch live products from database
    let products = [];
    if (isDatabaseConfigured()) {
        try {
            const res = await execQuery(`
                SELECT id, slug, name, price, stock, unit, images, is_published, is_archived
                FROM public.products
                WHERE id::text = ANY($1::text[]) OR slug = ANY($1::text[])
            `, [lookups]);
            products = res.rows;
        } catch (e) {
            console.error('[Cart Product Validation Error]:', e.message);
        }
    } else {
        // Fallback for offline mock tests
        products = (mockDb.products || []).filter(
            p => lookups.includes(p.id) || lookups.includes(p.slug)
        );
    }

    // Index products by both id and slug
    const prodMap = new Map();
    for (const p of products) {
        prodMap.set(String(p.id), p);
        if (p.slug) prodMap.set(String(p.slug), p);
    }

    // 3. Validate availability, stock, and calculate authoritative subtotals
    const enrichedItems = [];
    let subtotal = 0;
    let totalItems = 0;

    for (const [lookup, req] of dedupMap.entries()) {
        const prod = prodMap.get(lookup);

        if (!prod) {
            warnings.push(`Item "${lookup}" is no longer available in our botanical catalog.`);
            continue;
        }

        if (!prod.is_published || prod.is_archived) {
            warnings.push(`"${prod.name}" has been discontinued or archived.`);
            continue;
        }

        const liveStock = parseInt(prod.stock, 10) || 0;
        if (liveStock <= 0) {
            warnings.push(`"${prod.name}" is currently out of stock.`);
            continue;
        }

        let effectiveQty = req.requestedQty;
        if (effectiveQty > liveStock) {
            effectiveQty = liveStock;
            warnings.push(`Quantity for "${prod.name}" adjusted to ${liveStock} (maximum available stock).`);
        }

        const authoritativePrice = parseFloat(prod.price) || 0;
        const lineTotal = authoritativePrice * effectiveQty;
        subtotal += lineTotal;
        totalItems += effectiveQty;

        let primaryImage = '';
        if (Array.isArray(prod.images) && prod.images.length > 0) {
            const pri = prod.images.find(img => img.is_primary) || prod.images[0];
            primaryImage = pri.url || '';
        }

        enrichedItems.push({
            id: prod.id,
            slug: prod.slug,
            name: prod.name,
            price: authoritativePrice,
            stock: liveStock,
            unit: prod.unit || '/ 100g',
            image: primaryImage,
            qty: effectiveQty,
            lineTotal
        });
    }

    return {
        items: enrichedItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        totalItems,
        warnings
    };
}

/**
 * Retrieves the persistent cart for an authenticated customer profile.
 */
async function getCustomerCart(profileId) {
    if (!profileId) {
        return { items: [], subtotal: 0, totalItems: 0, warnings: [] };
    }

    if (isDatabaseConfigured()) {
        const res = await query(
            'SELECT items FROM public.customer_carts WHERE profile_id = $1',
            [profileId]
        );
        if (res.rows.length === 0) {
            return { items: [], subtotal: 0, totalItems: 0, warnings: [] };
        }
        const rawItems = Array.isArray(res.rows[0].items) ? res.rows[0].items : [];
        return await validateAndEnrichCartItems(rawItems);
    } else {
        const raw = mockDb.customerCarts[profileId] || [];
        return await validateAndEnrichCartItems(raw);
    }
}

/**
 * Persists an authenticated customer's cart to Neon PostgreSQL.
 */
async function saveCustomerCart(profileId, rawItems) {
    if (!profileId) {
        throw new Error('profileId is required to save customer cart');
    }

    const validated = await validateAndEnrichCartItems(rawItems);
    const minimalStorage = validated.items.map(i => ({
        id: i.id,
        slug: i.slug,
        qty: i.qty
    }));

    if (isDatabaseConfigured()) {
        await query(`
            INSERT INTO public.customer_carts (profile_id, items, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (profile_id)
            DO UPDATE SET items = $2, updated_at = NOW()
        `, [profileId, JSON.stringify(minimalStorage)]);
    } else {
        mockDb.customerCarts[profileId] = minimalStorage;
    }

    return validated;
}

/**
 * Merges anonymous guest cart items into an authenticated customer's cart.
 * Transactional, idempotent, stock-checked.
 */
async function mergeGuestCart(profileId, guestItems) {
    if (!profileId) {
        throw new Error('profileId is required for cart merge');
    }

    if (!Array.isArray(guestItems)) {
        guestItems = [];
    }

    if (isDatabaseConfigured()) {
        return await transaction(async (client) => {
            // Lock customer cart row
            const existingRes = await client.query(
                'SELECT items FROM public.customer_carts WHERE profile_id = $1 FOR UPDATE',
                [profileId]
            );

            const existingItems = existingRes.rows.length > 0 && Array.isArray(existingRes.rows[0].items)
                ? existingRes.rows[0].items
                : [];

            // Combine quantities by product ID/slug
            const combinedMap = new Map();

            for (const item of existingItems) {
                if (!item) continue;
                const key = String(item.id || item.slug || '').trim();
                if (!key) continue;
                const qty = Math.max(1, parseInt(item.qty, 10) || 1);
                combinedMap.set(key, { id: item.id, slug: item.slug, qty });
            }

            for (const gItem of guestItems) {
                if (!gItem) continue;
                const key = String(gItem.id || gItem.slug || '').trim();
                if (!key) continue;
                const qty = Math.max(1, parseInt(gItem.qty, 10) || 1);

                if (combinedMap.has(key)) {
                    combinedMap.get(key).qty += qty;
                } else {
                    combinedMap.set(key, { id: gItem.id, slug: gItem.slug, qty });
                }
            }

            const rawCombined = Array.from(combinedMap.values());
            const validated = await validateAndEnrichCartItems(rawCombined, client);

            const minimalStorage = validated.items.map(i => ({
                id: i.id,
                slug: i.slug,
                qty: i.qty
            }));

            await client.query(`
                INSERT INTO public.customer_carts (profile_id, items, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (profile_id)
                DO UPDATE SET items = $2, updated_at = NOW()
            `, [profileId, JSON.stringify(minimalStorage)]);

            return validated;
        });
    } else {
        const existing = mockDb.customerCarts[profileId] || [];
        const combinedMap = new Map();

        for (const item of existing) {
            const key = String(item.id || item.slug);
            combinedMap.set(key, { id: item.id, slug: item.slug, qty: item.qty });
        }
        for (const gItem of guestItems) {
            const key = String(gItem.id || gItem.slug);
            if (combinedMap.has(key)) {
                combinedMap.get(key).qty += gItem.qty;
            } else {
                combinedMap.set(key, { id: gItem.id, slug: gItem.slug, qty: gItem.qty });
            }
        }

        const rawCombined = Array.from(combinedMap.values());
        const validated = await validateAndEnrichCartItems(rawCombined);
        const minimal = validated.items.map(i => ({ id: i.id, slug: i.slug, qty: i.qty }));
        mockDb.customerCarts[profileId] = minimal;
        return validated;
    }
}

/**
 * Clears the customer cart in Neon upon successful checkout.
 */
async function clearCustomerCart(profileId, client = null) {
    if (!profileId) return;

    if (isDatabaseConfigured()) {
        const exec = client ? client.query.bind(client) : query;
        await exec(
            "UPDATE public.customer_carts SET items = '[]'::jsonb, updated_at = NOW() WHERE profile_id = $1",
            [profileId]
        );
    } else {
        mockDb.customerCarts[profileId] = [];
    }
}

module.exports = {
    validateAndEnrichCartItems,
    getCustomerCart,
    saveCustomerCart,
    mergeGuestCart,
    clearCustomerCart
};

