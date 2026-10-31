process.env.NODE_ENV = 'test';
process.env.PHONE_VERIFICATION_TEST_MODE = 'true';

const http = require('http');
const server = require('../server');
const { hashPassword } = require('../lib/auth');
const { mockDb } = require('../lib/supabase');

const PORT = 3896; // Isolated test port

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
    console.log('--- STARTING MILESTONE 4 VERIFICATION TESTS ---');

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
        // Step 1: Login as Admin
        const loginRes = await request({
            path: '/api/auth/admin-login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'admin@vaidyabotanicals.com', password: 'VaidyaAdmin2026!' });

        const cookieVal = loginRes.headers['set-cookie'][0].split(';')[0];

        // Authenticate Customer
        let customerCookie = '';
        const getCookie = (res) => {
            const raw = res.headers && res.headers['set-cookie'];
            if (!raw) return '';
            if (Array.isArray(raw) && raw.length > 0) return raw[0].split(';')[0];
            if (typeof raw === 'string') return raw.split(';')[0];
            return '';
        };

        const regRes = await request({
            path: '/api/auth/customer-register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            email: 'ananya@example.com',
            password: 'CustomerSecure2026!',
            full_name: 'Ananya Sharma',
            phone: '9876543210'
        });

        customerCookie = getCookie(regRes);
        if (!customerCookie) {
            const custLogin = await request({
                path: '/api/auth/customer-login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, {
                email: 'ananya@example.com',
                password: 'CustomerSecure2026!'
            });
            customerCookie = getCookie(custLogin);
        }

        // Test 1: Place a real order via checkout API
        console.log('\n[Test 1] Verifying customer order creation...');
        const sendOtpRes = await request({
            path: '/api/checkout/otp/send',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { phone: '9876543210' });
        const challengeId = JSON.parse(sendOtpRes.body).challenge_id;

        const verifyOtpRes = await request({
            path: '/api/checkout/otp/verify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { challenge_id: challengeId, otp: '123456', phone: '9876543210' });
        const verificationProof = JSON.parse(verifyOtpRes.body).verification_proof;

        const orderPayload = {
            user: { method: 'email', value: 'ananya@example.com' },
            address: {
                name: 'Ananya Sharma',
                phone: '9876543210',
                email: 'ananya@example.com',
                l1: 'Flat 402, Green Valley Apts',
                l2: 'Rajpur Road',
                city: 'Dehradun',
                state: 'Uttarakhand',
                pin: '248001'
            },
            items: [
                { id: 'lemongrass-immunity-green-tea', name: 'Lemongrass Immunity Green Tea', price: 24.00, qty: 2 }
            ],
            subtotal: 48.00,
            shipping: 0,
            total: 48.00,
            payment: { method: 'COD' },
            verification_proof: verificationProof
        };

        const createOrderRes = await request({
            path: '/api/orders',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': customerCookie
            }
        }, orderPayload);

        if (createOrderRes.statusCode !== 201) throw new Error('Order creation failed: ' + createOrderRes.body);
        const orderData = JSON.parse(createOrderRes.body);
        const newOrderId = orderData.order.id;
        const newOrderNum = orderData.order.order_number;

        if (orderData.order.payment_status !== 'pending' || orderData.order.order_status !== 'new') {
            throw new Error('New COD order must be payment: pending and order: new');
        }
        console.log(` PASS: Order created successfully -> Ref: ${newOrderNum}`);

        // Test 2: Admin inspects order
        console.log('\n[Test 2] Verifying admin order retrieval...');
        const getOrdersRes = await request({
            path: `/api/admin/orders?id=${newOrderId}`,
            method: 'GET',
            headers: { 'Cookie': cookieVal }
        });
        if (getOrdersRes.statusCode !== 200) throw new Error('Admin get order failed');
        const adminOrderData = JSON.parse(getOrdersRes.body);
        if (adminOrderData.order.order_number !== newOrderNum) throw new Error('Mismatched order number');
        console.log(' PASS: Admin successfully inspected order details.');

        // Test 3: Admin dispatches order with courier tracking
        console.log('\n[Test 3] Verifying order dispatch & tracking update...');
        const dispatchRes = await request({
            path: `/api/admin/orders?id=${newOrderId}`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookieVal }
        }, {
            order_status: 'dispatched',
            courier_name: 'BlueDart Express',
            tracking_number: 'BD-88992211',
            admin_notes: 'Packed in eco-glass container with thermal foil.'
        });
        if (dispatchRes.statusCode !== 200) throw new Error('Dispatch update failed: ' + dispatchRes.body);
        const dispatchData = JSON.parse(dispatchRes.body);
        if (dispatchData.order.order_status !== 'dispatched' || dispatchData.order.tracking_number !== 'BD-88992211') {
            throw new Error('Tracking number or status not recorded');
        }
        console.log(' PASS: Order marked dispatched with courier BlueDart & tracking BD-88992211.');

        // Test 4: Admin marks delivered and collects COD payment
        console.log('\n[Test 4] Verifying order delivery & COD payment collection...');
        const deliverRes = await request({
            path: `/api/admin/orders?id=${newOrderId}`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookieVal }
        }, {
            order_status: 'delivered',
            payment_status: 'paid'
        });
        if (deliverRes.statusCode !== 200) throw new Error('Deliver update failed: ' + deliverRes.body);
        const deliverData = JSON.parse(deliverRes.body);
        if (deliverData.order.order_status !== 'delivered' || deliverData.order.payment_status !== 'paid' || !deliverData.order.delivered_at) {
            throw new Error('Delivery status or payment not properly marked');
        }
        console.log(' PASS: Order marked delivered and COD payment recorded as paid.');

        // Test 5: Customer submits support ticket
        console.log('\n[Test 5] Verifying customer support ticket creation...');
        const supportRes = await request({
            path: '/api/support',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            name: 'Ananya Sharma',
            email: 'ananya@example.com',
            order_number: newOrderNum,
            category: 'Product Question',
            subject: 'Optimal brewing temperature for green tea',
            message: 'What water temperature do you recommend for maximum antioxidant extraction?'
        });
        if (supportRes.statusCode !== 201) throw new Error('Support submission failed: ' + supportRes.body);
        const supportData = JSON.parse(supportRes.body);
        const ticketNum = supportData.ticket_number;
        console.log(` PASS: Support ticket created -> Ref: ${ticketNum}`);

        // Test 6: Customer checks support ticket status
        console.log('\n[Test 6] Verifying customer ticket status lookup...');
        const lookupRes = await request({
            path: `/api/support?ticket_number=${ticketNum}&email=ananya@example.com`,
            method: 'GET'
        });
        if (lookupRes.statusCode !== 200) throw new Error('Ticket lookup failed');
        const lookupData = JSON.parse(lookupRes.body);
        if (lookupData.ticket.status !== 'open') throw new Error('Ticket should be open');
        console.log(' PASS: Customer verified support ticket status.');

        // Test 7: Admin updates support ticket with internal notes
        console.log('\n[Test 7] Verifying admin ticket resolution & internal notes...');
        const adminSupRes = await request({
            path: '/api/admin/support',
            method: 'GET',
            headers: { 'Cookie': cookieVal }
        });
        const supList = JSON.parse(adminSupRes.body);
        const targetTicket = supList.tickets.find(t => t.ticket_number === ticketNum);
        if (!targetTicket) throw new Error('Ticket not found in admin list');

        const resolveRes = await request({
            path: `/api/admin/support?id=${targetTicket.id}`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookieVal }
        }, {
            status: 'resolved',
            internal_notes: 'Advised 85°C brewing. Customer satisfied.'
        });
        if (resolveRes.statusCode !== 200) throw new Error('Resolve ticket failed');
        console.log(' PASS: Admin resolved ticket and saved private staff notes.');

        // Test 8: Submit review with verified purchase check
        console.log('\n[Test 8] Verifying review submission with verified purchase detection...');
        const reviewRes = await request({
            path: '/api/reviews',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            product_id: 'lemongrass-immunity-green-tea',
            customer_name: 'Ananya Sharma',
            customer_email: 'ananya@example.com',
            rating: 5,
            title: 'Exquisite aroma and genuine vitality',
            comment: 'Crisp, natural lemongrass aroma. Definitely felt more energised throughout the afternoon.'
        });
        if (reviewRes.statusCode !== 201) throw new Error('Review submission failed: ' + reviewRes.body);
        const reviewData = JSON.parse(reviewRes.body);
        const reviewId = reviewData.review_id;
        console.log(' PASS: Review submitted. Held in pending moderation queue.');

        // Test 9: Public review list must not show unapproved review
        console.log('\n[Test 9] Verifying unapproved review is hidden from storefront...');
        const pubRevRes = await request({
            path: '/api/reviews?product_id=lemongrass-immunity-green-tea',
            method: 'GET'
        });
        const pubRevData = JSON.parse(pubRevRes.body);
        if (pubRevData.reviews.some(r => r.id === reviewId)) {
            throw new Error('Pending review should not be visible on storefront');
        }
        console.log(' PASS: Pending review correctly hidden from public storefront.');

        // Test 10: Admin approves review & verified purchase badge is verified
        console.log('\n[Test 10] Verifying admin review approval...');
        const approveRevRes = await request({
            path: `/api/admin/reviews?id=${reviewId}`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookieVal }
        }, { status: 'approved' });
        if (approveRevRes.statusCode !== 200) throw new Error('Review approval failed');

        const postApprovePub = await request({
            path: '/api/reviews?product_id=lemongrass-immunity-green-tea',
            method: 'GET'
        });
        const postApproveData = JSON.parse(postApprovePub.body);
        const approvedReview = postApproveData.reviews.find(r => r.id === reviewId);
        if (!approvedReview || !approvedReview.verified_purchase) {
            throw new Error('Approved review must be visible with verified_purchase: true');
        }
        console.log(' PASS: Review is now published on storefront with "Verified Purchase" badge.');

        console.log('\n=============================================');
        console.log(' ALL 10 MILESTONE 4 ACCEPTANCE TESTS PASSED!');
        console.log('=============================================\n');
    } finally {
        server.close();
    }
}

runTests().catch(err => {
    console.error('TEST RUNNER FAILED:', err);
    process.exit(1);
});
