-- Supabase Storage Setup for Product Images
-- Run this in your Supabase SQL Editor

-- 1. Create the bucket 'product-images' if it doesn't exist
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- 2. Enable RLS (Row Level Security) - Good practice, though we might use Service Role key
alter table storage.objects enable row level security;

-- 3. Policy: Allow Public Read Access (Anyone can view images)
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'product-images' );

-- 4. Policy: Allow Uploads (Adjust as needed for security)
-- For now, allowing anyone to insert to this bucket to ensure the backend can upload
-- In production, you might want to restrict this to authenticated users only
create policy "Allow Uploads"
on storage.objects for insert
with check ( bucket_id = 'product-images' );

-- 5. Policy: Allow Updates (If needed)
create policy "Allow Updates"
on storage.objects for update
using ( bucket_id = 'product-images' );
