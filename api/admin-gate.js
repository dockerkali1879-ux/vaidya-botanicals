const fs = require('fs');
const path = require('path');
const { verifyAdmin } = require('../lib/auth');

module.exports = async function handler(req, res) {
    const admin = await verifyAdmin(req);

    if (!admin) {
        // Unauthenticated visitor: redirect to storefront without revealing admin dashboard exists
        res.writeHead(302, { Location: '/' });
        return res.end();
    }

    try {
        const adminPath = path.join(process.cwd(), 'admin', 'index.html');
        const content = fs.readFileSync(adminPath, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(content);
    } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
    }
};
