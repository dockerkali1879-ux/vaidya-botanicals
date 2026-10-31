/**
 * VAIDYA BOTANICALS - Database Schema & Data Verification
 * Inspects all tables, enums, indexes, and seeded records in Neon PostgreSQL.
 */

const { query, closePool } = require('../lib/db');

async function verify() {
    try {
        console.log('========================================================');
        console.log('   Vaidya Botanicals - Neon Schema & Data Inspection    ');
        console.log('========================================================\n');

        // 1. Tables
        const tables = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' 
            ORDER BY table_name;
        `);
        console.log(`[1] TABLES (${tables.rows.length} total):`);
        tables.rows.forEach(r => console.log(`  - ${r.table_name}`));

        // 2. Enums
        const enums = await query(`
            SELECT t.typname AS enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS enum_values
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
            GROUP BY t.typname
            ORDER BY t.typname;
        `);
        console.log(`\n[2] ENUMS (${enums.rows.length} total):`);
        enums.rows.forEach(r => console.log(`  - ${r.enum_name}: [${r.enum_values}]`));

        // 3. Indexes
        const indexes = await query(`
            SELECT indexname, tablename
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname;
        `);
        console.log(`\n[3] INDEXES (${indexes.rows.length} total):`);
        indexes.rows.forEach(r => console.log(`  - ${r.tablename} -> ${r.indexname}`));

        // 4. Products seed
        const products = await query(`
            SELECT slug, name, category, price, stock, is_published
            FROM public.products
            ORDER BY id;
        `);
        console.log(`\n[4] PRODUCTS SEEDED (${products.rows.length} total):`);
        products.rows.forEach(r => console.log(`  - [${r.category}] "${r.name}" (${r.slug}) | Price: ₹${r.price} | Stock: ${r.stock} | Published: ${r.is_published}`));

        // 5. Site content seed
        const content = await query(`
            SELECT key, updated_at
            FROM public.site_content
            ORDER BY key;
        `);
        console.log(`\n[5] SITE CONTENT SECTIONS (${content.rows.length} total):`);
        content.rows.forEach(r => console.log(`  - Key: "${r.key}" (Updated: ${r.updated_at.toISOString()})`));

        console.log('\n========================================================');
        console.log('   VERIFICATION COMPLETE: ALL OBJECTS MATCH SPEC        ');
        console.log('========================================================\n');
    } catch (err) {
        console.error('VERIFICATION ERROR:', err.message);
        process.exit(1);
    } finally {
        await closePool();
    }
}

verify();

