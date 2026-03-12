CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.page_access_token_message (
    id              BIGSERIAL PRIMARY KEY,
    page_id         TEXT UNIQUE NOT NULL,
    page_access_token TEXT,
    user_id         UUID,
    email           TEXT,
    message_credit  NUMERIC DEFAULT 0,
    subscription_status TEXT DEFAULT 'inactive',
    subscription_plan   TEXT,
    expires_at      TIMESTAMPTZ,
    bot_name        TEXT,
    api_key         TEXT,
    cheap_engine    BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fb_chats (
    id           BIGSERIAL PRIMARY KEY,
    page_id      TEXT NOT NULL,
    sender_id    TEXT,
    recipient_id TEXT,
    message_id   TEXT,
    text         TEXT,
    timestamp    BIGINT,
    status       TEXT,
    reply_by     TEXT,
    ai_model     TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

