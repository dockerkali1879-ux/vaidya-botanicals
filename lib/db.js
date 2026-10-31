/**
 * VAIDYA BOTANICALS - Database Access Layer
 * Target Platform: Neon PostgreSQL 18 / Google Cloud Run
 * Provides connection pooling, transaction orchestration, and graceful shutdown.
 */

// Windows DNS resilience: Fallback to public DNS resolvers if OS getaddrinfo fails for Neon
if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof __dirname !== 'undefined') {
    try {
        const dns = require('dns');
        if (dns && dns.setDefaultResultOrder) {
            dns.setDefaultResultOrder('ipv4first');
        }

        if (dns && dns.lookup && typeof dns.Resolver === 'function') {
            const originalLookup = dns.lookup;
            const fallbackResolver = new dns.Resolver();
            try {
                fallbackResolver.setServers(['8.8.8.8', '1.1.1.1']);
            } catch (e) {
                // Ignore if custom DNS servers cannot be set
            }

            dns.lookup = function resilientLookup(hostname, options, callback) {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                originalLookup(hostname, options, (err, address, family) => {
                    if (err && typeof hostname === 'string' && hostname.includes('neon.tech')) {
                        fallbackResolver.resolve4(hostname, (rErr, addresses) => {
                            if (rErr || !addresses || addresses.length === 0) {
                                return callback(err);
                            }
                            if (options && options.all) {
                                return callback(null, addresses.map(a => ({ address: a, family: 4 })));
                            }
                            return callback(null, addresses[0], 4);
                        });
                    } else {
                        callback(err, address, family);
                    }
                });
            };
        }
    } catch (e) {
        // Non-Node runtime or restricted edge environment
    }
}
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool, Client } = require('pg');

// 1. Environment Loading: Prioritize .env.local (ignored), fallback to .env
if (typeof __dirname !== 'undefined') {
    try {
        const envLocalPath = path.join(__dirname, '..', '.env.local');
        if (fs && fs.existsSync && fs.existsSync(envLocalPath)) {
            dotenv.config({ path: envLocalPath });
        }
    } catch (e) {
        // Edge runtime fallback
    }
}
if (dotenv && typeof dotenv.config === 'function') {
    try {
        dotenv.config();
    } catch (e) {
        // Edge runtime fallback
    }
}

// 2. Connection Strings: Prioritize direct endpoint for pg.Pool if pooler DNS record is not provisioned
const DIRECT_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';
const POOLED_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';

// 3. Worker Environment Reference (Cloudflare Workers Hyperdrive integration)
let currentWorkerEnv = null;

function setWorkerEnv(env) {
    currentWorkerEnv = env;
}

function getWorkerEnv() {
    return currentWorkerEnv;
}

/**
 * Checks whether valid Neon PostgreSQL credentials are provided.
 */
function isDatabaseConfigured() {
    if (currentWorkerEnv && currentWorkerEnv.HYPERDRIVE && currentWorkerEnv.HYPERDRIVE.connectionString) {
        return true;
    }
    return Boolean(
        POOLED_URL &&
        (POOLED_URL.startsWith('postgres://') || POOLED_URL.startsWith('postgresql://')) &&
        !POOLED_URL.includes('yourPassword') &&
        !POOLED_URL.includes('placeholder')
    );
}

// 3. SSL Configuration: Neon requires TLS/SSL connection
function getSslConfig(connectionUrl) {
    if (!connectionUrl) return undefined;
    // Localhost or Docker without SSL
    if (connectionUrl.includes('localhost') || connectionUrl.includes('127.0.0.1')) {
        return false;
    }
    return {
        rejectUnauthorized: false
    };
}

// 4. Connection Pool Initialization
let pool = null;

function getPool() {
    if (!pool) {
        if (!isDatabaseConfigured()) {
            return null;
        }

        const maxConnections = parseInt(process.env.DB_POOL_MAX || '5', 10);
        pool = new Pool({
            connectionString: POOLED_URL,
            max: maxConnections,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 5000,
            ssl: getSslConfig(POOLED_URL)
        });

        pool.on('error', (err) => {
            console.error('[Neon Pool Error]: Unexpected client error on idle connection:', err.message);
        });
    }
    return pool;
}

