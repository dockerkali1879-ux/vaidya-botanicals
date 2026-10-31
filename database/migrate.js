/**
 * VAIDYA BOTANICALS - Database Migration Runner
 * Target Platform: Neon PostgreSQL 18
 * Executes database/schema.sql and database/seed.sql via unpooled direct connection.
 */

const fs = require('fs');
const path = require('path');
const { createDirectClient, isDatabaseConfigured } = require('../lib/db');

async function runMigration() {
    console.log('========================================================');
    console.log('  Vaidya Botanicals - Neon PostgreSQL Schema Migration  ');
    console.log('========================================================');

    if (!isDatabaseConfigured()) {
        console.error('ERROR: Neon database connection string not found.');
        console.error('Please configure DATABASE_URL in .env.local before running migrations.');
        process.exit(1);
    }

    const client = createDirectClient();
    try {
        console.log('[Neon] Connecting to direct unpooled endpoint...');
        await client.connect();
        console.log('[Neon] Connected successfully.');

        // 1. Run Schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        console.log(`[Neon] Applying schema from: ${path.basename(schemaPath)}...`);
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await client.query(schemaSql);
        console.log(' SUCCESS: Schema applied successfully.');

        // 2. Run Seeds
        const seedPath = path.join(__dirname, 'seed.sql');
        if (fs.existsSync(seedPath)) {
            console.log(`[Neon] Seeding initial data from: ${path.basename(seedPath)}...`);
            const seedSql = fs.readFileSync(seedPath, 'utf8');
            await client.query(seedSql);
            console.log(' SUCCESS: Seed data populated successfully.');
        }

        // 3. Verify counts
        const productCount = await client.query('SELECT COUNT(*) AS count FROM public.products');
        const contentCount = await client.query('SELECT COUNT(*) AS count FROM public.site_content');
        console.log(`\n[Database Summary]:`);
        console.log(`  - Products in catalog: ${productCount.rows[0].count}`);
        console.log(`  - Site content sections: ${contentCount.rows[0].count}`);
        console.log('========================================================\n');
    } catch (err) {
        console.error('\n MIGRATION FAILED:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    runMigration();
}

module.exports = runMigration;

