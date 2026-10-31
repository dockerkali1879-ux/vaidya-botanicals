/**
 * VAIDYA BOTANICALS: Administrator Bootstrap Script
 * Target: Neon PostgreSQL 18
 *
 * Usage:
 *   node scripts/bootstrap-admin.js --email owner@vaidyabotanicals.com --password YourSecurePassword123!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDatabaseConfigured, query, transaction } = require('../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../lib/supabase');
const { hashPassword } = require('../lib/auth');
require('dotenv').config();

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--email' && args[i + 1]) parsed.email = args[i + 1];
        if (args[i] === '--password' && args[i + 1]) parsed.password = args[i + 1];
        if (args[i] === '--name' && args[i + 1]) parsed.name = args[i + 1];
    }
    return parsed;
}

async function bootstrap() {
    const args = parseArgs();
    const email = args.email || process.env.ADMIN_INITIAL_EMAIL;
    const password = args.password || process.env.ADMIN_INITIAL_PASSWORD;
    const fullName = args.name || 'Store Owner';

    console.log('====================================================');
    console.log('  Vaidya Botanicals - Secure Admin Bootstrap Setup  ');
    console.log('====================================================');

    if (!email || !password) {
        console.error('ERROR: Both --email and --password arguments are required for secure setup.');
        console.error('Usage:');
        console.error('  npm run bootstrap:admin -- --email "owner@example.com" --password "YourStrongPassword123!"');
        process.exit(1);
    }

    console.log(`Target Email: ${email}`);

    if (password.length < 12) {
        console.error('ERROR: Admin password must be at least 12 characters long for security compliance.');
        process.exit(1);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);

    // 1. Neon PostgreSQL Integration
    if (isDatabaseConfigured()) {
        console.log('[Neon] Provisioning administrator account in Neon PostgreSQL...');

        await transaction(async (client) => {
            const existing = await client.query('SELECT id, role FROM public.profiles WHERE LOWER(email) = $1', [normalizedEmail]);
            let adminProfileId;

            if (existing.rows.length === 0) {
                adminProfileId = `admin_${crypto.randomBytes(12).toString('hex')}`;
                await client.query(`
                    INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
                    VALUES ($1, $2, $3, 'admin', NOW(), NOW())
                `, [adminProfileId, normalizedEmail, fullName]);
                console.log(`[Neon] Created admin profile: ${adminProfileId}`);
            } else {
                adminProfileId = existing.rows[0].id;
                await client.query(`
                    UPDATE public.profiles
                    SET role = 'admin', full_name = $1, updated_at = NOW()
                    WHERE id = $2
                `, [fullName, adminProfileId]);
                console.log(`[Neon] Updated existing profile to admin role: ${adminProfileId}`);
            }

            // Upsert auth credentials
            const credExisting = await client.query('SELECT id FROM public.auth_credentials WHERE LOWER(email) = $1', [normalizedEmail]);
            if (credExisting.rows.length === 0) {
                await client.query(`
                    INSERT INTO public.auth_credentials (
                        profile_id, email, password_hash, email_verified, created_at, updated_at
                    ) VALUES ($1, $2, $3, true, NOW(), NOW())
                `, [adminProfileId, normalizedEmail, passwordHash]);
            } else {
                await client.query(`
                    UPDATE public.auth_credentials
                    SET password_hash = $1, email_verified = true, updated_at = NOW()
                    WHERE LOWER(email) = $2
                `, [passwordHash, normalizedEmail]);
            }
        });

        console.log(' SUCCESS: Neon administrator account provisioned.');
        console.log(` Email: ${normalizedEmail}`);
        console.log(' Role: admin');
    }

    // 2. Also persist to .local-admin.json for offline fallback
    console.log(`Registering admin in local fallback store: ${normalizedEmail}`);
    const localAdminPath = path.join(__dirname, '..', '.local-admin.json');
    let localUsers = [];
    if (fs.existsSync(localAdminPath)) {
        try { localUsers = JSON.parse(fs.readFileSync(localAdminPath, 'utf8')); } catch (e) { localUsers = []; }
    }
    const existingIdx = localUsers.findIndex(u => u.email.toLowerCase() === normalizedEmail);
    const userRecord = { email: normalizedEmail, passwordHash, role: 'admin', updated_at: new Date().toISOString() };
    if (existingIdx !== -1) {
        localUsers[existingIdx] = userRecord;
    } else {
        localUsers.push(userRecord);
    }
    fs.writeFileSync(localAdminPath, JSON.stringify(localUsers, null, 2), { mode: 0o600 });

    if (mockDb.adminUsers) {
        const mockIdx = mockDb.adminUsers.findIndex(u => u.email.toLowerCase() === normalizedEmail);
        if (mockIdx !== -1) {
            mockDb.adminUsers[mockIdx] = userRecord;
        } else {
            mockDb.adminUsers.push(userRecord);
        }
    }

    console.log(' Password: [SECURELY HASHED - PBKDF2/SHA-512]');
    console.log(' Config written to: .local-admin.json (excluded from git)');
    console.log('====================================================\n');
}

if (require.main === module) {
    bootstrap().catch(err => {
        console.error('Fatal bootstrap error:', err);
        process.exit(1);
    });
}

module.exports = bootstrap;
