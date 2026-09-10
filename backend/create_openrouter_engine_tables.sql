-- Table for OpenRouter API Keys
CREATE TABLE IF NOT EXISTS public.openrouter_engine_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    api_key TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT 'default', -- e.g. 'owner', 'backup'
    usage_limit NUMERIC DEFAULT 0, -- Limit from OpenRouter API
    usage_used NUMERIC DEFAULT 0,  -- Used amount
    is_active BOOLEAN DEFAULT true,
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for Auto-Selected Best Models (Updated every 1 hour)
CREATE TABLE IF NOT EXISTS public.openrouter_engine_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    config_type TEXT UNIQUE DEFAULT 'best_models', -- Singleton row
    
    -- Selected Models
    text_model TEXT,
    voice_model TEXT,
    image_model TEXT,
    
    -- Metadata
    text_model_details JSONB,
    voice_model_details JSONB,
    image_model_details JSONB,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.openrouter_engine_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openrouter_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service Role Full Access Keys" ON public.openrouter_engine_keys
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service Role Full Access Config" ON public.openrouter_engine_config
    FOR ALL USING (true) WITH CHECK (true);
