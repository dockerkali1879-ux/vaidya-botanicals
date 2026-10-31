-- ==============================================================================
-- VAIDYA BOTANICALS: Dedicated Least-Privilege Application Runtime Role
-- Target: Neon PostgreSQL 18 (Development Branch)
-- Purpose: Segregates runtime DML operations from DDL administrative ownership.
-- Execute once using administrative migration connection (neondb_owner).
-- ==============================================================================

-- 1. Create dedicated application runtime role if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vaidya_runtime') THEN
        -- Password should be substituted or provided via environment variable / vault
        CREATE ROLE vaidya_runtime WITH LOGIN PASSWORD 'vaidya_runtime_dev_secure_pass_2026';
    END IF;
END $$;

-- 2. Grant basic database connectivity and schema usage
GRANT CONNECT ON DATABASE neondb TO vaidya_runtime;
GRANT USAGE ON SCHEMA public TO vaidya_runtime;

-- 3. Grant strict DML execution permissions on all existing tables
-- Strictly restricts runtime to Data Manipulation (SELECT, INSERT, UPDATE, DELETE).
-- The runtime role CANNOT DROP, TRUNCATE, or ALTER tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaidya_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vaidya_runtime;

-- 4. Establish default privileges for any future tables created by schema migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaidya_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vaidya_runtime;

