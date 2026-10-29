const http = require('http');
const server = require('../server');

const PORT = 3898; // Isolated test port

function request(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({ port: PORT, host: '127.0.0.1', ...options }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'object' ? JSON.stringify(postData) : postData);
        }
        req.end();
    });
}

async function runTests() {
    console.log('--- STARTING MILESTONE 2 VERIFICATION TESTS ---');

    await new Promise(r => server.listen(PORT, r));
    console.log(`Test server running on port ${PORT}`);

    try {
        // Step 1: Login to get admin cookie
        const loginRes = await request({
            path: '/api/auth/admin-login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'admin@vaidyabotanicals.com', password: 'VaidyaAdmin2026!' });

        const cookieVal = loginRes.headers['set-cookie'][0].split(';')[0];

        // Test 1: Public products API
        console.log('\n[Test 1] Verifying public /api/products endpoint...');
        const pubRes = await request({ path: '/api/products', method: 'GET' });
        if (pubRes.statusCode !== 200) throw new Error('Public products failed: ' + pubRes.statusCode);
        const pubData = JSON.parse(pubRes.body);
        if (!pubData.products || pubData.products.length < 6) throw new Error('Expected at least 6 products');
        console.log(` PASS: Public API returned ${pubData.products.length} published products.`);

        // Test 2: Unauthenticated admin products API blocked
        console.log('\n[Test 2] Verifying unauthenticated /api/admin/products is blocked...');
        const blockedRes = await request({ path: '/api/admin/products', method: 'GET' });
        if (blockedRes.statusCode !== 404 && blockedRes.statusCode !== 401) {
            throw new Error(`Expected 404/401 but got ${blockedRes.statusCode}`);
        }
        console.log(' PASS: Unauthenticated access blocked.');

        // Test 3: Create new product via admin API
        console.log('\n[Test 3] Verifying admin product creation...');
        const createRes = await request({
            path: '/api/admin/products',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieVal
            }
        }, {
            name: 'Ashwagandha Gold Rejuvenator',
            category: 'tea',
            health_segment: 'Health Segment: Vitality',
            price: 29.50,
            stock: 40,
            unit: '/ 100g',
            short_description: 'Adaptogenic roots blended with organic green tea.',
            ingredients: 'Organic Ashwagandha, Green Tea, Cardamom',
            is_published: true,
            is_featured: true
        });
        if (createRes.statusCode !== 201) throw new Error(`Create failed: ${createRes.statusCode} - ${createRes.body}`);
        const createData = JSON.parse(createRes.body);
        const newProdId = createData.product.id;
        console.log(` PASS: Created product "${createData.product.name}" with ID: ${newProdId}`);

        // Test 4: New product immediately visible on public storefront
        console.log('\n[Test 4] Verifying new product appears in public catalog...');
        const checkPub = await request({ path: '/api/products', method: 'GET' });
        const checkPubData = JSON.parse(checkPub.body);
        const found = checkPubData.products.find(p => p.id === newProdId || p.name === 'Ashwagandha Gold Rejuvenator');
        if (!found) throw new Error('Created product was not found in public catalog');
        console.log(' PASS: New product is immediately available in public catalog without code redeployment.');

        // Test 5: Update product
        console.log('\n[Test 5] Verifying product update...');
        const updateRes = await request({
            path: `/api/admin/products?id=${newProdId}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieVal
            }
        }, {
            price: 33.00,
            stock: 75
        });
        if (updateRes.statusCode !== 200) throw new Error('Update failed: ' + updateRes.body);
        const updateData = JSON.parse(updateRes.body);
        if (updateData.product.price !== 33.00 || updateData.product.stock !== 75) {
            throw new Error('Price or stock not updated properly');
        }
        console.log(` PASS: Product updated to price $${updateData.product.price} and stock ${updateData.product.stock}.`);

        // Test 6: Duplicate product
        console.log('\n[Test 6] Verifying product duplication...');
        const dupRes = await request({
            path: `/api/admin/products?action=duplicate&id=${newProdId}`,
            method: 'POST',
            headers: { 'Cookie': cookieVal }
        });
        if (dupRes.statusCode !== 201) throw new Error('Duplicate failed: ' + dupRes.body);
        const dupData = JSON.parse(dupRes.body);
        if (!dupData.product.name.includes('(Copy)') || dupData.product.is_published !== false) {
            throw new Error('Duplicated product should be draft (Copy)');
        }
        console.log(` PASS: Successfully duplicated product as draft "${dupData.product.name}".`);

        // Test 7: Image upload API
        console.log('\n[Test 7] Verifying image upload pipeline...');
        // 1x1 transparent PNG in base64
        const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const uploadRes = await request({
            path: '/api/admin/upload',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieVal
            }
        }, {
            filename: 'test-botanical.png',
            mimeType: 'image/png',
            base64Data: sampleBase64,
            bucketType: 'public'
        });
        if (uploadRes.statusCode !== 200) throw new Error('Upload failed: ' + uploadRes.body);
        const uploadData = JSON.parse(uploadRes.body);
        if (!uploadData.url) throw new Error('No upload URL returned');
        console.log(` PASS: Image uploaded successfully -> URL: ${uploadData.url}`);

        // Test 8: Archive product
        console.log('\n[Test 8] Verifying product archiving...');
        const archiveRes = await request({
            path: `/api/admin/products?id=${newProdId}`,
            method: 'DELETE',
            headers: { 'Cookie': cookieVal }
        });
        if (archiveRes.statusCode !== 200) throw new Error('Archive failed: ' + archiveRes.body);

        // Verify it disappeared from public storefront
        const postArchivePub = await request({ path: '/api/products', method: 'GET' });
        const postArchiveData = JSON.parse(postArchivePub.body);
        const stillPresent = postArchiveData.products.find(p => p.id === newProdId);
        if (stillPresent) throw new Error('Archived product should not appear on public storefront');
        console.log(' PASS: Archived product safely removed from public storefront.');

        console.log('\n=============================================');
        console.log(' ALL 8 MILESTONE 2 ACCEPTANCE TESTS PASSED!');
        console.log('=============================================\n');
    } finally {
        server.close();
    }
}

runTests().catch(err => {
    console.error('TEST RUNNER FAILED:', err);
    process.exit(1);
});
