-- Migration to add a central model pricing table
CREATE TABLE IF NOT EXISTS public.model_pricing (
    id SERIAL PRIMARY KEY,
    model_id TEXT UNIQUE NOT NULL, -- e.g. 'salesmanchatbot-pro', 'salesmanchatbot-flash'
    display_name TEXT NOT NULL,
    cost_per_1k_tokens NUMERIC NOT NULL DEFAULT 0,
    cost_per_request NUMERIC NOT NULL DEFAULT 0.15,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default prices if they don't exist
INSERT INTO public.model_pricing (model_id, display_name, cost_per_1k_tokens, cost_per_request, description)
VALUES 
('salesmanchatbot-pro', 'Pro Engine', 0, 0.15, 'High-quality Pro model'),
('salesmanchatbot-flash', 'Flash Engine', 0, 0.10, 'Fast Flash model'),
('salesmanchatbot-lite', 'Lite Engine', 0, 0.08, 'Lightweight model'),
('salesmanchatbot-brain', 'Brain Engine', 0, 0.09, 'Specialized Brain model')
ON CONFLICT (model_id) DO NOTHING;
