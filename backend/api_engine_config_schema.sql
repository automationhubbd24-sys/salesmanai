-- ==========================================
--  10. Global API Engine Provider Config
-- ==========================================
CREATE TABLE IF NOT EXISTS public.api_engine_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text UNIQUE NOT NULL, -- 'google', 'openai', 'openrouter', 'groq'
  text_model text DEFAULT 'gemini-1.5-flash',
  vision_model text DEFAULT 'gemini-1.5-flash',
  voice_model text DEFAULT 'gemini-1.5-flash-lite',
  updated_at timestamp with time zone DEFAULT now()
);

-- Insert defaults for Gemini if not exists
INSERT INTO public.api_engine_configs (provider, text_model, vision_model, voice_model)
VALUES ('google', 'gemini-1.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-lite')
ON CONFLICT (provider) DO NOTHING;
