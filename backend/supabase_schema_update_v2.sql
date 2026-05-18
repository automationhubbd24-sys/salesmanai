-- Add Simple Product Fields
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;

-- Create Table for WooCommerce Config (Optional, but good for "Connect" feature)
CREATE TABLE IF NOT EXISTS user_integrations (
    user_id UUID PRIMARY KEY,
    wc_url TEXT,
    wc_consumer_key TEXT,
    wc_consumer_secret TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own integrations" ON user_integrations
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
