/**
 * VAIDYA BOTANICALS - Application Server
 * Serves public storefront, gates private admin interface, and routes serverless API calls.
 */

const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { verifyAdmin } = require('./lib/auth');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Content type mapping
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};

function serveFile(res, filePath, contentType, statusCode = 200) {
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(statusCode, {
            'Content-Type': contentType || 'text/html; charset=UTF-8',
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow'
        });
        res.end(content);
    });
}

function parseJsonBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Helper response wrappers
    res.json = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };
    res.status = (code) => {
        res.statusCode = code;
        return {
            json: (data) => {
                res.writeHead(code, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            },
            end: (text) => {
                res.writeHead(code, { 'Content-Type': 'text/plain' });
                res.end(text);
            }
        };
    };

    // 1. PUBLIC STOREFRONT (/)
    if (pathname === '/' || pathname === '/index.html') {
        const storefrontPath = path.join(__dirname, 'index.html');
        return serveFile(res, storefrontPath, MIME_TYPES['.html']);
    }

    // 2. PRIVATE ACCESS AUTHENTICATION PAGE (/private-login)
    if (pathname === '/private-login') {
        const loginPage = path.join(__dirname, 'private-login.html');
        return serveFile(res, loginPage, MIME_TYPES['.html']);
    }

    // 3. PRIVATE ADMIN AREA (/admin) - STRICT SERVER-SIDE CHECK
    if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/')) {
        const admin = await verifyAdmin(req);
        if (!admin) {
            // Requirement 3: Ordinary visitors receive 404 or redirect without revealing admin functionality
            res.writeHead(302, { Location: '/' });
            return res.end();
        }
        const adminHtml = path.join(__dirname, 'admin', 'index.html');
        return serveFile(res, adminHtml, MIME_TYPES['.html']);
    }

    // 4. API ROUTES
    if (pathname.startsWith('/api/')) {
        req.body = await parseJsonBody(req);
        req.query = parsedUrl.query;

        // Auth APIs
        if (pathname === '/api/auth/admin-otp/send') {
            const handler = require('./api/auth/admin-otp-send');
            return handler(req, res);
        }
        if (pathname === '/api/auth/admin-otp/verify') {
            const handler = require('./api/auth/admin-otp-verify');
            return handler(req, res);
        }
        if (pathname === '/api/auth/admin-login') {
            const handler = require('./api/auth/admin-login');
            return handler(req, res);
        }
        if (pathname === '/api/auth/admin-session') {
            const handler = require('./api/auth/admin-session');
            return handler(req, res);
        }
        if (pathname === '/api/auth/admin-logout') {
            const handler = require('./api/auth/admin-logout');
            return handler(req, res);
        }

        // Checkout Phone OTP APIs (Guest Phone Verification)
        if (pathname === '/api/checkout/otp/send') {
            const handler = require('./api/checkout/otp/send');
            return handler(req, res);
        }
        if (pathname === '/api/checkout/otp/verify') {
            const handler = require('./api/checkout/otp/verify');
            return handler(req, res);
        }

        // Stytch Customer Auth APIs (Passwordless Email OTP)
        if (pathname === '/api/auth/otp-send') {
            const handler = require('./api/auth/otp-send');
            return handler(req, res);
        }
        if (pathname === '/api/auth/otp-verify') {
            const handler = require('./api/auth/otp-verify');
            return handler(req, res);
        }

        // Customer Auth APIs
        if (pathname === '/api/auth/customer-register') {
            const handler = require('./api/auth/customer-register');
            return handler(req, res);
        }
        if (pathname === '/api/auth/customer-login') {
            const handler = require('./api/auth/customer-login');
            return handler(req, res);
        }
        if (pathname === '/api/auth/customer-logout') {
            const handler = require('./api/auth/customer-logout');
            return handler(req, res);
        }
        if (pathname === '/api/auth/customer-session') {
            const handler = require('./api/auth/customer-session');
            return handler(req, res);
        }
        if (pathname === '/api/auth/customer-verify') {
            const handler = require('./api/auth/customer-verify');
            return handler(req, res);
        }
        if (pathname === '/api/auth/customer-reset') {
            const handler = require('./api/auth/customer-reset');
            return handler(req, res);
        }

        // Shopping Cart APIs
        if (pathname === '/api/cart/merge') {
            const handler = require('./api/cart/merge');
            return handler(req, res);
        }
        if (pathname === '/api/cart') {
            const handler = require('./api/cart/index');
            return handler(req, res);
        }

        // Products APIs
        if (pathname === '/api/products' || pathname.startsWith('/api/products/')) {
            const handler = require('./api/products/index');
            return handler(req, res);
        }
        if (pathname === '/api/admin/products' || pathname.startsWith('/api/admin/products/')) {
            const handler = require('./api/admin/products');
            return handler(req, res);
        }
        // Content APIs
        if (pathname === '/api/content' || pathname.startsWith('/api/content/')) {
            const handler = require('./api/content/index');
            return handler(req, res);
        }
        if (pathname === '/api/admin/content' || pathname.startsWith('/api/admin/content/')) {
            const handler = require('./api/admin/content');
            return handler(req, res);
        }

        // Orders APIs
        if (pathname === '/api/orders' || pathname.startsWith('/api/orders/')) {
            const handler = require('./api/orders/index');
            return handler(req, res);
        }
        if (pathname === '/api/admin/orders' || pathname.startsWith('/api/admin/orders/')) {
            const handler = require('./api/admin/orders');
            return handler(req, res);
        }

        // Support APIs
        if (pathname === '/api/support' || pathname.startsWith('/api/support/')) {
            const handler = require('./api/support/index');
            return handler(req, res);
        }
        if (pathname === '/api/admin/support' || pathname.startsWith('/api/admin/support/')) {
            const handler = require('./api/admin/support');
            return handler(req, res);
        }

        // Reviews APIs
        if (pathname === '/api/reviews' || pathname.startsWith('/api/reviews/')) {
            const handler = require('./api/reviews/index');
            return handler(req, res);
        }
        if (pathname === '/api/admin/reviews' || pathname.startsWith('/api/admin/reviews/')) {
            const handler = require('./api/admin/reviews');
            return handler(req, res);
        }

        // Upload API
        if (pathname === '/api/admin/upload') {
            const handler = require('./api/admin/upload');
            return handler(req, res);
        }
        if (pathname === '/api/admin/cloudinary-signature') {
            const handler = require('./api/admin/cloudinary-signature');
            return handler(req, res);
        }

        // Additional API route handlers will be mounted in upcoming milestones
        const apiPath = path.join(__dirname, pathname + '.js');
        if (fs.existsSync(apiPath)) {
            const handler = require(apiPath);
            return handler(req, res);
        }

        return res.status(404).json({ error: 'Endpoint not found' });
    }

    // 5. STATIC FILES (CSS, JS, Images)
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        return serveFile(res, filePath, MIME_TYPES[ext] || 'application/octet-stream');
    }

    // Default 404
    const notFoundPath = path.join(__dirname, '404.html');
    if (fs.existsSync(notFoundPath)) {
        return serveFile(res, notFoundPath, 'text/html; charset=UTF-8', 404);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`[Vaidya Botanicals] Server running at http://localhost:${PORT}`);
        console.log(`[Storefront] http://localhost:${PORT}/`);
        console.log(`[Private Auth Gate] http://localhost:${PORT}/private-login`);
    });
}

module.exports = server;
