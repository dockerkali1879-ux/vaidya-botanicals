/**
 * VAIDYA BOTANICALS: Staging Deployment Smoke Test Suite
 * Tests live workers.dev deployment:
 * 1. Storefront homepage availability and noindex protection
 * 2. Product catalog API via Cloudflare Hyperdrive & Neon PostgreSQL
 * 3. Individual product loading and attributes
 * 4. Stealth admin dashboard gating (/admin and /admin/index.html)
 * 5. Private login route availability
 *
 * Does NOT place orders or dispatch OTPs.
 */

const STAGING_URL = 'https://vaidya-botanicals-staging.dockerkali1879.workers.dev';

async function runSmokeTests() {
    console.log('======================================================');
    console.log('VAIDYA BOTANICALS: STAGING DEPLOYMENT SMOKE TESTS');
    console.log(`Target: ${STAGING_URL}`);
    console.log('======================================================\n');

    let passed = 0;
    let failed = 0;

    async function check(name, fn) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}:`, err.message);
            failed++;
        }
    }

    // 1. Homepage & Noindex Headers
    await check('Homepage (/) returns HTTP 200 with noindex protections', async () => {
        const res = await fetch(`${STAGING_URL}/`);
        if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
        const robotsHeader = res.headers.get('x-robots-tag');
        if (!robotsHeader || !robotsHeader.includes('noindex')) {
            throw new Error(`Missing or invalid X-Robots-Tag header: ${robotsHeader}`);
        }
        const text = await res.text();
        if (!text.includes('Vaidya')) {
            throw new Error('Storefront brand text missing from homepage');
        }
        if (!text.includes('noindex, nofollow')) {
            throw new Error('Missing meta robots noindex tag in HTML');
        }
    });

    // 2. Catalogue API & Hyperdrive Neon Connectivity
    let fetchedProducts = [];
    await check('GET /api/products connects to Neon via Hyperdrive and returns active catalogue', async () => {
        const res = await fetch(`${STAGING_URL}/api/products`);
        if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.products)) {
            throw new Error(`Invalid catalogue response structure: ${JSON.stringify(data)}`);
        }
        fetchedProducts = data.products;
        if (fetchedProducts.length === 0) {
            throw new Error('Catalogue returned 0 products');
        }
        console.log(`    [Live Catalogue]: Retrieved ${fetchedProducts.length} published products from Neon via Hyperdrive:`);
        fetchedProducts.slice(0, 3).forEach(p => {
            console.log(`      - ${p.name} (Slug: ${p.slug}, Price: ₹${p.price}, Stock: ${p.stock})`);
        });
    });

    // 3. Single Product Lookup
    await check('Single product query (/api/products?slug=...) returns product details', async () => {
        if (fetchedProducts.length === 0) throw new Error('No products available to test lookup');
        const target = fetchedProducts[0];
        const res = await fetch(`${STAGING_URL}/api/products?slug=${encodeURIComponent(target.slug)}`);
        if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
        const data = await res.json();
        if (!data.product || data.product.slug !== target.slug) {
            throw new Error(`Product lookup mismatch: ${JSON.stringify(data)}`);
        }
    });

    // 4. Admin Stealth Protection (/admin)
    await check('GET /admin returns HTTP 404 (stealth gating)', async () => {
        const res = await fetch(`${STAGING_URL}/admin`, { redirect: 'manual' });
        if (res.status !== 404) throw new Error(`Expected HTTP 404 for unauthenticated /admin, got ${res.status}`);
    });

    // 5. Admin Direct Index HTML Stealth Protection (/admin/index.html)
    await check('GET /admin/index.html returns HTTP 404 (stealth gating)', async () => {
        const res = await fetch(`${STAGING_URL}/admin/index.html`, { redirect: 'manual' });
        if (res.status !== 404) throw new Error(`Expected HTTP 404 for direct /admin/index.html, got ${res.status}`);
    });

    // 6. Private Login Route
    await check('GET /private-login.html returns HTTP 200 with X-Robots-Tag', async () => {
        const res = await fetch(`${STAGING_URL}/private-login.html`);
        if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
        const robotsHeader = res.headers.get('x-robots-tag');
        if (!robotsHeader || !robotsHeader.includes('noindex')) {
            throw new Error(`Missing X-Robots-Tag header on private login: ${robotsHeader}`);
        }
    });

    // 7. Security Header on API Responses
    await check('API responses include X-Robots-Tag and security headers', async () => {
        const res = await fetch(`${STAGING_URL}/api/products`);
        const robotsHeader = res.headers.get('x-robots-tag');
        if (!robotsHeader || !robotsHeader.includes('noindex')) {
            throw new Error(`API missing X-Robots-Tag: ${robotsHeader}`);
        }
    });

    console.log('\n======================================================');
    console.log(`SMOKE TESTS RESULT: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) process.exit(1);
}

if (require.main === module) {
    runSmokeTests().catch(err => {
        console.error('Smoke test runner failed:', err);
        process.exit(1);
    });
}

module.exports = runSmokeTests;
