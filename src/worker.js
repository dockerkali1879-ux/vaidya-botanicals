/**
 * VAIDYA BOTANICALS - Cloudflare Workers Application Entrypoint
 * Provides edge request routing, stealth admin gating, and API dispatching
 * Backed by Cloudflare Hyperdrive, Static Assets, and Cloudflare R2.
 */

const { verifyAdmin } = require('../lib/auth');
const { setWorkerEnv } = require('../lib/db');

// Route table mapping
const routes = {
    // Auth APIs
    '/api/auth/otp-send': require('../api/auth/otp-send'),
    '/api/auth/otp-verify': require('../api/auth/otp-verify'),
    '/api/auth/customer-session': require('../api/auth/customer-session'),
    '/api/auth/customer-logout': require('../api/auth/customer-logout'),
    '/api/auth/customer-login': require('../api/auth/customer-login'),
    '/api/auth/customer-register': require('../api/auth/customer-register'),
    '/api/auth/customer-verify': require('../api/auth/customer-verify'),
    '/api/auth/customer-reset': require('../api/auth/customer-reset'),
    // Admin Auth APIs (Passwordless Phone OTP on Edge - Zero PBKDF2 CPU usage)
    '/api/auth/admin-otp/send': require('../api/auth/admin-otp-send'),
    '/api/auth/admin-otp/verify': require('../api/auth/admin-otp-verify'),
    '/api/auth/admin-session': require('../api/auth/admin-session'),
    '/api/auth/admin-logout': require('../api/auth/admin-logout'),

    // Checkout Phone OTP APIs (Guest Checkout)
    '/api/checkout/otp/send': require('../api/checkout/otp/send'),
    '/api/checkout/otp/verify': require('../api/checkout/otp/verify'),

    // Cart APIs
    '/api/cart': require('../api/cart/index'),
    '/api/cart/merge': require('../api/cart/merge'),

    // Products APIs
    '/api/products': require('../api/products/index'),
    '/api/admin/products': require('../api/admin/products'),

    // Content APIs
    '/api/content': require('../api/content/index'),
    '/api/admin/content': require('../api/admin/content'),

    // Orders APIs
    '/api/orders': require('../api/orders/index'),
    '/api/admin/orders': require('../api/admin/orders'),

    // Reviews APIs
    '/api/reviews': require('../api/reviews/index'),
    '/api/admin/reviews': require('../api/admin/reviews'),

    // Support APIs
    '/api/support': require('../api/support/index'),
    '/api/admin/support': require('../api/admin/support'),

    // Upload & Cloudinary APIs
    '/api/admin/upload': require('../api/admin/upload'),
    '/api/admin/cloudinary-signature': require('../api/admin/cloudinary-signature'),

    // Razorpay APIs
    '/api/razorpay/create-order': require('../api/razorpay/create-order'),
    '/api/razorpay/verify-payment': require('../api/razorpay/verify-payment')
};

async function executeApiHandler(request, env, ctx, handler) {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());

    let body = {};
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                body = await request.json();
            } catch (e) {
                body = {};
            }
        }
    }

    const headers = {};
    for (const [k, v] of request.headers.entries()) {
        headers[k.toLowerCase()] = v;
    }

    const req = {
        method: request.method,
        url: url.pathname + url.search,
        headers,
        query,
        body,
        env,
        ctx
    };

    let statusCode = 200;
    const responseHeaders = new Headers();

    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            setHeader(name, value) {
                if (Array.isArray(value)) {
                    value.forEach(v => responseHeaders.append(name, v));
                } else if (name.toLowerCase() === 'set-cookie') {
                    responseHeaders.append(name, value);
                } else {
                    responseHeaders.set(name, value);
                }
            },
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                if (!responseHeaders.has('Content-Type')) {
                    responseHeaders.set('Content-Type', 'application/json');
                }
                resolve(new Response(JSON.stringify(data), {
                    status: statusCode,
                    headers: responseHeaders
                }));
            },
            end(text) {
                resolve(new Response(text, {
                    status: statusCode,
                    headers: responseHeaders
                }));
            }
        };

        Promise.resolve(handler(req, res)).catch((err) => {
            console.error('[Worker API Handler Error]:', err);
            resolve(new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }));
        });
    });
}

const worker = {
    async fetch(request, env, ctx) {
        // Set active Worker environment for lib/db.js Hyperdrive queries
        setWorkerEnv(env);

        const url = new URL(request.url);
        const pathname = url.pathname;
        let response = null;

        // 1. ADMIN DASHBOARD STEALTH PROTECTION
        // Any request targeting /admin, /admin/, or direct /admin/index.html must be verified
        if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/')) {
            // Adapt request for verifyAdmin
            const headers = {};
            for (const [k, v] of request.headers.entries()) {
                headers[k.toLowerCase()] = v;
            }
            const admin = await verifyAdmin({ headers, env });
            if (!admin) {
                // Stealth requirement: Return 404 or redirect to / without revealing admin exists
                response = new Response('404 Not Found', {
                    status: 404,
                    headers: { 'Content-Type': 'text/plain' }
                });
            } else if (env.ASSETS) {
                // Authorized admin: serve admin/index.html through static assets binding
                const targetPath = (pathname === '/admin' || pathname === '/admin/') ? '/admin/index.html' : pathname;
                const adminAssetUrl = new URL(targetPath, request.url);
                response = await env.ASSETS.fetch(new Request(adminAssetUrl, request));
            }
        } else if (pathname.startsWith('/api/')) {
            // 2. API ROUTE DISPATCHER
            const cleanPath = pathname.length > 5 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
            const handler = routes[cleanPath];

            if (handler) {
                response = await executeApiHandler(request, env, ctx, handler);
            } else {
                response = new Response(JSON.stringify({ error: 'Endpoint not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        } else if (env.ASSETS) {
            // 3. STOREFRONT & STATIC ASSETS FALLBACK
            response = await env.ASSETS.fetch(request);
        } else {
            response = new Response('Vaidya Botanicals Edge Worker', { status: 200 });
        }

        if (!response) {
            response = new Response('404 Not Found', { status: 404 });
        }

        // Staging environment protection: ensure noindex, nofollow on all responses
        const securedHeaders = new Headers(response.headers);
        securedHeaders.set('X-Robots-Tag', 'noindex, nofollow');

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: securedHeaders
        });
    }
};

export default worker;
