-- Add cost column to api_usage_stats
ALTER TABLE public.api_usage_stats 
ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;

-- Update existing rows to have some estimated cost if possible (optional)
-- For now, we'll just leave them at 0.
