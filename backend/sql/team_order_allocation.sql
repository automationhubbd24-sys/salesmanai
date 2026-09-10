-- Additive Team Management order-allocation storage.
-- This intentionally does not alter or backfill any existing order tables.

CREATE TABLE IF NOT EXISTS public.team_order_settings (
    owner_email TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'equal_share')),
    batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size > 0),
    overflow BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_order_assignments (
    owner_email TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('fb', 'whatsapp')),
    resource_id TEXT NOT NULL,
    order_identity TEXT NOT NULL,
    member_email TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_email, source, resource_id, order_identity)
);

CREATE INDEX IF NOT EXISTS idx_team_order_assignments_owner_member
    ON public.team_order_assignments (owner_email, member_email, assigned_at DESC);
