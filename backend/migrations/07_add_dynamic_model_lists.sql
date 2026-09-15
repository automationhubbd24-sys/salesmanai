-- ==========================================
-- 42. Dynamic Model Lists for API Engine
-- ==========================================
-- This allows storing multiple models and their limits per modality (text, vision, voice).

ALTER TABLE public.api_engine_configs 
ADD COLUMN IF NOT EXISTS text_models_list JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS vision_models_list JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS voice_models_list JSONB DEFAULT '[]'::jsonb;

-- Comment: These JSONB columns will store arrays of objects like:
-- { "model": "gemini-1.5-flash", "rpm": 1, "rpd": 15, "rph": 1, "tpm": 0, "tpd": 0, "tpmo": 0 }
