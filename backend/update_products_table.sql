
-- Run this in your Supabase SQL Editor to update the products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BDT',
ADD COLUMN IF NOT EXISTS allowed_page_ids JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS keywords TEXT;
