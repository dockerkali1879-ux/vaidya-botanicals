/**
 * VAIDYA BOTANICALS: Administrator Bootstrap Script
 *
 * Usage:
 *   node scripts/bootstrap-admin.js --email owner@vaidyabotanicals.com --password YourSecurePassword123!
 */

const fs = require('fs');
const path = require('path');
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

    if (isSupabaseConfigured()) {
        const supabase = getSupabaseAdmin();
        console.log('[Supabase] Checking if user already exists in Auth...');

        // 1. Create or retrieve auth user
        const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) {
            console.error('ERROR listing users from Supabase:', listError.message);
            process.exit(1);
        }

        let user = usersData.users.find(u => u.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            console.log('[Supabase] Creating user in Supabase Auth...');
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name: fullName, role: 'admin' }
            });

            if (createError) {
                console.error('ERROR creating auth user:', createError.message);
                process.exit(1);
            }
            user = newUser.user;
            console.log(`[Supabase] Auth user created with ID: ${user.id}`);
        } else {
            console.log(`[Supabase] Existing user found (ID: ${user.id}). Updating password & metadata...`);
            await supabase.auth.admin.updateUserById(user.id, {
                password,
                user_metadata: { full_name: fullName, role: 'admin' }
            });
        }

        // 2. Assign role = 'admin' in profiles table
        console.log('[Supabase] Assigning role = admin in profiles table...');
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: user.id,
                email: user.email,
                full_name: fullName,
                role: 'admin',
                updated_at: new Date().toISOString()
            });

        if (profileError) {
            console.error('ERROR updating profiles table:', profileError.message);
            process.exit(1);
        }

        console.log(' SUCCESS: Administrator account created and verified.');
        console.log(` Email: ${email}`);
        console.log(' Role: admin');
        console.log(' Row Level Security (RLS) policies allow this user full dashboard access.');
    } else {
        console.log('[Development Mode] Supabase live credentials not detected.');
        console.log(`Registering admin in local fallback store: ${email}`);
        const hashed = hashPassword(password);
        const localAdminPath = path.join(__dirname, '..', '.local-admin.json');
        let localUsers = [];
        if (fs.existsSync(localAdminPath)) {
            try { localUsers = JSON.parse(fs.readFileSync(localAdminPath, 'utf8')); } catch (e) { localUsers = []; }
        }
        const existingIdx = localUsers.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
        const userRecord = { email, passwordHash: hashed, role: 'admin', updated_at: new Date().toISOString() };
        if (existingIdx !== -1) {
            localUsers[existingIdx] = userRecord;
        } else {
            localUsers.push(userRecord);
        }
        fs.writeFileSync(localAdminPath, JSON.stringify(localUsers, null, 2), { mode: 0o600 });

        // Update in-memory mockDb as well
        const mockIdx = mockDb.adminUsers.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
        if (mockIdx !== -1) {
            mockDb.adminUsers[mockIdx] = userRecord;
        } else {
            mockDb.adminUsers.push(userRecord);
        }

        console.log(' SUCCESS: Local administrator credentials securely hashed and stored.');
        console.log(` Email: ${email}`);
        console.log(' Password: [SECURELY HASHED - PBKDF2/SHA-512]');
        console.log(' Config written to: .local-admin.json (excluded from git)');
    }
    console.log('====================================================\n');
}

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
});
