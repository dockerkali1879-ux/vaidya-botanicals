/**
 * VAIDYA BOTANICALS - Provision Least-Privilege Application Runtime Role
 * Target: Neon PostgreSQL (Development Branch)
 * Enforces least-privilege principle:
 * - CONNECT on neondb
 * - USAGE on public schema
 * - SELECT, INSERT, UPDATE, DELETE on all tables
 * - USAGE, SELECT, UPDATE on all sequences
 * - Default privileges for future migrations
 * - Strict prohibition of DDL / DROP / TRUNCATE / ALTER / SUPERUSER
 *
 * SECRECY: Passwords and connection strings are NEVER echoed to stdout.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('../lib/db'); // Activates Windows DNS resilience resolver
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function provisionRuntimeRole() {
    const adminUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!adminUrl) {
        throw new Error('DATABASE_URL_UNPOOLED is required to provision the runtime role.');
    }

    const adminClient = new Client({
        connectionString: adminUrl,
        ssl: { rejectUnauthorized: false }
    });

    await adminClient.connect();

    try {
        // 1. Check if role already exists
        const checkRes = await adminClient.query(
            "SELECT rolname FROM pg_roles WHERE rolname = 'vaidya_runtime'"
        );

        let runtimePassword = '';

        // Check if existing password is saved in .env.local
        const envLocalPath = path.join(__dirname, '..', '.env.local');
        let envLocalContent = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : '';

        const existingPassMatch = envLocalContent.match(/RUNTIME_ROLE_PASSWORD=([^\r\n]+)/);
        if (existingPassMatch && existingPassMatch[1]) {
            runtimePassword = existingPassMatch[1].trim();
        } else {
            runtimePassword = crypto.randomBytes(24).toString('base64url');
        }

        if (checkRes.rows.length === 0) {
            // Role does not exist: create with secure random password
            await adminClient.query(
                `CREATE ROLE vaidya_runtime WITH LOGIN PASSWORD '${runtimePassword.replace(/'/g, "''")}'`
            );
            console.log('[Role Provision]: Created role vaidya_runtime in Neon.');
        } else {
            // Update password
            await adminClient.query(
                `ALTER ROLE vaidya_runtime WITH PASSWORD '${runtimePassword.replace(/'/g, "''")}'`
            );
            console.log('[Role Provision]: Role vaidya_runtime exists. Updated password.');
        }

        // 2. Grant least-privilege DML permissions
        await adminClient.query('GRANT CONNECT ON DATABASE neondb TO vaidya_runtime');
        await adminClient.query('GRANT USAGE ON SCHEMA public TO vaidya_runtime');
        await adminClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaidya_runtime');
        await adminClient.query('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vaidya_runtime');
        await adminClient.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaidya_runtime');
        await adminClient.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vaidya_runtime');
        console.log('[Role Provision]: Granted least-privilege DML permissions on public schema.');

        // 3. Parse host and database to construct runtime connection string
        const parsedUrl = new URL(adminUrl);
        const host = parsedUrl.host;
        const pathname = parsedUrl.pathname;
        const runtimeDirectUrl = `postgresql://vaidya_runtime:${runtimePassword}@${host}${pathname}?sslmode=require`;

        // Update .env.local with RUNTIME credentials silently
        if (!envLocalContent.includes('RUNTIME_ROLE_PASSWORD=')) {
            envLocalContent += `\n# 5. DEDICATED LEAST-PRIVILEGE RUNTIME ROLE (vaidya_runtime)\nRUNTIME_ROLE_PASSWORD=${runtimePassword}\nDATABASE_URL_RUNTIME=${runtimeDirectUrl}\n`;
        } else {
            envLocalContent = envLocalContent.replace(/RUNTIME_ROLE_PASSWORD=.*/, `RUNTIME_ROLE_PASSWORD=${runtimePassword}`);
            envLocalContent = envLocalContent.replace(/DATABASE_URL_RUNTIME=.*/, `DATABASE_URL_RUNTIME=${runtimeDirectUrl}`);
        }
        fs.writeFileSync(envLocalPath, envLocalContent, 'utf8');
        console.log('[Role Provision]: Updated .env.local with runtime credentials.');

        return {
            host,
            database: pathname.replace('/', ''),
            runtimePassword
        };
    } finally {
        await adminClient.end();
    }
}

