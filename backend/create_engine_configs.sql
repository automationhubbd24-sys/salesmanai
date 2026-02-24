-- Create engine_configs table
CREATE TABLE IF NOT EXISTS engine_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL, -- salesmanchatbot-pro, salesmanchatbot-flash, salesmanchatbot-lite
    provider VARCHAR(50) NOT NULL, -- google, openrouter, groq
    text_model VARCHAR(255),
    voice_model VARCHAR(255),
    image_model VARCHAR(255),
    voice_provider_override VARCHAR(50), -- Optional: engine name to use for voice
    image_provider_override VARCHAR(50), -- Optional: engine name to use for image
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial data
INSERT INTO engine_configs (name, provider, text_model, voice_model, image_model)
VALUES 
('salesmanchatbot-pro', 'google', 'gemini-2.0-flash', 'gemini-2.0-flash', 'gemini-2.0-flash'),
('salesmanchatbot-flash', 'openrouter', 'arcee-ai/trinity-large-preview', 'arcee-ai/trinity-large-preview', 'arcee-ai/trinity-large-preview'),
('salesmanchatbot-lite', 'groq', 'llama-3.3-70b-versatile', 'whisper-large-v3', 'llama-3.2-11b-vision-preview')
ON CONFLICT (name) DO NOTHING;
