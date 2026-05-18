-- ==========================================
-- 41. Model-Specific Rate Limits (Global)
-- ==========================================
-- This table allows defining custom RPM, RPH, RPD, TPM, TPD for EACH specific model.
-- These limits will override provider defaults.

CREATE TABLE IF NOT EXISTS public.model_rate_limits (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    rpm_limit INTEGER DEFAULT 0, -- 0 means use provider default or unlimited
    rph_limit INTEGER DEFAULT 0,
    rpd_limit INTEGER DEFAULT 0,
    tpm_limit INTEGER DEFAULT 0,
    tpd_limit INTEGER DEFAULT 0,
    tpmo_limit INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_rate_limits_name ON model_rate_limits(model_name);
CREATE INDEX IF NOT EXISTS idx_model_rate_limits_provider ON model_rate_limits(provider);
