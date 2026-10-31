-- ==============================================================================
-- VAIDYA BOTANICALS: Complete Database Schema
-- Target Platform: Neon PostgreSQL 18 / Google Cloud Run
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CUSTOM ENUMS & DOMAINS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('customer', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_type') THEN
        CREATE TYPE order_status_type AS ENUM ('new', 'processing', 'dispatched', 'delivered', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_type') THEN
        CREATE TYPE payment_status_type AS ENUM ('pending', 'paid', 'failed', 'refunded');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_status_type') THEN
        CREATE TYPE support_status_type AS ENUM ('open', 'in_progress', 'resolved', 'closed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status_type') THEN
        CREATE TYPE review_status_type AS ENUM ('pending', 'approved', 'rejected', 'hidden');
    END IF;
END $$;

-- 3. PROFILES TABLE (Compatible with both Neon Auth / Better Auth and native profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    phone TEXT,
    role user_role NOT NULL DEFAULT 'customer',
    stytch_user_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stytch_user_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_stytch_user ON public.profiles(stytch_user_id);

-- 4. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g. 'tea', 'oil', 'tonic'
    health_segment TEXT,    -- e.g. 'Health Segment: Immunity'
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    compare_at_price NUMERIC(10, 2) CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    unit TEXT NOT NULL DEFAULT '/ 100g',
    short_description TEXT,
    description TEXT,
    ingredients TEXT,
    usage_instructions TEXT,
    storage_precautions TEXT,
    badge TEXT,             -- e.g. 'Best Seller', 'Pure Distillate'
    images JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {url, alt, is_primary, id}
    is_published BOOLEAN NOT NULL DEFAULT false,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_products_slug ON public.products(slug);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_published ON public.products(is_published, is_archived);

-- 5. SITE CONTENT TABLE (CMS)
CREATE TABLE IF NOT EXISTS public.site_content (
    key TEXT PRIMARY KEY, -- 'hero', 'about', 'benefits', 'story', 'support_info'
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_by TEXT REFERENCES public.profiles(id)
);

-- 6. ORDERS TABLE (Captures full snapshot of customer, recipient, and purchase prices)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    shipping_address JSONB NOT NULL, -- Full snapshot: { name, phone, addressLine1, city, state, postalCode }
    items JSONB NOT NULL,            -- Full snapshot: [ { id, name, price, qty, unit } ]
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    shipping NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
    total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    payment_method TEXT NOT NULL,    -- 'COD' or 'razorpay'
    payment_status payment_status_type NOT NULL DEFAULT 'pending',
    order_status order_status_type NOT NULL DEFAULT 'new',
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    courier_name TEXT,
    tracking_number TEXT,
    admin_notes TEXT,
    manual_verification_status TEXT NOT NULL DEFAULT 'unverified',
    verification_notes TEXT,
    verified_at TIMESTAMPTZ,
    recipient_name TEXT,
    recipient_phone TEXT,
    whatsapp_notified_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS manual_verification_status TEXT DEFAULT 'unverified';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS verification_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON public.orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay ON public.orders(razorpay_order_id);

-- 7. SUPPORT TICKETS TABLE
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT NOT NULL UNIQUE,
    customer_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    order_number TEXT,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {url, filename, size, mime}
    status support_status_type NOT NULL DEFAULT 'open',
    internal_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_support_customer ON public.support_tickets(customer_email);
CREATE INDEX IF NOT EXISTS idx_support_ticket_number ON public.support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_status ON public.support_tickets(status);

-- 8. REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    comment TEXT NOT NULL,
    verified_purchase BOOLEAN NOT NULL DEFAULT false,
    status review_status_type NOT NULL DEFAULT 'pending',
    moderated_by TEXT REFERENCES public.profiles(id),
    moderated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON public.reviews(product_id, status);

-- 9. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- 10. NOTIFICATION OUTBOX TABLE (Persistent serverless message queue)
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    order_number TEXT,
    recipient_phone TEXT NOT NULL,
    message_body TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_notification_idempotency ON public.notification_outbox(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notification_status ON public.notification_outbox(status);

-- 11. AUTH CREDENTIALS TABLE (Secure Password & Email Verification Store)
CREATE TABLE IF NOT EXISTS public.auth_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    verification_token TEXT,
    reset_token TEXT,
    reset_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_auth_credentials_email ON public.auth_credentials(email);
CREATE INDEX IF NOT EXISTS idx_auth_credentials_profile ON public.auth_credentials(profile_id);

-- 12. CUSTOMER SESSIONS TABLE (Persistent Server-Side Session Store)
CREATE TABLE IF NOT EXISTS public.customer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON public.customer_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_profile ON public.customer_sessions(profile_id);

-- 13. CUSTOMER CARTS TABLE (Persistent Server-Side Shopping Cart Store)
CREATE TABLE IF NOT EXISTS public.customer_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_customer_carts_profile ON public.customer_carts(profile_id);

-- 14. PHONE VERIFICATIONS TABLE (Guest Checkout Phone OTP Verification)
CREATE TABLE IF NOT EXISTS public.phone_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    session_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'consumed', 'expired'
    purpose TEXT NOT NULL DEFAULT 'checkout', -- 'checkout', 'admin_auth'
    verification_proof TEXT UNIQUE,
    proof_expires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_challenge ON public.phone_verifications(challenge_id);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_proof ON public.phone_verifications(verification_proof);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_purpose ON public.phone_verifications(purpose);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone_created ON public.phone_verifications(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_ip_created ON public.phone_verifications(ip_address, created_at DESC);


