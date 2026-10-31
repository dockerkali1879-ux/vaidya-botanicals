const { createAdminToken, createAdminCookie, logAdminAction, verifyPassword, verifyPasswordAsync } = require('../../lib/auth');
const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseClient, mockDb } = require('../../lib/supabase');

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

        // 1. Neon PostgreSQL Database Check
        if (isDatabaseConfigured()) {
            try {
                const dbRes = await query(`
                    SELECT c.profile_id, c.password_hash, p.id, p.email, p.role
                    FROM public.auth_credentials c
                    JOIN public.profiles p ON p.id = c.profile_id
                    WHERE LOWER(p.email) = $1 AND p.role = 'admin'
                `, [normalizedEmail]);

                if (dbRes.rows.length > 0) {
                    const admin = dbRes.rows[0];
                    const isValid = await verifyPasswordAsync(password, admin.password_hash);
                    if (isValid) {
                        const token = createAdminToken({ id: admin.id, email: admin.email });
                        res.setHeader('Set-Cookie', createAdminCookie(token));
                        await logAdminAction(admin.email, 'LOGIN', 'auth', admin.id, { ip: req.socket?.remoteAddress });
                        return res.status(200).json({
                            success: true,
                            message: 'Administrator authenticated successfully',
                            user: { email: admin.email, role: 'admin' }
                        });
                    }
                }
            } catch (dbErr) {
                // If database query fails or is unreachable during offline testing, proceed to local check
            }

            // Fallback to local admin file if bootstrapped locally
            const localMatch = (mockDb.adminUsers || []).find(u => u.email.toLowerCase() === normalizedEmail);
            if (localMatch) {
                const isValidLocal = await verifyPasswordAsync(password, localMatch.passwordHash);
                if (isValidLocal) {
                    const token = createAdminToken({ id: localMatch.email, email: localMatch.email });
                    res.setHeader('Set-Cookie', createAdminCookie(token));
                    await logAdminAction(localMatch.email, 'LOGIN', 'auth', localMatch.email, { ip: req.socket?.remoteAddress });
                    return res.status(200).json({
                        success: true,
                        message: 'Administrator authenticated successfully',
                        user: { email: localMatch.email, role: 'admin' }
                    });
                }
            }

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 2. Legacy Supabase check
        if (isSupabaseConfigured()) {
            const client = getSupabaseClient();
            const { data: authData, error: authError } = await client.auth.signInWithPassword({
                email: normalizedEmail,
                password
            });

            if (authError || !authData?.user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const token = createAdminToken({ id: authData.user.id, email: normalizedEmail });
            res.setHeader('Set-Cookie', createAdminCookie(token));
            return res.status(200).json({
                success: true,
                message: 'Administrator authenticated successfully',
                user: { email: normalizedEmail, role: 'admin' }
            });
        }

        // 3. Local development fallback
        const match = (mockDb.adminUsers || []).find(
            u => u.email.toLowerCase() === normalizedEmail
        );

        const isMatchValid = match ? await verifyPasswordAsync(password, match.passwordHash) : false;
        if (!match || !isMatchValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = createAdminToken({ id: match.email, email: match.email });
        res.setHeader('Set-Cookie', createAdminCookie(token));
        await logAdminAction(match.email, 'LOGIN', 'auth', match.email, { ip: req.socket?.remoteAddress });

        return res.status(200).json({
            success: true,
            message: 'Administrator authenticated successfully',
            user: { email: match.email, role: 'admin' }
        });
    } catch (err) {
        console.error('[Admin Login Error]:', err);
        return res.status(500).json({ error: 'Internal server error during authentication' });
    }
};
