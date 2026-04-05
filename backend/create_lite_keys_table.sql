
-- Table to store thousands of Groq API Keys for Lite Engine
CREATE TABLE IF NOT EXISTS public.lite_engine_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    api_key TEXT NOT NULL UNIQUE,
    provider TEXT DEFAULT 'groq', -- future proofing
    status TEXT DEFAULT 'active', -- active, rate_limited, exhausted, suspended
    
    -- Usage Tracking
    total_tokens_used BIGINT DEFAULT 0,
    requests_today INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    -- Rate Limit Tracking (Reset Daily)
    reset_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 day',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval of active keys
CREATE INDEX idx_lite_keys_status ON public.lite_engine_keys(status);
CREATE INDEX idx_lite_keys_last_used ON public.lite_engine_keys(last_used_at);

-- RLS Policies (Security)
ALTER TABLE public.lite_engine_keys ENABLE ROW LEVEL SECURITY;

-- Allow Backend (Service Role) full access
CREATE POLICY "Service Role Full Access" ON public.lite_engine_keys
    FOR ALL
    USING (true)
    WITH CHECK (true);
