-- 1. Migrate keys from lite_engine_keys (Groq) to api_list
INSERT INTO api_list (api, provider, model, status, usage_today, last_date_checked, last_used_at)
SELECT 
    api_key as api, 
    'groq' as provider, 
    'llama-3.3-70b-versatile' as model, 
    CASE WHEN status = 'active' THEN 'active' ELSE 'disabled' END as status,
    requests_today as usage_today,
    CURRENT_DATE::text as last_date_checked,
    last_used_at
FROM lite_engine_keys
ON CONFLICT (api) DO NOTHING;

-- 2. Migrate keys from openrouter_keys to api_list
-- (Assuming openrouter_keys table exists based on previous engine logic)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'openrouter_keys') THEN
        INSERT INTO api_list (api, provider, model, status, usage_today, last_date_checked, last_used_at)
        SELECT 
            api_key as api, 
            'openrouter' as provider, 
            'arcee-ai/trinity-large-preview:free' as model, 
            CASE WHEN status = 'active' THEN 'active' ELSE 'disabled' END as status,
            requests_today as usage_today,
            CURRENT_DATE::text as last_date_checked,
            last_used_at
        FROM openrouter_keys
        ON CONFLICT (api) DO NOTHING;
    END IF;
END $$;

-- 3. Add a unique constraint on 'api' column if it doesn't exist to support ON CONFLICT
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_list_api_key') THEN
        ALTER TABLE api_list ADD CONSTRAINT api_list_api_key UNIQUE (api);
    END IF;
END $$;
