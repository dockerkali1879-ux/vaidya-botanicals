/**
 * VAIDYA BOTANICALS: Administrator Bootstrap Script
 *
 * Usage:
 *   node scripts/bootstrap-admin.js --email owner@vaidyabotanicals.com --password YourSecurePassword123!
 */

const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../lib/supabase');
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
    const email = args.email || process.env.ADMIN_INITIAL_EMAIL || 'admin@vaidyabotanicals.com';
    const password = args.password || process.env.ADMIN_INITIAL_PASSWORD || 'VaidyaAdmin2026!';
    const fullName = args.name || 'Store Owner';

    console.log('====================================================');
    console.log('  Vaidya Botanicals - Secure Admin Bootstrap Setup  ');
    console.log('====================================================');
    console.log(`Target Email: ${email}`);

    if (password.length < 8) {
        console.error('ERROR: Admin password must be at least 8 characters long.');
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
        const existing = mockDb.adminUsers.find(u => u.email === email);
        if (existing) {
            existing.passwordHash = password;
        } else {
            mockDb.adminUsers.push({ email, passwordHash: password, role: 'admin' });
        }
        console.log(' SUCCESS: Local administrator credentials set.');
        console.log(` Email: ${email}`);
        console.log(` Password: ${password}`);
    }
    console.log('====================================================\n');
}

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
});
