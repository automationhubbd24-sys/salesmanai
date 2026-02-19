
-- Enable UUID extension
create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid default uuid_generate_v4() primary key,
  email text not null unique,
  created_at timestamp with time zone default now()
);

-- Ensure columns needed for password-based auth exist
alter table users add column if not exists password_hash text;
alter table users add column if not exists full_name text;
alter table users add column if not exists phone text;

create table if not exists email_otp_codes (
  id uuid default uuid_generate_v4() primary key,
  email text not null,
  code text not null,
  expires_at timestamp with time zone not null,
  used boolean default false,
  created_at timestamp with time zone default now()
);

create index if not exists idx_email_otp_email_created_at on email_otp_codes(email, created_at desc);

-- 1. Table for WhatsApp Sessions (Managed by WAHA)
create table if not exists whatsapp_sessions (
  id uuid default uuid_generate_v4() primary key,
  session_id text not null unique,
  session_name text,
  user_email text,
  user_id text, -- Supabase Auth User ID
  plan_days int,
  qr_code text,
  status text default 'stopped',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists app_users (
  id bigserial primary key,
  key text not null unique,
  pas text
);

-- 2. Table for User Configurations (AI Providers, API Keys)
create table if not exists user_configs (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null unique, -- Supabase Auth User ID or Email
  ai_provider text default 'openrouter', -- 'openai', 'gemini', 'openrouter', 'groq'
  api_key text,
  model_name text default 'openrouter/auto',
  system_prompt text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. Table for Debounce (Production-Grade Queueing)
create table if not exists wpp_debounce (
  id uuid default uuid_generate_v4() primary key,
  debounce_key text not null unique, -- e.g., 'pageId_senderId'
  last_message_at timestamp with time zone default now(),
  is_processing boolean default false
);

-- 4. Update wp_chats to support Media
alter table wp_chats add column if not exists media_type text default 'text'; -- 'text', 'image', 'audio'
alter table wp_chats add column if not exists media_url text;

-- Indexes for performance
create index if not exists idx_wp_chats_sender_page_status on wp_chats(sender_id, page_id, status);
create index if not exists idx_wpp_debounce_key on wpp_debounce(debounce_key);

-- Update user_configs for Control Page settings
alter table user_configs add column if not exists auto_reply boolean default true;
alter table user_configs add column if not exists ai_enabled boolean default true;
alter table user_configs add column if not exists media_enabled boolean default true;
alter table user_configs add column if not exists response_language text default 'bn';
alter table user_configs add column if not exists balance numeric default 0;
alter table user_configs add column if not exists message_credit numeric default 0;
alter table user_configs add column if not exists response_tone text;
alter table user_configs add column if not exists service_api_key text unique;
-- 5. Table for Session QR Links (User Requested)
create table if not exists session_qr_link ( 
   id bigint generated always as identity not null, 
   qr_link text not null, 
   session_name text null, 
   session_used boolean null default false, 
   constraint session_qr_link_pkey primary key (id) 
 ) TABLESPACE pg_default;

-- 6. Fix for existing whatsapp_sessions table
alter table whatsapp_sessions add column if not exists user_id text;
alter table whatsapp_sessions add column if not exists qr_code text;
alter table whatsapp_sessions add column if not exists status text default 'stopped';
alter table whatsapp_sessions add column if not exists updated_at timestamp with time zone default now();
alter table whatsapp_sessions add column if not exists created_at timestamp with time zone default now();
alter table whatsapp_sessions add column if not exists expires_at timestamp with time zone;

-- 7. Add Unique Constraint to session_name (Required for Upsert)
alter table whatsapp_sessions drop constraint if exists whatsapp_sessions_session_name_key;
alter table whatsapp_sessions add constraint whatsapp_sessions_session_name_key unique (session_name);

-- 8. Facebook Page Integration Tables
create table if not exists page_access_token_message (
  page_id text primary key,
  name text,
  page_access_token text,
  data_sheet text,
  secret_key text,
  found_id text,
  email text,
  ai text default 'google',
  api_key text, -- Supports multiple comma-separated keys for load balancing (e.g., "key1,key2,key3")
  chat_model text default 'openrouter/auto',
  subscription_status text default 'inactive', -- active, inactive, trial
  subscription_plan text, -- free, basic, pro, etc.
  subscription_expiry timestamp with time zone,
  message_credit numeric default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Ensure columns exist for page_access_token_message (if table already existed)
alter table page_access_token_message add column if not exists ai text default 'openrouter';
alter table page_access_token_message add column if not exists api_key text;
alter table page_access_token_message add column if not exists chat_model text default 'openrouter/auto';
alter table page_access_token_message add column if not exists subscription_status text default 'inactive';
alter table page_access_token_message add column if not exists subscription_plan text;
alter table page_access_token_message add column if not exists subscription_expiry timestamp with time zone;
alter table page_access_token_message add column if not exists message_credit numeric default 0;
alter table page_access_token_message add column if not exists cheap_engine boolean default true;
alter table page_access_token_message add column if not exists user_access_token text;
alter table page_access_token_message add column if not exists user_id text;

create table if not exists fb_message_database (
  id bigint generated always as identity not null primary key,
  page_id text not null,
  text_prompt text,
  created_at timestamp with time zone default now()
);
alter table fb_message_database add column if not exists reply_message boolean default true;
alter table fb_message_database add column if not exists swipe_reply boolean default true;
alter table fb_message_database add column if not exists image_detection boolean default false;
alter table fb_message_database add column if not exists image_send boolean default false;
alter table fb_message_database add column if not exists template boolean default false;
alter table fb_message_database add column if not exists order_tracking boolean default false;
alter table fb_message_database add column if not exists image_prompt text;
alter table fb_message_database add column if not exists template_prompt_x1 text;
alter table fb_message_database add column if not exists template_prompt_x2 text;
alter table fb_message_database add column if not exists verified boolean default true;
alter table fb_message_database add column if not exists wait integer default 8;
alter table fb_message_database add column if not exists block_emoji text;
alter table fb_message_database add column if not exists unblock_emoji text;
alter table fb_message_database add column if not exists check_conversion integer default 20;
alter table fb_message_database add column if not exists memory_context_name text;
alter table fb_message_database add column if not exists order_lock_minutes integer default 1440;

-- 9. Chat History for AI Context (n8n replacement)
create table if not exists n8n_chat_histories (
  id bigint generated always as identity not null primary key,
  session_id text not null, -- Format: page_id_sender_id
  message jsonb not null, -- Stores { role: 'user'|'assistant', content: '...' }
  created_at timestamp with time zone default now()
);

-- Index for fast retrieval
create index if not exists idx_n8n_chat_histories_session on n8n_chat_histories(session_id);

-- 10. Tables from n8n Workflow (100% Copy)
CREATE TABLE IF NOT EXISTS public.fb_chats (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  page_id text NULL,
  sender_id text NULL,
  recipient_id text NULL,
  message_id text NULL,
  text text NULL,
  timestamp bigint NULL,
  status character varying NULL DEFAULT 'pending'::character varying,
  created_at timestamp with time zone NULL DEFAULT now(),
  reply_by text NULL, -- Added to track 'bot' vs 'human'
  CONSTRAINT fb_chats_pkey PRIMARY KEY (id),
  CONSTRAINT fb_chats_message_id_key UNIQUE (message_id)
) TABLESPACE pg_default;

CREATE TABLE IF NOT EXISTS public.fb_included_users (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  page_id text NOT NULL,
  sender_id text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  key text NOT NULL,
  CONSTRAINT fb_included_users_pkey PRIMARY KEY (id),
  CONSTRAINT fb_included_users_key_key UNIQUE (key)
) TABLESPACE pg_default;

CREATE TABLE IF NOT EXISTS public.fb_order_tracking (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL PRIMARY KEY,
  page_id text NULL,
  sender_id text NULL,
  product_name text NULL,
  number text NULL,
  location text NULL,
  product_quantity text NULL,
  price text NULL,
  created_at timestamp with time zone DEFAULT now()
);
create index if not exists idx_fb_order_tracking_page_id on fb_order_tracking(page_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_order_tracking (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at timestamp with time zone DEFAULT now(),
  session_name text NOT NULL,
  sender_id text,
  product_name text,
  number text,
  location text,
  product_quantity text,
  price text,
  status text DEFAULT 'pending'
);
create index if not exists idx_whatsapp_orders_number_date on whatsapp_order_tracking(number, created_at);

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at timestamp with time zone DEFAULT now(),
  session_name text NOT NULL,
  phone_number text NOT NULL,
  name text,
  last_interaction timestamp with time zone,
  UNIQUE(session_name, phone_number)
);

CREATE TABLE IF NOT EXISTS products (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    keywords TEXT,
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    price NUMERIC DEFAULT 0,
    stock INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'BDT',
    variants JSONB DEFAULT '[]'::jsonb,
    allowed_page_ids JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING gin (description gin_trgm_ops);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own products" ON products;
CREATE POLICY "Users can view own products" ON products
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own products" ON products;
CREATE POLICY "Users can insert own products" ON products
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own products" ON products;
CREATE POLICY "Users can update own products" ON products
    FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own products" ON products;
CREATE POLICY "Users can delete own products" ON products
    FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS user_integrations (
    user_id UUID PRIMARY KEY,
    wc_url TEXT,
    wc_consumer_key TEXT,
    wc_consumer_secret TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own integrations" ON user_integrations;
CREATE POLICY "Users can manage own integrations" ON user_integrations
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  amount numeric NOT NULL,
  method text NOT NULL,
  trx_id text NOT NULL,
  sender_number text NOT NULL,
  status text NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NULL DEFAULT now()
);
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.payment_transactions;
CREATE POLICY "Users can view own transactions" 
ON public.payment_transactions FOR SELECT 
USING (auth.email() = user_email);
DROP POLICY IF EXISTS "Users can insert deposit requests" ON public.payment_transactions;
CREATE POLICY "Users can insert deposit requests" 
ON public.payment_transactions FOR INSERT 
WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public read for admin panel" ON public.payment_transactions;
CREATE POLICY "Allow public read for admin panel"
ON public.payment_transactions FOR SELECT
USING (true);
DROP POLICY IF EXISTS "Allow public update for admin panel" ON public.payment_transactions;
CREATE POLICY "Allow public update for admin panel"
ON public.payment_transactions FOR UPDATE
USING (true);

CREATE OR REPLACE FUNCTION public.handle_new_gmail_user()
RETURNS trigger AS $$
BEGIN
  IF NEW.email ILIKE '%@gmail.com' THEN
    INSERT INTO public.user_configs (user_id, message_credit)
    VALUES (NEW.id, 100)
    ON CONFLICT (user_id) DO UPDATE
    SET message_credit = COALESCE(user_configs.message_credit, 0) + 100;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_gmail_bonus ON auth.users;
CREATE TRIGGER on_auth_user_created_gmail_bonus
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_gmail_user();

CREATE TABLE IF NOT EXISTS public.fb_n8n_debounce (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  key text NOT NULL,
  incr bigint NULL DEFAULT '0'::bigint,
  CONSTRAINT n8n_debounce_pkey PRIMARY KEY (id),
  CONSTRAINT n8n_debounce_key_key UNIQUE (key)
) TABLESPACE pg_default;

-- 11. Facebook Comments Table (New for Comment Logic)
CREATE TABLE IF NOT EXISTS public.fb_comments (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  comment_id text NOT NULL,
  page_id text NULL,
  sender_id text NULL,
  parent_id text NULL, -- if reply to another comment
  post_id text NULL,
  message text NULL,
  reply_text text NULL, -- Bot's reply
  created_at timestamp with time zone DEFAULT now(),
  status text default 'replied',
  CONSTRAINT fb_comments_pkey PRIMARY KEY (id),
  CONSTRAINT fb_comments_comment_id_key UNIQUE (comment_id)
) TABLESPACE pg_default;

-- 12. API Key Management (Multi-Key Support)
CREATE TABLE IF NOT EXISTS public.api_list (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
  provider text NOT NULL, -- 'google', 'openai', 'gemini'
  api text NOT NULL, -- The API Key
  model text DEFAULT 'gemini-2.5-flash',
  usage_count bigint DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Update api_list table for Rate Limiting (RPM, RPD)
alter table api_list add column if not exists rpm_limit int default 5; -- Requests Per Minute
alter table api_list add column if not exists rpd_limit int default 20; -- Requests Per Day
alter table api_list add column if not exists usage_today int default 0;
alter table api_list add column if not exists last_used_at timestamp with time zone;
alter table api_list add column if not exists last_date_checked date default CURRENT_DATE;
alter table api_list add column if not exists status text default 'active';

-- Create index for fast lookup
create index if not exists idx_api_list_provider on api_list(provider);

-- 13. Team Members System
create table if not exists team_members (
  id uuid default uuid_generate_v4() primary key,
  owner_email text not null,
  member_email text not null,
  status text default 'active', -- active, pending
  created_at timestamp with time zone default now(),
  permissions jsonb default '{}'::jsonb,
  constraint team_members_unique_pair unique (owner_email, member_email)
);
