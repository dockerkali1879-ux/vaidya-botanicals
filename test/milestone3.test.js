const http = require('http');
const server = require('../server');
const { hashPassword } = require('../lib/auth');
const { mockDb } = require('../lib/supabase');

const PORT = 3897; // Isolated test port

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
    console.log('--- STARTING MILESTONE 3 VERIFICATION TESTS ---');

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
        // Step 1: Login to get admin cookie
        const loginRes = await request({
            path: '/api/auth/admin-login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'admin@vaidyabotanicals.com', password: 'VaidyaAdmin2026!' });

        const cookieVal = loginRes.headers['set-cookie'][0].split(';')[0];

        // Test 1: Public content API
        console.log('\n[Test 1] Verifying public /api/content endpoint...');
        const pubRes = await request({ path: '/api/content', method: 'GET' });
        if (pubRes.statusCode !== 200) throw new Error('Public content failed: ' + pubRes.statusCode);
        const pubData = JSON.parse(pubRes.body);
        if (!pubData.content || !pubData.content.hero || !pubData.content.support_info) {
            throw new Error('Expected hero and support_info sections');
        }
        console.log(' PASS: Public content API returned structured CMS content sections.');

        // Test 2: Unauthenticated edit rejected
        console.log('\n[Test 2] Verifying unauthenticated CMS update is blocked...');
        const blockedRes = await request({
            path: '/api/admin/content',
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        }, { key: 'hero', data: { title: 'Hacked Title' } });
        if (blockedRes.statusCode !== 404 && blockedRes.statusCode !== 401) {
            throw new Error(`Expected 404/401 but got ${blockedRes.statusCode}`);
        }
        console.log(' PASS: Unauthenticated CMS update rejected.');

        // Test 3: Authenticated update of Hero section
        console.log('\n[Test 3] Verifying authenticated update of Homepage Hero...');
        const updateHeroRes = await request({
            path: '/api/admin/content',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieVal
            }
        }, {
            key: 'hero',
            data: {
                eyebrow: 'Living Herbal Alchemy 2026',
                title: 'Botanical Restorative Elixirs for Vital Living',
                description: 'Certified single-origin herbal distillates delivered direct to your door.',
                badge_1: '100% Himalayan Herbs',
                badge_2: 'Zero Fillers',
                badge_3: 'Fair Trade Cooperatives'
            }
        });
        if (updateHeroRes.statusCode !== 200) throw new Error('Hero update failed: ' + updateHeroRes.body);
        console.log(' PASS: Hero content updated successfully in CMS.');

        // Test 4: Verify public API serves updated content without redeployment
        console.log('\n[Test 4] Verifying public storefront reflects updated CMS text...');
        const verifyPub = await request({ path: '/api/content?section=hero', method: 'GET' });
        const verifyData = JSON.parse(verifyPub.body);
        if (verifyData.data.title !== 'Botanical Restorative Elixirs for Vital Living') {
            throw new Error('Updated hero title not served by public API: ' + verifyPub.body);
        }
        console.log(' PASS: Storefront immediately receives updated hero headline.');

        // Test 5: Update FAQs in support_info section
        console.log('\n[Test 5] Verifying FAQ list management in CMS...');
        const newFaqs = [
            { q: 'Do you deliver across all states in India?', a: 'Yes, we provide expedited delivery across all PIN codes with tracking.' },
            { q: 'Are your formulations lab tested?', a: 'Every harvest batch undergoes 14 clinical purity and heavy-metal screenings.' }
        ];
        const updateFaqRes = await request({
            path: '/api/admin/content',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieVal
            }
        }, {
            key: 'support_info',
            data: {
                hours: 'Mon-Sat 8am - 8pm IST',
                email: 'care@vaidyabotanicals.com',
                phone: '+91 98765 43210',
                address: 'Vaidya Botanical Labs, Dehradun',
                faqs: newFaqs
            }
        });
        if (updateFaqRes.statusCode !== 200) throw new Error('FAQ update failed: ' + updateFaqRes.body);

        const verifyFaq = await request({ path: '/api/content?section=support_info', method: 'GET' });
        const faqData = JSON.parse(verifyFaq.body);
        if (!faqData.data.faqs || faqData.data.faqs.length !== 2) throw new Error('FAQs not updated properly');
        console.log(' PASS: FAQ list updated and verified.');

        console.log('\n=============================================');
        console.log(' ALL 5 MILESTONE 3 ACCEPTANCE TESTS PASSED!');
        console.log('=============================================\n');
    } finally {
        server.close();
    }
}

runTests().catch(err => {
    console.error('TEST RUNNER FAILED:', err);
    process.exit(1);
});
