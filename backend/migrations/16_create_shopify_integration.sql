CREATE TABLE IF NOT EXISTS shopify_integrations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_domain TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    scope TEXT,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ,
    UNIQUE(user_id, shop_domain)
);

CREATE TABLE IF NOT EXISTS shopify_products (
    id BIGSERIAL PRIMARY KEY,
    integration_id BIGINT NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    shopify_product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    handle TEXT,
    status TEXT,
    description TEXT,
    image_url TEXT,
    variants JSONB NOT NULL DEFAULT '[]'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(integration_id, shopify_product_id)
);
CREATE INDEX IF NOT EXISTS shopify_integrations_user_idx ON shopify_integrations(user_id);