/**
 * Executes a parameterized SQL query on the connection pool or Hyperdrive client.
 * @param {string} text - SQL query string with $1, $2 placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
    // 1. Cloudflare Workers + Hyperdrive connection path
    if (currentWorkerEnv && currentWorkerEnv.HYPERDRIVE && currentWorkerEnv.HYPERDRIVE.connectionString) {
        const connectionString = currentWorkerEnv.HYPERDRIVE.connectionString;
        const client = new Client({
            connectionString,
            ssl: getSslConfig(connectionString)
        });
        const start = Date.now();
        await client.connect();
        try {
            const res = await client.query(text, params);
            const duration = Date.now() - start;
            if (process.env.NODE_ENV === 'development' && duration > 500) {
                console.warn(`[Slow Hyperdrive Query] (${duration}ms): ${text.substring(0, 100)}`);
            }
            return res;
        } catch (err) {
            console.error('[Hyperdrive Query Error]:', {
                message: err.message,
                query: text.substring(0, 150),
                params: params.map(p => (typeof p === 'string' && p.length > 30 ? p.substring(0, 30) + '...' : p))
            });
            throw err;
        } finally {
            await client.end().catch(() => {});
        }
    }

    // 2. Standard Node.js connection pool path (server.js, local tests, migrations)
    const currentPool = getPool();
    if (!currentPool) {
        throw new Error('Database is not configured. Set DATABASE_URL in .env.local.');
    }

    const start = Date.now();
    try {
        const res = await currentPool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV === 'development' && duration > 500) {
            console.warn(`[Slow Query Alert] (${duration}ms): ${text.substring(0, 100)}`);
        }
        return res;
    } catch (err) {
        console.error('[Database Query Error]:', {
            message: err.message,
            query: text.substring(0, 150),
            params: params.map(p => (typeof p === 'string' && p.length > 30 ? p.substring(0, 30) + '...' : p))
        });
        throw err;
    }
}

/**
 * Executes operations inside an isolated database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 * @param {Function} callback - Async function receiving the dedicated client
 */
async function transaction(callback) {
    // 1. Cloudflare Workers + Hyperdrive connection path
    if (currentWorkerEnv && currentWorkerEnv.HYPERDRIVE && currentWorkerEnv.HYPERDRIVE.connectionString) {
        const connectionString = currentWorkerEnv.HYPERDRIVE.connectionString;
        const client = new Client({
            connectionString,
            ssl: getSslConfig(connectionString)
        });
        await client.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackErr) {
                console.error('[Hyperdrive Transaction Rollback Error]:', rollbackErr.message);
            }
            throw err;
        } finally {
            await client.end().catch(() => {});
        }
    }

    // 2. Standard Node.js connection pool path
    const currentPool = getPool();
    if (!currentPool) {
        throw new Error('Database is not configured. Set DATABASE_URL in .env.local.');
    }

    const client = await currentPool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('[Transaction Rollback Error]:', rollbackErr.message);
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Creates a standalone direct/unpooled connection client.
 * Preferred for schema migrations (DDL) and administrative tasks.
 */
function createDirectClient() {
    if (!DIRECT_URL) {
        throw new Error('Direct database URL is not configured. Set DATABASE_URL_UNPOOLED.');
    }

    return new Client({
        connectionString: DIRECT_URL,
        ssl: getSslConfig(DIRECT_URL)
    });
}

/**
 * Runs a health check against the Neon PostgreSQL database.
 * Returns server version, database name, and roundtrip ping latency.
 */
async function healthCheck() {
    if (!isDatabaseConfigured()) {
        return {
            connected: false,
            configured: false,
            message: 'Database connection string not configured.'
        };
    }

    const start = Date.now();
    try {
        const res = await query('SELECT 1 AS healthy, NOW() AS server_time, current_database() AS db_name, version() AS version');
        const latency = Date.now() - start;
        return {
            connected: true,
            configured: true,
            latencyMs: latency,
            dbName: res.rows[0].db_name,
            serverTime: res.rows[0].server_time,
            version: res.rows[0].version
        };
    } catch (err) {
        return {
            connected: false,
            configured: true,
            error: err.message
        };
    }
}

/**
 * Closes the connection pool gracefully (for application shutdown and tests).
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    query,
    transaction,
    getPool,
    createDirectClient,
    healthCheck,
    closePool,
    isDatabaseConfigured,
    setWorkerEnv,
    getWorkerEnv
};

