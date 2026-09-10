-- Supabase Storage Setup (Simplified)
-- Run this in SQL Editor to create the bucket.
-- If you encounter "must be owner" errors with policies, please use the Supabase Dashboard (instructions below).

-- 1. Create the bucket 'product-images'
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- 2. IMPORTANT: Configuration via Dashboard
-- Due to permission restrictions in the SQL Editor for some projects, it is safer to set policies via the UI.

-- INSTRUCTIONS:
-- 1. Go to your Supabase Dashboard -> Storage.
-- 2. You should see a bucket named "product-images". If not, create it manually and make it "Public".
-- 3. Click on the "Configuration" or "Policies" tab for the 'product-images' bucket.
-- 4. Add a New Policy for READ access:
--    - Name: "Public Access"
--    - Allowed Operations: SELECT
--    - Target roles: checked for 'anon' and 'authenticated'
--    - Click Save.
-- 5. Add a New Policy for UPLOAD access:
--    - Name: "Allow Uploads"
--    - Allowed Operations: INSERT
--    - Target roles: checked for 'anon' and 'authenticated'
--    - Click Save.
