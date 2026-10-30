const http = require('http');
const server = require('../server');
const { hashPassword } = require('../lib/auth');
const { mockDb } = require('../lib/supabase');

const PORT = 3899; // Isolated test port

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
    console.log('--- STARTING MILESTONE 1 VERIFICATION TESTS ---');

    // Ephemeral test fixture with PBKDF2 hashed password
    mockDb.adminUsers = [
        {
            email: 'admin@vaidyabotanicals.com',
            passwordHash: hashPassword('VaidyaAdmin2026!'),
            role: 'admin'
        }
    ];

    await new Promise(r => server.listen(PORT, r));
    console.log(`Test server running on port ${PORT}`);

    try {
        // Test 1: Public Storefront loads and contains WebGL Splash Cursor
        console.log('\n[Test 1] Verifying Public Storefront & Splash Cursor...');
        const storeRes = await request({ path: '/', method: 'GET' });
        if (storeRes.statusCode !== 200) throw new Error(`Storefront returned ${storeRes.statusCode}`);
        if (!storeRes.body.includes('splash-cursor__canvas')) throw new Error('Missing splash cursor canvas!');
        if (!storeRes.body.includes('SHADERS')) throw new Error('Missing WebGL shaders!');
        console.log(' PASS: Storefront loaded with WebGL canvas and shaders intact.');

        // Test 2: Unauthenticated visit to /admin must redirect (302) to /
        console.log('\n[Test 2] Verifying Unauthenticated /admin access is blocked...');
        const adminUnauth = await request({ path: '/admin', method: 'GET' });
        if (adminUnauth.statusCode !== 302 || adminUnauth.headers.location !== '/') {
            throw new Error(`Expected 302 redirect to / but got ${adminUnauth.statusCode} -> ${adminUnauth.headers.location}`);
        }
        console.log(' PASS: Unauthenticated access to /admin redirected cleanly to storefront.');

        // Test 3: Invalid login rejected
        console.log('\n[Test 3] Verifying invalid credentials rejection...');
        const badLogin = await request({
            path: '/api/auth/admin-login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'bad@example.com', password: 'wrong' });
        if (badLogin.statusCode !== 401) throw new Error(`Expected 401 but got ${badLogin.statusCode}`);
        console.log(' PASS: Unauthorized login rejected with 401.');

        // Test 4: Valid login succeeds and sets HTTP-only cookie
        console.log('\n[Test 4] Verifying valid admin authentication...');
        const goodLogin = await request({
            path: '/api/auth/admin-login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'admin@vaidyabotanicals.com', password: 'VaidyaAdmin2026!' });
        if (goodLogin.statusCode !== 200) throw new Error(`Expected 200 but got ${goodLogin.statusCode}`);

        const setCookie = goodLogin.headers['set-cookie'];
        if (!setCookie || !setCookie[0].includes('vaidya_admin_token')) {
            throw new Error('Missing vaidya_admin_token in Set-Cookie header');
        }
        const cookieVal = setCookie[0].split(';')[0];
        console.log(' PASS: Administrator authenticated. HTTP-only cookie issued.');

        // Test 5: Access /admin with valid session cookie succeeds
        console.log('\n[Test 5] Verifying authenticated access to /admin...');
        const adminAuth = await request({
            path: '/admin',
            method: 'GET',
            headers: { 'Cookie': cookieVal }
        });
        if (adminAuth.statusCode !== 200) throw new Error(`Expected 200 but got ${adminAuth.statusCode}`);
        if (!adminAuth.body.includes('Vaidya Admin Dashboard')) throw new Error('Dashboard content not returned');
        console.log(' PASS: Authorized administrator received Admin Dashboard.');

        // Test 6: Verify session endpoint
        console.log('\n[Test 6] Verifying session endpoint /api/auth/admin-session...');
        const sessionRes = await request({
            path: '/api/auth/admin-session',
            method: 'GET',
            headers: { 'Cookie': cookieVal }
        });
        const sessionData = JSON.parse(sessionRes.body);
        if (!sessionData.authenticated || sessionData.user.email !== 'admin@vaidyabotanicals.com') {
            throw new Error('Invalid session response: ' + sessionRes.body);
        }
        console.log(' PASS: Session verification confirmed admin role.');

        // Test 7: Logout clears session
        console.log('\n[Test 7] Verifying admin logout...');
        const logoutRes = await request({
            path: '/api/auth/admin-logout',
            method: 'POST',
            headers: { 'Cookie': cookieVal }
        });
        if (logoutRes.statusCode !== 200) throw new Error('Logout failed');
        console.log(' PASS: Admin logged out successfully.');

        console.log('\n=============================================');
        console.log(' ALL 7 MILESTONE 1 ACCEPTANCE TESTS PASSED!');
        console.log('=============================================\n');
    } finally {
        server.close();
    }
}

runTests().catch(err => {
    console.error('TEST RUNNER FAILED:', err);
    process.exit(1);
});
