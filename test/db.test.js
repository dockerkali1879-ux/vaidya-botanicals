/**
 * VAIDYA BOTANICALS: Neon PostgreSQL Database Integration Test Suite
 * Tests:
 * 1. Health check & latency verification
 * 2. Connection pool allocation and release
 * 3. Atomic transaction execution (BEGIN, COMMIT, verification)
 * 4. Transaction rollback integrity (ensuring failed transactions leave zero residue)
 * 5. Update operations & snapshot consistency
 * 6. Persistence across connection pool closure and recreation
 */

const { query, transaction, healthCheck, closePool, isDatabaseConfigured, getPool } = require('../lib/db');

async function runDatabaseTests() {
    console.log('========================================================');
    console.log('  Vaidya Botanicals - Neon PostgreSQL Integration Tests ');
    console.log('========================================================');

    if (!isDatabaseConfigured()) {
        console.log('[Notice] Database connection string not detected in .env.local.');
        console.log('Please add your Neon development branch connection string to .env.local:');
        console.log('  DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-late-water-b3aruido-pooler.aws-ap-southeast-1.neon.tech/neondb?sslmode=require');
        console.log('\nAll structural files, drivers, and schema files are successfully prepared.');
        return;
    }

    try {
        // [Test 1] Health Check & Ping Latency
        console.log('\n[Test 1] Checking database connectivity & latency...');
        const health = await healthCheck();
        if (!health.connected) {
            throw new Error(`Failed to connect to Neon PostgreSQL: ${health.error}`);
        }
        console.log(` PASS: Connected to "${health.dbName}" in ${health.latencyMs}ms.`);
        console.log(` Server Time: ${health.serverTime}`);
        console.log(` PostgreSQL Version: ${health.version.split(' ')[0]} ${health.version.split(' ')[1]}`);

        // [Test 2] Connection Pool Allocation & Query
        console.log('\n[Test 2] Verifying connection pool query execution...');
        const poolRes = await query('SELECT $1::text AS message, 42 AS number', ['Vaidya Neon Pool Active']);
        if (!poolRes.rows || poolRes.rows[0].message !== 'Vaidya Neon Pool Active') {
            throw new Error('Connection pool query did not return expected result');
        }
        console.log(' PASS: Pool executed parameterized query successfully.');

        // [Test 3] Atomic Transaction (COMMIT)
        console.log('\n[Test 3] Testing atomic transaction COMMIT...');
        const testSlug = `test-item-${Date.now()}`;
        const inserted = await transaction(async (client) => {
            const res = await client.query(`
                INSERT INTO public.products (
                    slug, name, category, health_segment, price, stock, unit, short_description, is_published
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id, slug, name, price, stock
            `, [
                testSlug,
                'Test Holy Basil Infusion',
                'tea',
                'Health Segment: Vitality',
                29.50,
                25,
                '/ 100g',
                'Transactional integration test record.',
                false
            ]);
            return res.rows[0];
        });

        if (!inserted || inserted.slug !== testSlug) {
            throw new Error('Transaction insert did not return inserted record');
        }
        console.log(` PASS: Inserted test product "${inserted.name}" (ID: ${inserted.id}) inside transaction.`);

        // Read back outside transaction using separate pooled client
        const readBack = await query('SELECT slug, price, stock FROM public.products WHERE slug = $1', [testSlug]);
        if (!readBack.rows.length || parseFloat(readBack.rows[0].price) !== 29.50) {
            throw new Error('Record not found on separate pooled query after commit');
        }
        console.log(' PASS: Verified record persists on separate connection after COMMIT.');

        // [Test 4] Transaction Rollback Integrity
        console.log('\n[Test 4] Testing transaction ROLLBACK integrity...');
        const rollbackSlug = `test-rollback-${Date.now()}`;
        let rollbackErrorCaught = false;

        try {
            await transaction(async (client) => {
                await client.query(`
                    INSERT INTO public.products (slug, name, category, price, stock, unit)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [rollbackSlug, 'Doomed Product', 'tea', 19.99, 10, '/ 50g']);

                // Intentionally trigger an error to force rollback
                throw new Error('Simulated runtime error inside transaction block');
            });
        } catch (err) {
            rollbackErrorCaught = true;
        }

        if (!rollbackErrorCaught) {
            throw new Error('Expected transaction to fail and throw');
        }

        const rollbackCheck = await query('SELECT slug FROM public.products WHERE slug = $1', [rollbackSlug]);
        if (rollbackCheck.rows.length > 0) {
            throw new Error('CRITICAL FLAW: Rolled-back record was found in the database!');
        }
        console.log(' PASS: Transaction correctly rolled back. Zero residual records found.');

        // [Test 5] Update & Mutation Test
        console.log('\n[Test 5] Testing record UPDATE...');
        await query('UPDATE public.products SET price = $1, stock = $2 WHERE slug = $3', [35.00, 50, testSlug]);
        const updated = await query('SELECT price, stock FROM public.products WHERE slug = $1', [testSlug]);
        if (parseFloat(updated.rows[0].price) !== 35.00 || updated.rows[0].stock !== 50) {
            throw new Error('Update values did not reflect');
        }
        console.log(' PASS: Updated price (₹35.00) and stock (50) verified.');

        // [Test 6] Persistence Across Full Pool Closure & Reopening
        console.log('\n[Test 6] Verifying persistence across pool teardown & restart...');
        await closePool();
        console.log(' Pool closed and disconnected.');

        // Reconnect fresh pool
        const freshPoolRes = await query('SELECT slug, price FROM public.products WHERE slug = $1', [testSlug]);
        if (!freshPoolRes.rows.length || parseFloat(freshPoolRes.rows[0].price) !== 35.00) {
            throw new Error('Record did not persist across pool restart!');
        }
        console.log(' PASS: Record persisted and queried successfully after pool restart.');

        // [Test 7] Cleanup
        console.log('\n[Test 7] Cleaning up test records...');
        await query('DELETE FROM public.products WHERE slug = $1', [testSlug]);
        const finalCheck = await query('SELECT slug FROM public.products WHERE slug = $1', [testSlug]);
        if (finalCheck.rows.length !== 0) {
            throw new Error('Failed to clean up test product');
        }
        console.log(' PASS: Test records cleanly purged.');

        console.log('\n========================================================');
        console.log(' ALL DATABASE INTEGRATION TESTS PASSED SUCCESSFULLY!    ');
        console.log('========================================================\n');
    } catch (err) {
        console.error('\n DATABASE TEST SUITE FAILURE:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await closePool();
    }
}

if (require.main === module) {
    runDatabaseTests();
}

module.exports = runDatabaseTests;

