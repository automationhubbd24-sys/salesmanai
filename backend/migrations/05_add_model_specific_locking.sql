-- ==========================================
-- 40. Model-Specific Smart Locking System
-- ==========================================
-- This table tracks usage and lock status for EACH model within a single API Key.
-- This allows one model (e.g. gemini-1.5-flash) to be locked while others (e.g. gemini-1.5-pro) 
-- remain active on the SAME API key.

CREATE TABLE IF NOT EXISTS public.api_key_model_usage (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    api_key_id BIGINT REFERENCES api_list(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    usage_today INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- 'active' or 'locked'
    cooldown_until TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_date_checked DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(api_key_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_api_model_usage_key_id ON api_key_model_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_model_usage_model_name ON api_key_model_usage(model_name);
CREATE INDEX IF NOT EXISTS idx_api_model_usage_status ON api_key_model_usage(status);