async function verifyRuntimeRole(host, database, runtimePassword) {
    console.log('\n--- VERIFYING RUNTIME ROLE PRIVILEGES & SECURITY BOUNDARIES ---');

    const runtimeClient = new Client({
        user: 'vaidya_runtime',
        password: runtimePassword,
        host: host.includes(':') ? host.split(':')[0] : host,
        port: host.includes(':') ? parseInt(host.split(':')[1], 10) : 5432,
        database: database,
        ssl: { rejectUnauthorized: false }
    });

    await runtimeClient.connect();
    console.log('✓ Successfully connected to Neon PostgreSQL as vaidya_runtime.');

    try {
        // 1. Verify role attributes (No superuser, no createrole, no createdb)
        const attrRes = await runtimeClient.query(
            "SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'vaidya_runtime'"
        );
        const attrs = attrRes.rows[0];
        if (attrs.rolsuper || attrs.rolcreaterole || attrs.rolcreatedb) {
            throw new Error('SECURITY VIOLATION: vaidya_runtime has administrative role attributes!');
        }
        console.log('✓ Verified role has NO superuser, NO createrole, and NO createdb privileges.');

        // 2. Verify DML operations (SELECT, INSERT, UPDATE, DELETE)
        const prodRes = await runtimeClient.query('SELECT count(*) FROM public.products');
        console.log(`✓ SELECT on public.products succeeded (Count: ${prodRes.rows[0].count}).`);

        const orderRes = await runtimeClient.query('SELECT count(*) FROM public.orders');
        console.log(`✓ SELECT on public.orders succeeded (Count: ${orderRes.rows[0].count}).`);

        const verifRes = await runtimeClient.query('SELECT count(*) FROM public.phone_verifications');
        console.log(`✓ SELECT on public.phone_verifications succeeded (Count: ${verifRes.rows[0].count}).`);

        const profileRes = await runtimeClient.query('SELECT count(*) FROM public.profiles');
        console.log(`✓ SELECT on public.profiles succeeded (Count: ${profileRes.rows[0].count}).`);

        // Test insert and update in phone_verifications
        const testChallengeId = 'test_perm_' + crypto.randomBytes(8).toString('hex');
        await runtimeClient.query(`
            INSERT INTO public.phone_verifications (
                phone, session_id, challenge_id, status, purpose, expires_at, created_at, updated_at
            ) VALUES ('9999999999', 'test_sess', $1, 'pending', 'checkout', NOW() + INTERVAL '5 minutes', NOW(), NOW())
        `, [testChallengeId]);
        console.log('✓ INSERT on public.phone_verifications succeeded.');

        await runtimeClient.query(
            "UPDATE public.phone_verifications SET status = 'expired' WHERE challenge_id = $1",
            [testChallengeId]
        );
        console.log('✓ UPDATE on public.phone_verifications succeeded.');

        await runtimeClient.query(
            'DELETE FROM public.phone_verifications WHERE challenge_id = $1',
            [testChallengeId]
        );
        console.log('✓ DELETE on public.phone_verifications succeeded.');

        // 3. Verify DDL privileges are STRICTLY BLOCKED
        let ddlBlocked = false;
        try {
            await runtimeClient.query('CREATE TABLE public.malicious_test (id int)');
        } catch (e) {
            ddlBlocked = true;
            console.log('✓ DDL execution (CREATE TABLE) strictly rejected: ' + e.code + ' (permission denied).');
        }
        if (!ddlBlocked) {
            throw new Error('SECURITY VIOLATION: vaidya_runtime was able to execute DDL (CREATE TABLE)!');
        }

        let dropBlocked = false;
        try {
            await runtimeClient.query('DROP TABLE public.products');
        } catch (e) {
            dropBlocked = true;
            console.log('✓ Destructive DDL (DROP TABLE) strictly rejected: ' + e.code + ' (must be owner of table).');
        }
        if (!dropBlocked) {
            throw new Error('SECURITY VIOLATION: vaidya_runtime was able to execute DROP TABLE!');
        }

        console.log('\n[SUCCESS]: vaidya_runtime role verified with complete least-privilege guarantees.\n');
    } finally {
        await runtimeClient.end();
    }
}

async function main() {
    try {
        const { host, database, runtimePassword } = await provisionRuntimeRole();
        await verifyRuntimeRole(host, database, runtimePassword);
    } catch (err) {
        console.error('\n[Provisioning Error]:', err.message);
        process.exit(1);
    }
}

main();
