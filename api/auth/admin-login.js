const { createAdminToken, createAdminCookie, logAdminAction, verifyPassword } = require('../../lib/auth');
const { isSupabaseConfigured, getSupabaseAdmin, getSupabaseClient, mockDb } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        if (isSupabaseConfigured()) {
            const client = getSupabaseClient();
            const { data: authData, error: authError } = await client.auth.signInWithPassword({
                email: normalizedEmail,
                password
            });

            if (authError || !authData?.user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const adminClient = getSupabaseAdmin();
            const { data: profile, error: profileError } = await adminClient
                .from('profiles')
                .select('id, email, role')
                .eq('id', authData.user.id)
                .single();

            if (profileError || !profile || profile.role !== 'admin') {
                return res.status(403).json({ error: 'Access denied: not an administrator' });
            }

            const token = createAdminToken({ id: profile.id, email: profile.email });
            const cookieHeader = createAdminCookie(token);

            res.setHeader('Set-Cookie', cookieHeader);
            await logAdminAction(profile.email, 'LOGIN', 'auth', profile.id, { ip: req.socket?.remoteAddress });

            return res.status(200).json({
                success: true,
                message: 'Administrator authenticated successfully',
                user: { email: profile.email, role: 'admin' }
            });
        } else {
            // Local development fallback
            const match = mockDb.adminUsers.find(
                u => u.email.toLowerCase() === normalizedEmail
            );

            if (!match || !verifyPassword(password, match.passwordHash)) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const token = createAdminToken({ id: 'mock-admin-id', email: match.email });
            const cookieHeader = createAdminCookie(token);

            res.setHeader('Set-Cookie', cookieHeader);
            await logAdminAction(match.email, 'LOGIN_MOCK', 'auth', 'mock-admin-id', {});

            return res.status(200).json({
                success: true,
                message: 'Administrator authenticated successfully (local dev mode)',
                user: { email: match.email, role: 'admin' }
            });
        }
    } catch (err) {
        console.error('[Admin Login Error]:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
